import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth.js';
import { requireAuth, requireCompany, resolveCompanyScope } from '../auth.js';
import type { Database } from '../database.js';
import { AppError, notFound } from '../errors.js';
import PDFDocument from 'pdfkit';
import { rolesFor } from '../../../../packages/shared/src/index.js';

interface Dependencies { auth: AuthService; db: Database }
const contactInput = z.object({
  name: z.string().trim().min(1).max(160),
  phoneNumber: z.string().trim().regex(/^\+?[1-9]\d{6,17}$/),
  country: z.string().trim().max(80).nullable().optional(),
  status: z.enum(['active', 'blocked', 'archived']).default('active'),
});

function id(raw: string): string {
  if (!/^\d+$/.test(raw)) throw new AppError(400, 'INVALID_ID', 'Identificador inválido.');
  return raw;
}

export function directoryRoutes({ auth, db }: Dependencies): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: { search?: string; status?: string } }>('/contacts', { preHandler: requireAuth(auth, rolesFor('tenantOperations')) }, async (request) => {
      const companyId = requireCompany(request);
      const search = request.query.search?.trim();
      const status = request.query.status;
      return db`
        select ct.id::text, ct.name, ct.phone_number, ct.country, ct.status, ct.created_at::text, ct.last_message_at::text,
          count(c.id)::int as conversation_count
        from public.contacts ct
        left join public.conversations c on c.company_id = ct.company_id and c.contact_id = ct.id
        where ct.company_id = ${companyId}
          and (${!search} or ct.name ilike ${`%${search ?? ''}%`} or ct.phone_number ilike ${`%${search ?? ''}%`})
          and (${!status || status === 'all'} or ct.status = ${status ?? 'all'})
        group by ct.id
        order by coalesce(ct.last_message_at, ct.created_at) desc
        limit 200
      `;
    });

    app.post('/contacts', { preHandler: requireAuth(auth, rolesFor('manageContacts')) }, async (request) => {
      const companyId = requireCompany(request);
      const input = contactInput.parse(request.body);
      const [created] = await db`
        insert into public.contacts(company_id, name, phone_number, country, status)
        values (${companyId}, ${input.name}, ${input.phoneNumber}, ${input.country ?? null}, ${input.status})
        on conflict (company_id, phone_number) do update set
          name = excluded.name, country = excluded.country, status = excluded.status
        returning *
      `;
      return created;
    });

    app.get('/contacts/export', { preHandler: requireAuth(auth, rolesFor('manageContacts')) }, async (request, reply) => {
      const companyId = requireCompany(request);
      const rows = await db<{ name: string | null; phone_number: string; country: string | null; status: string; created_at: string }[]>`select name,phone_number,country,status,created_at::text from public.contacts where company_id=${companyId} order by id`;
      const escape = (raw: unknown) => `"${String(raw ?? '').replace(/"/g,'""')}"`;
      const csv = ['nombre,telefono,pais,estado,creado',...rows.map((row)=>[row.name,row.phone_number,row.country,row.status,row.created_at].map(escape).join(','))].join('\r\n');
      return reply.header('content-type','text/csv; charset=utf-8').header('content-disposition','attachment; filename="movensa-contactos.csv"').send(`\ufeff${csv}`);
    });

    app.patch<{ Params: { id: string } }>('/contacts/:id', { preHandler: requireAuth(auth, rolesFor('manageContacts')) }, async (request) => {
      const companyId = requireCompany(request);
      const input = contactInput.parse(request.body);
      const [updated] = await db`
        update public.contacts set name = ${input.name}, phone_number = ${input.phoneNumber},
          country = ${input.country ?? null}, status = ${input.status}
        where company_id = ${companyId} and id = ${id(request.params.id)} returning *
      `;
      if (!updated) throw notFound('Contacto no encontrado.');
      return updated;
    });

    app.patch<{ Params: { id: string }; Querystring: { companyId?: string } }>('/contacts/:id/name', { preHandler: requireAuth(auth, ['admin', 'agent', 'super_admin']) }, async (request) => {
      const companyId = resolveCompanyScope(request, request.query.companyId);
      const input = z.object({ name: z.string().trim().min(1).max(160) }).parse(request.body);
      const [updated] = await db`
        update public.contacts set name = ${input.name}
        where company_id = ${companyId} and id = ${id(request.params.id)} returning *
      `;
      if (!updated) throw notFound('Contacto no encontrado.');
      return updated;
    });

    app.get<{ Params: { id: string } }>('/contacts/:id/conversations', { preHandler: requireAuth(auth, rolesFor('tenantOperations')) }, async (request) => {
      const companyId = requireCompany(request);
      const contactId = id(request.params.id);
      return db`
        select c.id::text,c.channel,c.status,c.started_at::text,c.ended_at::text,
          coalesce(c.last_activity_at,c.started_at)::text as last_activity_at,c.total_messages,
          u.name as assigned_user_name,
          (select m.message from public.messages m where m.company_id=c.company_id and m.conversation_id=c.id order by m.sent_at desc,m.id desc limit 1) as last_message
        from public.conversations c left join public.users u on u.company_id=c.company_id and u.id=c.assigned_user_id
        where c.company_id=${companyId} and c.contact_id=${contactId}
          and (${request.session.role !== 'agent'} or c.assigned_user_id is null or c.assigned_user_id=${request.session.userId})
        order by coalesce(c.last_activity_at,c.started_at) desc
      `;
    });

    app.get<{ Querystring: { companyId?: string } }>('/team', { preHandler: requireAuth(auth, ['admin', 'super_admin']) }, async (request) => {
      const companyId = resolveCompanyScope(request, request.query.companyId);
      return db`
        select u.id::text, u.name, u.email, u.phone, u.role, u.status, u.is_online, u.last_activity::text,
          count(c.id) filter (where c.status <> 'closed')::int as active_conversations
        from public.users u
        left join public.conversations c on c.company_id = u.company_id and c.assigned_user_id = u.id
        where u.company_id = ${companyId} and u.role = 'agent'
        group by u.id
        order by u.status desc, u.name
      `;
    });

    app.get<{ Querystring: { companyId?: string } }>('/team/analytics', { preHandler: requireAuth(auth, ['admin', 'super_admin']) }, async (request) => {
      const companyId = resolveCompanyScope(request, request.query.companyId);
      const [summary] = await db<{ open_conversations: number; average_load: number; closed_today: number }[]>`
        select
          (select count(*)::int from public.conversations where company_id=${companyId} and status='open') as open_conversations,
          case when count(*) = 0 then 0 else round((select count(*)::numeric from public.conversations where company_id=${companyId} and status='open') / count(*), 1) end as average_load,
          (select count(*)::int from public.conversations where company_id=${companyId} and status='closed' and ended_at >= date_trunc('day', now())) as closed_today
        from public.users where company_id=${companyId} and role='agent'
      `;
      const agents = await db`
        select u.id::text,u.name,u.email,u.phone,u.status,u.is_online,u.last_activity::text,
          count(c.id) filter (where c.status <> 'closed')::int as active_conversations,
          count(c.id) filter (where c.status='closed' and c.ended_at >= date_trunc('day',now()))::int as closed_today
        from public.users u
        left join public.conversations c on c.company_id=u.company_id and c.assigned_user_id=u.id
        where u.company_id=${companyId} and u.role='agent'
        group by u.id order by u.status desc,u.name
      `;
      return { summary, agents };
    });

    app.get<{ Params: { id: string }; Querystring: { companyId?: string; from?: string; to?: string } }>('/team/:id/closures', { preHandler: requireAuth(auth, ['admin', 'super_admin']) }, async (request) => {
      const companyId = resolveCompanyScope(request, request.query.companyId);
      const userId = id(request.params.id);
      const from = request.query.from && !Number.isNaN(Date.parse(request.query.from)) ? request.query.from : '1970-01-01T00:00:00.000Z';
      const to = request.query.to && !Number.isNaN(Date.parse(request.query.to)) ? request.query.to : new Date().toISOString();
      return db`
        select c.id::text,ct.phone_number as contact_phone,ct.name as contact_name,c.started_at::text,c.ended_at::text,
          round(c.first_response_seconds::numeric/60,1) as first_response_minutes,
          round(extract(epoch from (c.ended_at-c.started_at))/60,1) as duration_minutes
        from public.conversations c join public.contacts ct on ct.company_id=c.company_id and ct.id=c.contact_id
        where c.company_id=${companyId} and c.closed_by_user_id=${userId} and c.status='closed'
          and c.ended_at between ${from}::timestamptz and ${to}::timestamptz
        order by c.ended_at desc
      `;
    });

    app.patch<{ Params: { id: string }; Querystring: { companyId?: string } }>('/team/:id/name', { preHandler: requireAuth(auth, ['admin', 'super_admin']) }, async (request) => {
      const companyId = resolveCompanyScope(request, request.query.companyId);
      const input = z.object({ name: z.string().trim().min(1).max(160) }).parse(request.body);
      const [updated] = await db`update public.users set name=${input.name},updated_at=now() where company_id=${companyId} and id=${id(request.params.id)} and role='agent' returning id::text,name`;
      if (!updated) throw notFound('Agente no encontrado.');
      return updated;
    });

    app.get<{ Querystring: { from?: string; to?: string; companyId?: string } }>('/reports/overview', { preHandler: requireAuth(auth, ['admin', 'super_admin']) }, async (request) => {
      const companyId = resolveCompanyScope(request, request.query.companyId);
      const to = request.query.to && !Number.isNaN(Date.parse(request.query.to)) ? request.query.to : new Date().toISOString();
      const fromDefault = new Date(Date.parse(to) - 30 * 86_400_000).toISOString();
      const from = request.query.from && !Number.isNaN(Date.parse(request.query.from)) ? request.query.from : fromDefault;
      const [overview] = await db`
        select
          (select count(*)::int from public.conversations c where c.company_id=${companyId} and c.started_at between ${from}::timestamptz and ${to}::timestamptz) as conversations,
          (select count(*)::int from public.messages m where m.company_id=${companyId} and m.sent_at between ${from}::timestamptz and ${to}::timestamptz) as total_messages,
          (select count(*)::int from public.conversations c where c.company_id=${companyId} and c.status='closed' and c.ended_at between ${from}::timestamptz and ${to}::timestamptz) as closed,
          (select count(*)::int from public.contacts ct where ct.company_id=${companyId} and ct.created_at between ${from}::timestamptz and ${to}::timestamptz) as new_clients,
          (select count(*)::int from public.conversations c where c.company_id=${companyId} and c.status<>'closed' and c.started_at <= ${to}::timestamptz) as open_conversations,
          (select count(distinct m.contact_id)::int from public.messages m where m.company_id=${companyId} and m.sent_at between ${from}::timestamptz and ${to}::timestamptz) as active_clients,
          (select count(distinct coalesce(nullif(ct.country,''),'Sin país'))::int from public.messages m join public.contacts ct on ct.company_id=m.company_id and ct.id=m.contact_id where m.company_id=${companyId} and m.sent_at between ${from}::timestamptz and ${to}::timestamptz) as active_countries,
          (select round(count(*)::numeric / nullif(count(distinct m.conversation_id),0),1) from public.messages m where m.company_id=${companyId} and m.sent_at between ${from}::timestamptz and ${to}::timestamptz) as messages_per_conversation,
          (select round(avg(c.first_response_seconds))::int from public.conversations c where c.company_id=${companyId} and c.started_at between ${from}::timestamptz and ${to}::timestamptz) as average_first_response_seconds,
          (select round(avg(extract(epoch from (c.ended_at-c.started_at))/60),1) from public.conversations c where c.company_id=${companyId} and c.status='closed' and c.ended_at between ${from}::timestamptz and ${to}::timestamptz) as average_resolution_minutes,
          (select round(100.0*count(*) filter (where c.first_response_seconds <= 300)/nullif(count(*) filter (where c.first_response_seconds is not null),0),1) from public.conversations c where c.company_id=${companyId} and c.started_at between ${from}::timestamptz and ${to}::timestamptz) as sla_under_five_rate,
          (select count(*)::int from public.conversations c where c.company_id=${companyId} and c.agent_requested_at between ${from}::timestamptz and ${to}::timestamptz) as escalated_conversations,
          (select round(avg(c.rating),2) from public.conversations c where c.company_id=${companyId} and c.started_at between ${from}::timestamptz and ${to}::timestamptz) as average_rating,
          (select count(*)::int from public.messages m where m.company_id=${companyId} and m.sender='ai' and m.sent_at between ${from}::timestamptz and ${to}::timestamptz) as ai_messages
      `;
      const series = await db`
        select date_trunc('day', sent_at)::date::text as day, count(*)::int as messages
        from public.messages
        where company_id = ${companyId} and sent_at between ${from}::timestamptz and ${to}::timestamptz
        group by 1 order by 1
      `;
      const team = await db`
        select u.id::text,u.name,u.email,u.status,u.last_activity::text,
          (u.is_online and coalesce(u.last_activity,u.last_login) >= now() - interval '5 minutes') as is_online,
          count(c.id) filter (where c.assigned_user_id=u.id or c.closed_by_user_id=u.id)::int as handled_conversations,
          count(c.id) filter (where c.closed_by_user_id=u.id and c.status='closed')::int as closed_conversations,
          (select count(*)::int from public.conversations active where active.company_id=${companyId} and active.assigned_user_id=u.id and active.status<>'closed') as open_load,
          (select count(*)::int
            from public.messages sent
            join public.conversations sent_conversation
              on sent_conversation.company_id=sent.company_id and sent_conversation.id=sent.conversation_id
            where sent.company_id=${companyId} and sent.sender='agent'
              and sent.sent_at between ${from}::timestamptz and ${to}::timestamptz
              and (sent_conversation.assigned_user_id=u.id or sent_conversation.closed_by_user_id=u.id)
          ) as sent_messages,
          round(avg(c.first_response_seconds) filter (where c.assigned_user_id=u.id or c.closed_by_user_id=u.id))::int as average_first_response_seconds,
          round(avg(extract(epoch from (c.ended_at-c.started_at))/60) filter (where c.closed_by_user_id=u.id and c.ended_at is not null),1) as average_resolution_minutes,
          round(100.0*count(c.id) filter (where (c.assigned_user_id=u.id or c.closed_by_user_id=u.id) and c.first_response_seconds<=300)/nullif(count(c.id) filter (where (c.assigned_user_id=u.id or c.closed_by_user_id=u.id) and c.first_response_seconds is not null),0),1) as sla_under_five_rate
        from public.users u
        left join public.conversations c on c.company_id=u.company_id and c.started_at between ${from}::timestamptz and ${to}::timestamptz
        where u.company_id=${companyId} and u.role='agent'
        group by u.id order by handled_conversations desc,closed_conversations desc
      `;
      const countries = await db`
        select coalesce(nullif(ct.country,''),'Sin país') as country,count(distinct m.contact_id)::int as count
        from public.messages m join public.contacts ct on ct.company_id=m.company_id and ct.id=m.contact_id
        where m.company_id=${companyId} and m.sent_at between ${from}::timestamptz and ${to}::timestamptz
        group by 1 order by count desc,country limit 12
      `;
      const channels = await db`
        select channel,count(*)::int as count
        from public.messages
        where company_id=${companyId} and sent_at between ${from}::timestamptz and ${to}::timestamptz
        group by channel order by count desc,channel
      `;
      const topClients = await db`
        select ct.id::text,coalesce(nullif(ct.name,''),ct.phone_number) as name,ct.phone_number,count(m.id)::int as messages
        from public.messages m join public.contacts ct on ct.company_id=m.company_id and ct.id=m.contact_id
        where m.company_id=${companyId} and m.sent_at between ${from}::timestamptz and ${to}::timestamptz
        group by ct.id order by messages desc limit 10
      `;
      return { from, to, overview, series, countries, channels, topClients, team };
    });

    app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string; companyId?: string } }>('/reports/agents/:id/export', { preHandler: requireAuth(auth, ['admin', 'super_admin']) }, async (request, reply) => {
      const companyId = resolveCompanyScope(request, request.query.companyId);
      const userId = id(request.params.id);
      const to = request.query.to && !Number.isNaN(Date.parse(request.query.to)) ? request.query.to : new Date().toISOString();
      const from = request.query.from && !Number.isNaN(Date.parse(request.query.from)) ? request.query.from : new Date(Date.parse(to) - 30 * 86_400_000).toISOString();
      const [agent] = await db<{ id: string; name: string; email: string; status: boolean; last_activity: string | null }[]>`
        select id::text,name,email,status,last_activity::text from public.users
        where company_id=${companyId} and id=${userId} and role='agent' limit 1
      `;
      if (!agent) throw notFound('Agente no encontrado.');
      const [metrics] = await db<{
        handled_conversations: number; closed_conversations: number; sent_messages: number;
        average_first_response_minutes: number | null; average_resolution_minutes: number | null; sla_under_five_rate: number | null;
      }[]>`
        select
          count(c.id) filter (where c.assigned_user_id=${userId} or c.closed_by_user_id=${userId})::int as handled_conversations,
          count(c.id) filter (where c.closed_by_user_id=${userId} and c.status='closed')::int as closed_conversations,
          (select count(*)::int from public.messages m join public.conversations mc on mc.company_id=m.company_id and mc.id=m.conversation_id
            where m.company_id=${companyId} and m.sender='agent' and m.sent_at between ${from}::timestamptz and ${to}::timestamptz
              and (mc.assigned_user_id=${userId} or mc.closed_by_user_id=${userId})) as sent_messages,
          round((avg(c.first_response_seconds) filter (where c.assigned_user_id=${userId} or c.closed_by_user_id=${userId}))::numeric/60,1) as average_first_response_minutes,
          round(avg(extract(epoch from (c.ended_at-c.started_at))/60) filter (where c.closed_by_user_id=${userId} and c.ended_at is not null),1) as average_resolution_minutes,
          round(100.0*count(c.id) filter (where (c.assigned_user_id=${userId} or c.closed_by_user_id=${userId}) and c.first_response_seconds<=300)
            /nullif(count(c.id) filter (where (c.assigned_user_id=${userId} or c.closed_by_user_id=${userId}) and c.first_response_seconds is not null),0),1) as sla_under_five_rate
        from public.conversations c
        where c.company_id=${companyId} and c.started_at between ${from}::timestamptz and ${to}::timestamptz
      `;
      const closures = await db<{ contact_phone: string; started_at: string; ended_at: string; first_response_minutes: number | null; duration_minutes: number | null }[]>`
        select ct.phone_number as contact_phone,c.started_at::text,c.ended_at::text,
          round(c.first_response_seconds::numeric/60,1) as first_response_minutes,
          round(extract(epoch from (c.ended_at-c.started_at))/60,1) as duration_minutes
        from public.conversations c join public.contacts ct on ct.company_id=c.company_id and ct.id=c.contact_id
        where c.company_id=${companyId} and c.closed_by_user_id=${userId} and c.status='closed'
          and c.ended_at between ${from}::timestamptz and ${to}::timestamptz order by c.ended_at desc
      `;
      const document = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `Analíticas de ${agent.name}` } });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      const complete = new Promise<Buffer>((accept, reject) => { document.on('end', () => accept(Buffer.concat(chunks))); document.on('error', reject); });
      document.fontSize(20).fillColor('#25211f').text('Analíticas por agente · Grupo Movensa');
      document.moveDown(.3).fontSize(12).text(agent.name).fontSize(9).fillColor('#716a66').text(`${agent.email} · ${from.slice(0,10)} a ${to.slice(0,10)}`);
      document.moveDown(1.2).fontSize(10).fillColor('#25211f');
      const summary = [
        ['Conversaciones cerradas', metrics?.closed_conversations ?? 0], ['Conversaciones atendidas', metrics?.handled_conversations ?? 0],
        ['Mensajes enviados', metrics?.sent_messages ?? 0], ['Duración prom. (min)', metrics?.average_resolution_minutes ?? '—'],
        ['1ra respuesta prom. (min)', metrics?.average_first_response_minutes ?? '—'], ['SLA < 5 min', metrics?.sla_under_five_rate == null ? '—' : `${metrics.sla_under_five_rate}%`],
      ] as const;
      summary.forEach(([label, value], index) => document.text(`${label}: ${value}`, index % 2 === 0 ? 42 : 300, 130 + Math.floor(index / 2) * 20));
      document.fontSize(12).text('Conversaciones cerradas', 42, 205);
      document.fontSize(8).text('Teléfono',42,230).text('Inicio',130,230).text('Cierre',270,230).text('1ra resp.',410,230).text('Duración',475,230);
      document.moveTo(42,244).lineTo(553,244).strokeColor('#e8e4e0').stroke();
      let y=255;
      for (const row of closures) {
        if (y>750) { document.addPage(); y=55; }
        document.fontSize(7.5).fillColor('#25211f').text(row.contact_phone,42,y,{width:82}).text(row.started_at.slice(0,16).replace('T',' '),130,y,{width:132}).text(row.ended_at.slice(0,16).replace('T',' '),270,y,{width:132}).text(String(row.first_response_minutes ?? '—'),410,y,{width:55}).text(String(row.duration_minutes ?? '—'),475,y,{width:60});
        y+=18;
      }
      if (!closures.length) document.fontSize(9).fillColor('#716a66').text('No hay conversaciones cerradas en el periodo.',42,y);
      document.end();
      const buffer = await complete;
      return reply.header('content-type','application/pdf').header('content-disposition',`attachment; filename="movensa-agente-${userId}-${from.slice(0,10)}.pdf"`).send(buffer);
    });

    app.get<{ Querystring: { from?: string; to?: string; format?: string; companyId?: string } }>('/reports/export', { preHandler: requireAuth(auth, ['admin', 'super_admin']) }, async (request, reply) => {
      const companyId = resolveCompanyScope(request, request.query.companyId);
      const to = request.query.to && !Number.isNaN(Date.parse(request.query.to)) ? request.query.to : new Date().toISOString();
      const from = request.query.from && !Number.isNaN(Date.parse(request.query.from)) ? request.query.from : new Date(Date.parse(to) - 30 * 86_400_000).toISOString();
      const rows = await db<{ day: string; conversations: number; closed: number; messages: number }[]>`
        select date_trunc('day',c.started_at)::date::text as day,count(distinct c.id)::int as conversations,
          count(distinct c.id) filter (where c.status='closed')::int as closed,count(m.id)::int as messages
        from public.conversations c left join public.messages m on m.company_id=c.company_id and m.conversation_id=c.id
        where c.company_id=${companyId} and c.started_at between ${from}::timestamptz and ${to}::timestamptz
        group by 1 order by 1
      `;
      if (request.query.format === 'pdf') {
        const document = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Reporte Grupo Movensa' } });
        const chunks: Buffer[] = [];
        document.on('data', (chunk: Buffer) => chunks.push(chunk));
        const complete = new Promise<Buffer>((accept, reject) => { document.on('end', () => accept(Buffer.concat(chunks))); document.on('error', reject); });
        document.fontSize(22).fillColor('#25211f').text('Reporte de atención · Grupo Movensa');
        document.moveDown(.4).fontSize(10).fillColor('#716a66').text(`Periodo: ${from.slice(0,10)} a ${to.slice(0,10)}`);
        document.moveDown(1.5).fontSize(11).fillColor('#25211f');
        document.text('Fecha',48,145).text('Conversaciones',160,145).text('Cerradas',300,145).text('Mensajes',410,145);
        document.moveTo(48,162).lineTo(547,162).strokeColor('#e8e4e0').stroke();
        let y=174;
        for (const row of rows) { if (y>750) { document.addPage(); y=60; } document.fontSize(9).text(row.day,48,y).text(String(row.conversations),160,y).text(String(row.closed),300,y).text(String(row.messages),410,y); y+=21; }
        document.end();
        const buffer = await complete;
        return reply.header('content-type','application/pdf').header('content-disposition',`attachment; filename="movensa-reporte-${from.slice(0,10)}.pdf"`).send(buffer);
      }
      const escape = (raw: unknown) => `"${String(raw ?? '').replace(/"/g,'""')}"`;
      const csv = ['fecha,conversaciones,cerradas,mensajes',...rows.map((row)=>[row.day,row.conversations,row.closed,row.messages].map(escape).join(','))].join('\r\n');
      return reply.header('content-type','text/csv; charset=utf-8').header('content-disposition',`attachment; filename="movensa-reporte-${from.slice(0,10)}.csv"`).send(`\ufeff${csv}`);
    });
  };
}
