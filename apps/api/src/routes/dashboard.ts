import type { FastifyPluginAsync } from 'fastify';
import type { AuthService } from '../auth.js';
import { requireAuth, requireCompany } from '../auth.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../database.js';
import { loadAdminOverview } from '../services/admin-overview.js';

interface Dependencies {
  auth: AuthService;
  db: Database;
  config: AppConfig;
}

async function signedAvatarUrl(config: AppConfig, path: string): Promise<string | null> {
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/sign/profile-avatars/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'POST',
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { signedURL?: string; signedUrl?: string };
  const signed = payload.signedURL ?? payload.signedUrl;
  return signed ? (signed.startsWith('http') ? signed : `${config.supabaseUrl}/storage/v1${signed}`) : null;
}

export function dashboardRoutes({ auth, db, config }: Dependencies): FastifyPluginAsync {
  return async (app) => {
    app.get('/session', { preHandler: requireAuth(auth) }, async (request) => {
      const [profile] = await db<{ name: string; email: string; phone: string | null; company_name: string | null; avatar_file_name: string | null; avatar_updated_at: string | null }[]>`
        select u.name,u.email,u.phone,c.name as company_name,u.avatar_file_name,u.avatar_updated_at::text
        from public.users u left join public.companies c on c.id=u.company_id where u.id=${request.session.userId}
      `;
      return {
        authUserId: request.session.authUserId,
        userId: request.session.userId.toString(),
        companyId: request.session.companyId?.toString() ?? null,
        role: request.session.role,
        name: profile?.name ?? request.session.name,
        email: profile?.email ?? request.session.email,
        phone: profile?.phone ?? null,
        companyName: profile?.company_name ?? null,
        avatarUrl: profile?.avatar_file_name ? await signedAvatarUrl(config, profile.avatar_file_name) : null,
      };
    });

    app.post('/session/presence', { preHandler: requireAuth(auth) }, async (request, reply) => {
      await db`update public.users set is_online=true,last_activity=now() where id=${request.session.userId}`;
      return reply.code(204).send();
    });

    app.post('/session/sign-out', { preHandler: requireAuth(auth) }, async (request, reply) => {
      await db.begin(async (tx) => {
        await tx`update public.users set is_online=false,last_activity=now() where id=${request.session.userId}`;
        await tx`insert into public.user_session_events(user_id,company_id,role,event_type,success,user_name,email,ip_address) values (${request.session.userId},${request.session.companyId},${request.session.role},'logout',true,${request.session.name},${request.session.email},${request.ip}::inet)`;
      });
      return reply.code(204).send();
    });

    app.get('/dashboard', { preHandler: requireAuth(auth) }, async (request) => {
      if (request.session.role === 'super_admin') {
        const overview = await loadAdminOverview(db);
        return { mode: 'super_admin', ...overview.summary, alerts: overview.alerts.slice(0, 4), recentActivities: overview.recentActivities.slice(0, 4) };
      }

      const companyId = requireCompany(request);
      const [summary] = await db<{
        total_conversations: number;
        new_clients_24h: number;
        total_messages: number;
        open_conversations: number;
        waiting_conversations: number;
        online_agents: number;
        contacts_today: number;
        average_first_response_seconds: number | null;
        ai_messages_today: number;
      }[]>`
        select
          (select count(*)::int from public.conversations c where c.company_id = ${companyId}) as total_conversations,
          (select count(*)::int from public.contacts ct where ct.company_id = ${companyId} and ct.created_at >= now() - interval '24 hours') as new_clients_24h,
          (select count(*)::int from public.messages m where m.company_id = ${companyId}) as total_messages,
          count(*) filter (where c.status = 'open')::int as open_conversations,
          count(*) filter (where c.status = 'waiting')::int as waiting_conversations,
          (select count(*)::int from public.users u where u.company_id = ${companyId} and u.role = 'agent' and u.status and u.is_online) as online_agents,
          (select count(*)::int from public.contacts ct where ct.company_id = ${companyId} and ct.created_at >= date_trunc('day', now())) as contacts_today,
          round(avg(c.first_response_seconds))::int as average_first_response_seconds,
          (select count(*)::int from public.messages m where m.company_id = ${companyId} and m.sender = 'ai' and m.sent_at >= date_trunc('day', now())) as ai_messages_today
        from public.conversations c
        where c.company_id = ${companyId}
      `;
      const monthlyMessages = await db<{ month: string; count: number }[]>`
        with months as (
          select generate_series(
            date_trunc('month', now()) - interval '11 months',
            date_trunc('month', now()),
            interval '1 month'
          ) as month_start
        )
        select to_char(months.month_start, 'YYYY-MM') as month, count(m.id)::int as count
        from months
        left join public.messages m
          on m.company_id = ${companyId}
         and m.sent_at >= months.month_start
         and m.sent_at < months.month_start + interval '1 month'
        group by months.month_start
        order by months.month_start
      `;
      const channels = await db<{ channel: 'whatsapp' | 'webchat'; count: number }[]>`
        select channel, count(*)::int as count
        from public.messages
        where company_id = ${companyId}
        group by channel
        order by count desc, channel
      `;
      const activity = await db<{ id: string; type: 'new_client' | 'conv_closed'; label: string; detail: string; at: string }[]>`
        select activity.id, activity.type, activity.label, activity.detail, activity.at::text
        from (
          select ct.id::text as id, 'new_client'::text as type,
            'Nuevo cliente'::text as label,
            coalesce(nullif(ct.name, ''), ct.phone_number) as detail,
            ct.created_at as at
          from public.contacts ct
          where ct.company_id = ${companyId} and ct.created_at >= now() - interval '7 days'
          union all
          select c.id::text as id, 'conv_closed'::text as type,
            'Conversación cerrada'::text as label,
            coalesce(nullif(ct.name, ''), ct.phone_number) || ' · ' || case when c.channel = 'webchat' then 'Webchat' else 'WhatsApp' end as detail,
            coalesce(c.ended_at, c.last_activity_at, c.started_at) as at
          from public.conversations c
          join public.contacts ct on ct.company_id = c.company_id and ct.id = c.contact_id
          where c.company_id = ${companyId} and c.status = 'closed'
            and coalesce(c.ended_at, c.last_activity_at, c.started_at) >= now() - interval '7 days'
        ) activity
        order by activity.at desc
        limit 10
      `;
      return {
        mode: 'tenant',
        totalConversations: summary?.total_conversations ?? 0,
        newClients24h: summary?.new_clients_24h ?? 0,
        totalMessages: summary?.total_messages ?? 0,
        openConversations: summary?.open_conversations ?? 0,
        waitingConversations: summary?.waiting_conversations ?? 0,
        onlineAgents: summary?.online_agents ?? 0,
        contactsToday: summary?.contacts_today ?? 0,
        averageFirstResponseSeconds: summary?.average_first_response_seconds ?? null,
        aiMessagesToday: summary?.ai_messages_today ?? 0,
        monthlyMessages,
        messagesByChannel: channels,
        recentActivity: activity,
      };
    });
  };
}
