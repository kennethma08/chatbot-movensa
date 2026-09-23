import type { FastifyPluginAsync } from 'fastify';
import {
  assignConversationSchema,
  conversationListQuerySchema,
  sendMessageSchema,
} from '../../../../packages/shared/src/index.js';
import type { MessageView } from '../../../../packages/shared/src/index.js';
import type { AuthService } from '../auth.js';
import { requireAuth, resolveCompanyScope } from '../auth.js';
import { asJson, type Database } from '../database.js';
import { AppError, conflict, forbidden, notFound } from '../errors.js';
import { registerAudit } from '../services/audit.js';
import type { AppConfig } from '../config.js';
import { randomUUID } from 'node:crypto';

interface Dependencies { auth: AuthService; db: Database; config: AppConfig }

type RawMessageRow = {
  id: string;
  conversation_id: string;
  sender: MessageView['sender'];
  message: string | null;
  type: MessageView['type'];
  channel: MessageView['channel'];
  sent_at: string;
  attachment: MessageView['attachment'] | null;
};

function parseId(raw: string): string {
  if (!/^\d+$/.test(raw)) throw new AppError(400, 'INVALID_ID', 'Identificador inválido.');
  return raw;
}

function companyScope(request: import('fastify').FastifyRequest): string {
  return resolveCompanyScope(request, (request.query as { companyId?: string }).companyId);
}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ at, id }), 'utf8').toString('base64url');
}

function decodeCursor(raw?: string): { at: string; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { at?: string; id?: string };
    if (!parsed.at || !parsed.id || !/^\d+$/.test(parsed.id) || Number.isNaN(Date.parse(parsed.at))) return null;
    return { at: parsed.at, id: parsed.id };
  } catch {
    return null;
  }
}

async function signedStorageUrl(config: AppConfig, path: string, expiresIn = 3600): Promise<string> {
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/sign/chat-attachments/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'POST',
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  const payload = await response.json() as { signedURL?: string; signedUrl?: string };
  const signed = payload.signedURL ?? payload.signedUrl;
  if (!response.ok || !signed) throw new AppError(502, 'STORAGE_SIGN_FAILED', 'No se pudo preparar el archivo.');
  return signed.startsWith('http') ? signed : `${config.supabaseUrl}/storage/v1${signed}`;
}

export function conversationRoutes({ auth, db, config }: Dependencies): FastifyPluginAsync {
  return async (app) => {
    app.get('/conversations', { preHandler: requireAuth(auth) }, async (request) => {
      const companyId = companyScope(request);
      const query = conversationListQuerySchema.parse(request.query);
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && !cursor) throw new AppError(400, 'INVALID_CURSOR', 'Cursor inválido.');

      const statusFilter = query.status === 'all' ? db`` : db`and c.status = ${query.status}`;
      const channelFilter = query.channel === 'all' ? db`` : db`and c.channel = ${query.channel}`;
      const assignmentFilter = query.assignment === 'mine'
        ? db`and c.assigned_user_id = ${request.session.userId}`
        : query.assignment === 'unassigned' ? db`and c.assigned_user_id is null` : db``;
      const searchFilter = query.search
        ? db`and (ct.name ilike ${`%${query.search}%`} or ct.phone_number ilike ${`%${query.search}%`})`
        : db``;
      const cursorFilter = cursor
        ? db`and (coalesce(c.last_activity_at, c.started_at), c.id) < (${cursor.at}::timestamptz, ${cursor.id})`
        : db``;
      const visibilityFilter = request.session.role === 'agent'
        ? db`and (c.assigned_user_id is null or c.assigned_user_id = ${request.session.userId})`
        : db``;

      const rows = await db<{
        id: string; contact_id: string; contact_name: string | null; phone_number: string; country: string | null;
        contact_status: 'active' | 'blocked' | 'archived'; contact_last_message_at: string | null;
        channel: 'whatsapp' | 'webchat'; status: 'open' | 'waiting' | 'closed'; assigned_user_id: string | null;
        assigned_user_name: string | null; last_activity_at: string; last_message: string | null; agent_requested: boolean;
      }[]>`
        select c.id::text, ct.id::text as contact_id, ct.name as contact_name, ct.phone_number, ct.country,
          ct.status as contact_status, ct.last_message_at::text as contact_last_message_at,
          c.channel, c.status, c.assigned_user_id::text, u.name as assigned_user_name,
          coalesce(c.last_activity_at, c.started_at)::text as last_activity_at,
          (select m.message from public.messages m where m.company_id = c.company_id and m.conversation_id = c.id order by m.sent_at desc, m.id desc limit 1) as last_message,
          (c.agent_requested_at is not null) as agent_requested
        from public.conversations c
        join public.contacts ct on ct.company_id = c.company_id and ct.id = c.contact_id
        left join public.users u on u.company_id = c.company_id and u.id = c.assigned_user_id
        where c.company_id = ${companyId}
          ${statusFilter} ${channelFilter} ${assignmentFilter} ${searchFilter} ${cursorFilter} ${visibilityFilter}
        order by coalesce(c.last_activity_at, c.started_at) desc, c.id desc
        limit ${query.limit + 1}
      `;
      const hasMore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);
      const last = pageRows.at(-1);
      return {
        items: pageRows.map((row) => ({
          id: row.id,
          contact: {
            id: row.contact_id,
            name: row.contact_name,
            phoneNumber: row.phone_number,
            country: row.country,
            status: row.contact_status,
            lastMessageAt: row.contact_last_message_at,
          },
          channel: row.channel,
          status: row.status,
          assignedUserId: row.assigned_user_id,
          assignedUserName: row.assigned_user_name,
          lastActivityAt: row.last_activity_at,
          lastMessage: row.last_message,
          unreadCount: 0,
          agentRequested: row.agent_requested,
        })),
        nextCursor: hasMore && last ? encodeCursor(last.last_activity_at, last.id) : null,
      };
    });

    app.get<{ Params: { id: string } }>('/conversations/:id', { preHandler: requireAuth(auth) }, async (request) => {
      const companyId = companyScope(request);
      const id = parseId(request.params.id);
      const rows = await db`
        select c.*, ct.name as contact_name, ct.phone_number, ct.country, u.name as assigned_user_name
        from public.conversations c
        join public.contacts ct on ct.company_id = c.company_id and ct.id = c.contact_id
        left join public.users u on u.company_id = c.company_id and u.id = c.assigned_user_id
        where c.company_id = ${companyId} and c.id = ${id}
          and (${request.session.role !== 'agent'} or c.assigned_user_id is null or c.assigned_user_id = ${request.session.userId})
        limit 1
      `;
      if (!rows[0]) throw notFound('Conversación no encontrada.');
      return rows[0];
    });

    app.get<{ Params: { id: string }; Querystring: { after?: string; companyId?: string } }>('/conversations/:id/messages', { preHandler: requireAuth(auth) }, async (request) => {
      const companyId = companyScope(request);
      const id = parseId(request.params.id);
      const after = request.query.after && /^\d+$/.test(request.query.after) ? request.query.after : '0';
      const visible = await db`
        select 1 from public.conversations c where c.company_id = ${companyId} and c.id = ${id}
          and (${request.session.role !== 'agent'} or c.assigned_user_id is null or c.assigned_user_id = ${request.session.userId})
      `;
      if (!visible[0]) throw notFound('Conversación no encontrada.');
      const messages = await db<RawMessageRow[]>`
        select m.id::text, m.conversation_id::text, m.sender, m.message, m.type, m.channel, m.sent_at::text,
          case when a.id is null then null else jsonb_build_object(
            'id', a.id::text, 'fileName', a.file_name, 'mimeType', a.mime_type,
            'sizeBytes', a.size_bytes, 'downloadUrl', '/v1/attachments/' || a.id::text
          ) end as attachment
        from public.messages m
        left join lateral (
          select * from public.attachments x where x.company_id = m.company_id and x.message_id = m.id order by x.id limit 1
        ) a on true
        where m.company_id = ${companyId} and m.conversation_id = ${id} and m.id > ${after}
        order by m.sent_at, m.id
        limit 200
      `;
      return messages.map((message): MessageView => ({
        id: message.id,
        conversationId: message.conversation_id,
        sender: message.sender,
        message: message.message,
        type: message.type,
        channel: message.channel,
        sentAt: message.sent_at,
        ...(message.attachment ? { attachment: message.attachment } : {}),
      }));
    });

    app.post<{ Params: { id: string } }>('/conversations/:id/claim', { preHandler: requireAuth(auth) }, async (request) => {
      const companyId = companyScope(request);
      const id = parseId(request.params.id);
      const rows = await db`
        update public.conversations set
          assigned_user_id = ${request.session.userId}, assigned_by_user_id = ${request.session.userId},
          assigned_at = now(), status = case when status = 'waiting' then 'open' else status end
        where company_id = ${companyId} and id = ${id} and status <> 'closed'
          and (assigned_user_id is null or assigned_user_id = ${request.session.userId})
        returning *
      `;
      if (!rows[0]) throw conflict('La conversación ya fue tomada por otro agente o está cerrada.');
      return rows[0];
    });

    app.post<{ Params: { id: string } }>('/conversations/:id/assign', { preHandler: requireAuth(auth, ['admin', 'super_admin']) }, async (request) => {
      const companyId = companyScope(request);
      const id = parseId(request.params.id);
      const input = assignConversationSchema.parse(request.body);
      if (input.userId !== null) {
        const agent = await db`select 1 from public.users where company_id = ${companyId} and id = ${input.userId} and role in ('agent','admin') and status`;
        if (!agent[0]) throw notFound('Agente no encontrado.');
      }
      const rows = await db`
        update public.conversations set assigned_user_id = ${input.userId}, assigned_by_user_id = ${request.session.userId},
          assigned_at = case when ${input.userId}::bigint is null then null else now() end
        where company_id = ${companyId} and id = ${id} and status <> 'closed'
        returning *
      `;
      if (!rows[0]) throw notFound('Conversación no encontrada o cerrada.');
      await registerAudit(db, request, companyId, 'conversation.assigned', { conversationId: id.toString(), userId: input.userId?.toString() ?? null });
      return rows[0];
    });

    app.post<{ Params: { id: string } }>('/conversations/:id/release', { preHandler: requireAuth(auth) }, async (request) => {
      const companyId = companyScope(request);
      const id = parseId(request.params.id);
      const canReleaseAny = request.session.role !== 'agent';
      const rows = await db`
        update public.conversations set assigned_user_id = null, assigned_by_user_id = ${request.session.userId}, assigned_at = null
        where company_id = ${companyId} and id = ${id} and status <> 'closed'
          and (${canReleaseAny} or assigned_user_id = ${request.session.userId})
        returning *
      `;
      if (!rows[0]) throw forbidden('No puedes liberar esta conversación.');
      return rows[0];
    });

    app.post<{ Params: { id: string } }>('/conversations/:id/close', { preHandler: requireAuth(auth) }, async (request) => {
      const companyId = companyScope(request);
      const id = parseId(request.params.id);
      const result = await db.begin(async (tx) => {
        const rows = await tx<{ contact_id: string; channel: string; status: string; farewell: string | null }[]>`
          select c.contact_id::text, c.channel, c.status, co.agent_farewell_message as farewell
          from public.conversations c join public.companies co on co.id = c.company_id
          where c.company_id = ${companyId} and c.id = ${id}
            and (${request.session.role !== 'agent'} or c.assigned_user_id = ${request.session.userId})
          for update
        `;
        const conversation = rows[0];
        if (!conversation) throw notFound('Conversación no encontrada.');
        if (conversation.status === 'closed') throw conflict('La conversación ya está cerrada.');
        if (conversation.farewell?.trim()) {
          await tx`
            insert into public.messages(company_id, conversation_id, contact_id, sender, message, type, channel)
            values (${companyId}, ${id}, ${conversation.contact_id}, 'agent', ${conversation.farewell.trim()}, 'text', ${conversation.channel})
          `;
        }
        const [closed] = await tx`
          update public.conversations set status = 'closed', ended_at = now(), closed_by_user_id = ${request.session.userId}, last_activity_at = now()
          where company_id = ${companyId} and id = ${id} returning *
        `;
        if (conversation.channel === 'webchat') {
          await tx`update public.webchatbot_sessions set status='closed', ended_at=now(), last_activity_at=now() where company_id=${companyId} and live_chat_conversation_id=${id} and status<>'closed'`;
        }
        return closed;
      });
      await registerAudit(db, request, companyId, 'conversation.closed', { conversationId: id.toString() });
      return result;
    });

    app.post<{ Params: { id: string } }>('/conversations/:id/messages', { preHandler: requireAuth(auth) }, async (request) => {
      const companyId = companyScope(request);
      const id = parseId(request.params.id);
      const input = sendMessageSchema.parse(request.body);
      return db.begin(async (tx) => {
        const rows = await tx<{ contact_id: string; phone_number: string; channel: string; assigned_user_id: string | null }[]>`
          select c.contact_id::text, ct.phone_number, c.channel, c.assigned_user_id::text
          from public.conversations c join public.contacts ct on ct.company_id = c.company_id and ct.id = c.contact_id
          where c.company_id = ${companyId} and c.id = ${id} and c.status <> 'closed'
          for update of c
        `;
        const conversation = rows[0];
        if (!conversation) throw notFound('Conversación no encontrada o cerrada.');
        if (request.session.role === 'agent' && conversation.assigned_user_id && conversation.assigned_user_id !== request.session.userId.toString()) {
          throw forbidden('La conversación está asignada a otro agente.');
        }
        const [message] = await tx`
          insert into public.messages(company_id, conversation_id, contact_id, sender, message, type, channel)
          values (${companyId}, ${id}, ${conversation.contact_id}, 'agent', ${input.text}, 'text', ${conversation.channel})
          returning id::text, message, sender, type, channel, sent_at::text
        `;
        if (conversation.channel === 'whatsapp') {
          const integrations = await tx<{ id: string; phone_number_id: string }[]>`
            select id::text, phone_number_id from public.integrations
            where company_id = ${companyId} and provider = 'whatsapp_cloud' and is_active limit 1
          `;
          const integration = integrations[0];
          if (!integration) throw conflict('La integración de WhatsApp no está activa.');
          await tx`
            insert into public.outbox_messages(
              company_id, integration_id, conversation_id, idempotency_key, phone_number_id, recipient, type, content, next_attempt_at
            ) values (
              ${companyId}, ${integration.id}, ${id}, ${input.idempotencyKey}, ${integration.phone_number_id},
              ${conversation.phone_number}, 'text', ${tx.json(asJson({ text: input.text, messageId: message?.id }))}, now()
            )
            on conflict (company_id, idempotency_key) do nothing
          `;
        }
        if (conversation.channel === 'webchat') {
          const [session] = await tx<{ id: string }[]>`select id::text from public.webchatbot_sessions where company_id = ${companyId} and live_chat_conversation_id = ${id} and status <> 'closed' limit 1`;
          if (session) await tx`insert into public.webchatbot_messages(company_id, session_id, conversation_id, sender, message_type, content) values (${companyId}, ${session.id}, ${id}, 'agent', 'text', ${input.text})`;
        }
        await tx`
          update public.conversations set assigned_user_id = coalesce(assigned_user_id, ${request.session.userId}),
            assigned_at = coalesce(assigned_at, now()), total_messages = total_messages + 1, last_activity_at = now()
          where company_id = ${companyId} and id = ${id}
        `;
        return message;
      });
    });

    app.post<{ Params: { id: string } }>('/conversations/:id/attachments', { preHandler: requireAuth(auth) }, async (request, reply) => {
      const companyId = companyScope(request);
      const conversationId = parseId(request.params.id);
      const part = await request.file();
      if (!part) throw new AppError(400, 'FILE_REQUIRED', 'Selecciona un archivo.');
      const allowed = new Set(['image/jpeg','image/png','image/webp','application/pdf','audio/mpeg','audio/mp3','audio/ogg','audio/webm','audio/mp4','audio/aac','audio/x-m4a']);
      if (!allowed.has(part.mimetype)) throw new AppError(415, 'FILE_TYPE_NOT_ALLOWED', 'El tipo de archivo no está permitido.');
      const bytes = await part.toBuffer();
      const safeName = part.filename.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 180) || 'archivo';
      const rows = await db<{ contact_id: string; phone_number: string; channel: string }[]>`
        select c.contact_id::text, ct.phone_number, c.channel
        from public.conversations c join public.contacts ct on ct.company_id=c.company_id and ct.id=c.contact_id
        where c.company_id=${companyId} and c.id=${conversationId} and c.status<>'closed'
          and (${request.session.role !== 'agent'} or c.assigned_user_id is null or c.assigned_user_id=${request.session.userId})
      `;
      const conversation = rows[0];
      if (!conversation) throw notFound('Conversación no encontrada o cerrada.');
      const storagePath = `${companyId}/${conversationId}/${randomUUID()}-${safeName}`;
      const upload = await fetch(`${config.supabaseUrl}/storage/v1/object/chat-attachments/${encodeURIComponent(storagePath).replace(/%2F/g, '/')}`, {
        method: 'POST',
        headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': part.mimetype, 'x-upsert': 'false' },
        body: new Uint8Array(bytes),
      });
      if (!upload.ok) throw new AppError(502, 'STORAGE_UPLOAD_FAILED', 'No se pudo guardar el archivo.');
      const messageType = part.mimetype.startsWith('image/') ? 'image' : part.mimetype.startsWith('audio/') ? 'audio' : 'document';
      const result = await db.begin(async (tx) => {
        const [message] = await tx<{ id: string }[]>`
          insert into public.messages(company_id,conversation_id,contact_id,sender,message,type,channel)
          values (${companyId},${conversationId},${conversation.contact_id},'agent',${safeName},${messageType},${conversation.channel}) returning id::text
        `;
        const [attachment] = await tx`
          insert into public.attachments(company_id,message_id,file_name,mime_type,size_bytes,storage_path)
          values (${companyId},${message!.id},${safeName},${part.mimetype},${bytes.length},${storagePath}) returning id::text,file_name,mime_type,size_bytes
        `;
        if (conversation.channel === 'whatsapp') {
          const [integration] = await tx<{ id: string; phone_number_id: string }[]>`select id::text,phone_number_id from public.integrations where company_id=${companyId} and provider='whatsapp_cloud' and is_active limit 1`;
          if (!integration) throw conflict('La integración de WhatsApp no está activa.');
          const url = await signedStorageUrl(config, storagePath);
          await tx`insert into public.outbox_messages(company_id,integration_id,conversation_id,idempotency_key,phone_number_id,recipient,type,content,next_attempt_at) values (${companyId},${integration.id},${conversationId},${randomUUID()},${integration.phone_number_id},${conversation.phone_number},${messageType},${tx.json(asJson({ url, caption: safeName, messageId: message!.id }))},now())`;
        } else {
          const [session] = await tx<{ id: string }[]>`select id::text from public.webchatbot_sessions where company_id=${companyId} and live_chat_conversation_id=${conversationId} and status<>'closed' limit 1`;
          if (session) await tx`insert into public.webchatbot_messages(company_id,session_id,conversation_id,sender,message_type,content,payload) values (${companyId},${session.id},${conversationId},'agent',${messageType},${safeName},${tx.json(asJson({ attachmentId: attachment?.id }))})`;
        }
        await tx`update public.conversations set total_messages=total_messages+1,last_activity_at=now() where company_id=${companyId} and id=${conversationId}`;
        return { messageId: message!.id, attachment };
      });
      return reply.code(201).send(result);
    });

    app.get<{ Params: { id: string } }>('/attachments/:id', { preHandler: requireAuth(auth) }, async (request, reply) => {
      const companyId = companyScope(request);
      const [attachment] = await db<{ storage_path: string }[]>`
        select a.storage_path from public.attachments a
        join public.messages m on m.company_id=a.company_id and m.id=a.message_id
        join public.conversations c on c.company_id=m.company_id and c.id=m.conversation_id
        where a.company_id=${companyId} and a.id=${parseId(request.params.id)}
          and (${request.session.role !== 'agent'} or c.assigned_user_id is null or c.assigned_user_id=${request.session.userId})
      `;
      if (!attachment) throw notFound('Archivo no encontrado.');
      return reply.redirect(await signedStorageUrl(config, attachment.storage_path, 60));
    });
  };
}
