import { createHash, randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { publicMessageSchema, webchatStartSchema } from '../../../../packages/shared/src/index.js';
import { z } from 'zod';
import { asJson, type Database } from '../database.js';
import type { AppConfig } from '../config.js';
import { AppError, notFound } from '../errors.js';
import { createOpaqueToken, sha256 } from '../security/crypto.js';
import { executeFlow } from '../services/flow-engine.js';

interface Dependencies { db: Database; config: AppConfig }
const bootstrapSchema = z.object({ activationKey: z.string().min(20).max(255), origin: z.url() });
const requestAgentSchema = z.object({
  visitor: z.object({
    name: z.string().trim().min(1).max(160),
    email: z.email().max(320).optional().or(z.literal('')),
    phone: z.string().trim().max(40).optional().or(z.literal('')),
  }).optional(),
});

function originHost(origin: string): string {
  return new URL(origin).hostname.toLowerCase().replace(/\.$/, '');
}

function assertBrowserOrigin(headerOrigin: string | undefined, bodyOrigin: string): void {
  if (headerOrigin && new URL(headerOrigin).origin !== new URL(bodyOrigin).origin) {
    throw new AppError(403, 'WEBCHAT_ORIGIN_MISMATCH', 'El origen de la solicitud no coincide con el dominio declarado.');
  }
}

export function domainAllowed(host: string, allowed: string[]): boolean {
  if (!allowed.length) return false;
  return allowed.some((rule) => {
    const candidate = rule.toLowerCase().trim();
    const wildcard = candidate.startsWith('*.');
    const withoutWildcard = wildcard ? candidate.slice(2) : candidate;
    let normalized: string;
    try {
      const parsed = new URL(/^https?:\/\//i.test(withoutWildcard) ? withoutWildcard : `http://${withoutWildcard}`);
      normalized = parsed.hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      return false;
    }
    if (wildcard) normalized = `*.${normalized}`;
    return normalized === host || (normalized.startsWith('*.') && host.endsWith(normalized.slice(1)) && host !== normalized.slice(2));
  });
}

async function resolveInstallation(db: Database, activationKey: string, origin: string) {
  const hash = sha256(activationKey);
  const [installation] = await db<{
    id: string; company_id: string; widget_id: string; allowed_domains: string[]; widget: Record<string, unknown>;
  }[]>`
    select k.id::text, k.company_id::text, k.widget_id::text, k.allowed_domains,
      jsonb_build_object(
        'name', w.name, 'primaryColor', w.primary_color, 'accentColor', w.accent_color,
        'backgroundColor', w.background_color, 'textColor', w.text_color, 'fontFamily', w.font_family,
        'position', w.position, 'headerTitle', w.header_title, 'welcomeText', w.welcome_text,
        'placeholderText', w.placeholder_text, 'bubbleText', w.bubble_text, 'brandText', w.brand_text,
        'showBranding', w.show_branding, 'allowFreeText', w.allow_free_text, 'allowLiveChat', w.allow_live_chat,
        'borderRadius', w.border_radius, 'launcherIcon', w.launcher_icon, 'content', w.content,
        'conversationEmptyImage', w.conversation_empty_image
      ) as widget
    from public.webchatbot_installation_keys k
    join public.webchatbot_widgets w on w.company_id = k.company_id and w.id = k.widget_id
    join public.companies c on c.id = k.company_id
    where k.activation_key_hash = ${hash} and k.is_active and w.is_active and c.is_enabled
    limit 1
  `;
  if (!installation || !domainAllowed(originHost(origin), installation.allowed_domains)) {
    throw new AppError(403, 'WEBCHAT_ORIGIN_FORBIDDEN', 'La instalación no está habilitada para este dominio.');
  }
  return installation;
}

async function signedStorageUrl(config: AppConfig, path: string, expiresIn = 60): Promise<string> {
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

export function webchatRoutes({ db, config }: Dependencies): FastifyPluginAsync {
  return async (app) => {
    app.post('/public/webchat/bootstrap', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
      const input = bootstrapSchema.parse(request.body);
      assertBrowserOrigin(request.headers.origin, input.origin);
      const installation = await resolveInstallation(db, input.activationKey, input.origin);
      await db`update public.webchatbot_installation_keys set last_used_at = now() where id = ${installation.id}`;
      return { widget: installation.widget, capabilities: { attachments: true, audio: true, liveChat: true } };
    });

    app.post('/public/webchat/sessions', { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (request, reply) => {
      const input = webchatStartSchema.parse(request.body);
      assertBrowserOrigin(request.headers.origin, input.origin);
      const installation = await resolveInstallation(db, input.activationKey, input.origin);
      const sessionKey = createOpaqueToken();
      const [flow] = await db<{ id: string; published: unknown }[]>`
        select f.id::text, f.published from public.webchatbot_widgets w
        join public.webchatbot_flows f on f.company_id = w.company_id and f.id = w.active_flow_id and f.status = 'published'
        where w.company_id = ${installation.company_id} and w.id = ${installation.widget_id}
      `;
      const [session] = await db<{ id: string }[]>`
        insert into public.webchatbot_sessions(
          company_id, widget_id, installation_key_id, flow_id, public_session_key_hash, public_session_key_prefix,
          origin_domain, page_url, referrer_url, visitor_name, visitor_email, visitor_phone, last_activity_at
        ) values (
          ${installation.company_id}, ${installation.widget_id}, ${installation.id}, ${flow?.id ?? null}, ${sha256(sessionKey)},
          ${sessionKey.slice(0, 8)}, ${originHost(input.origin)}, ${input.pageUrl ?? null}, ${input.referrerUrl ?? null},
          ${input.visitor.name ?? null}, ${input.visitor.email ?? null}, ${input.visitor.phone ?? null}, now()
        ) returning id::text
      `;
      if (!session) throw new AppError(500, 'SESSION_CREATE_FAILED', 'No se pudo iniciar el chat.');
      if (flow) {
        const result = executeFlow(flow.published, null);
        for (const effect of result.effects) {
          if (effect.type === 'text') {
            await db`insert into public.webchatbot_messages(company_id, session_id, sender, message_type, content) values (${installation.company_id}, ${session.id}, 'bot', 'text', ${effect.text})`;
          } else if (effect.type !== 'handoff') {
            await db`insert into public.webchatbot_messages(company_id, session_id, sender, message_type, content, payload) values (${installation.company_id}, ${session.id}, 'bot', ${effect.type === 'media' ? effect.mediaType : effect.type}, ${effect.type === 'template' ? effect.name : effect.type === 'location' ? effect.name ?? 'Ubicación' : null}, ${db.json(asJson(effect))})`;
          }
        }
        await db`update public.webchatbot_sessions set current_node_key = ${result.state.currentNodeId}, metadata = ${db.json(asJson({ flowState: result.state }))} where id = ${session.id}`;
      }
      return reply.code(201).send({ sessionKey, messages: await db`select id::text, sender, message_type, content, payload, created_at::text from public.webchatbot_messages where session_id = ${session.id} order by id` });
    });

    app.get<{ Params: { sessionKey: string }; Querystring: { after?: string } }>('/public/webchat/sessions/:sessionKey/messages', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
      const [session] = await db<{ id: string; company_id: string; status: string }[]>`select id::text, company_id::text, status from public.webchatbot_sessions where public_session_key_hash = ${sha256(request.params.sessionKey)}`;
      if (!session) throw notFound('Sesión no encontrada.');
      const after = request.query.after && /^\d+$/.test(request.query.after) ? request.query.after : '0';
      return {
        status: session.status,
        messages: await db`select id::text, sender, message_type, content, payload, created_at::text from public.webchatbot_messages where company_id = ${session.company_id} and session_id = ${session.id} and id > ${after} order by id limit 200`,
      };
    });

    app.post('/public/webchat/messages', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      const input = publicMessageSchema.parse(request.body);
      const response = await db.begin(async (tx) => {
        const [session] = await tx<{
          id: string; company_id: string; flow_id: string | null; current_node_key: string | null;
          metadata: { flowState?: unknown }; visitor_name: string | null; visitor_email: string | null; visitor_phone: string | null;
          live_chat_conversation_id: string | null;
        }[]>`
          select id::text, company_id::text, flow_id::text, current_node_key, metadata, visitor_name, visitor_email, visitor_phone,
            live_chat_conversation_id::text
          from public.webchatbot_sessions where public_session_key_hash = ${sha256(input.sessionKey)} and status <> 'closed' for update
        `;
        if (!session) throw notFound('Sesión no encontrada o cerrada.');
        const [visitorMessage] = await tx<{ id: string }[]>`
          insert into public.webchatbot_messages(company_id, session_id, sender, client_message_id, message_type, content)
          values (${session.company_id}, ${session.id}, 'visitor', ${input.clientMessageId}, 'text', ${input.text})
          on conflict (session_id, client_message_id) do nothing returning id::text
        `;
        if (!visitorMessage) return { duplicate: true, messages: [] };

        let conversationId = session.live_chat_conversation_id;
        if (!conversationId) {
          const internalPhone = session.visitor_phone?.trim() || `web:${session.id}`;
          const [contact] = await tx<{ id: string }[]>`
            insert into public.contacts(company_id, name, phone_number, last_message_at)
            values (${session.company_id}, ${session.visitor_name ?? session.visitor_email ?? 'Visitante web'}, ${internalPhone}, now())
            on conflict (company_id, phone_number) do update set last_message_at = now() returning id::text
          `;
          const [conversation] = await tx<{ id: string }[]>`
            insert into public.conversations(company_id, contact_id, channel, external_thread_key, status, last_activity_at)
            values (${session.company_id}, ${contact!.id}, 'webchat', ${session.id}, 'open', now())
            on conflict (company_id, contact_id, channel) where status <> 'closed' do update set last_activity_at = now() returning id::text
          `;
          conversationId = conversation!.id;
          await tx`update public.webchatbot_sessions set live_chat_conversation_id = ${conversationId} where id = ${session.id}`;
        }
        const [contactLink] = await tx<{ contact_id: string }[]>`select contact_id::text from public.conversations where company_id = ${session.company_id} and id = ${conversationId}`;
        const [mirrored] = await tx<{ id: string }[]>`
          insert into public.messages(company_id, conversation_id, contact_id, sender, message, type, channel)
          values (${session.company_id}, ${conversationId}, ${contactLink!.contact_id}, 'contact', ${input.text}, 'text', 'webchat') returning id::text
        `;
        await tx`update public.conversations set total_messages = total_messages + 1, last_activity_at = now() where company_id = ${session.company_id} and id = ${conversationId}`;

        let generated = false;
        if (session.flow_id) {
          const [flow] = await tx<{ published: unknown }[]>`select published from public.webchatbot_flows where company_id = ${session.company_id} and id = ${session.flow_id} and status = 'published'`;
          if (flow) {
            const previous = session.metadata?.flowState as Parameters<typeof executeFlow>[1] | undefined;
            const result = executeFlow(flow.published, previous ?? null, input.text);
            generated = result.effects.length > 0;
            for (const effect of result.effects) {
              if (effect.type === 'handoff') {
                await tx`update public.webchatbot_sessions set status = 'waiting_agent', live_chat_requested = true, live_chat_requested_at = now() where id = ${session.id}`;
                await tx`update public.conversations set status = 'waiting', agent_requested_at = now() where company_id = ${session.company_id} and id = ${conversationId}`;
              } else {
                const content = effect.type === 'text' ? effect.text : effect.type === 'template' ? effect.name : effect.type === 'location' ? effect.name ?? 'Ubicación' : effect.caption ?? effect.url;
                const messageType = effect.type === 'media' ? effect.mediaType : effect.type;
                await tx`insert into public.webchatbot_messages(company_id, session_id, conversation_id, sender, message_type, content, payload) values (${session.company_id}, ${session.id}, ${conversationId}, 'bot', ${messageType}, ${content}, ${tx.json(asJson(effect))})`;
                await tx`insert into public.messages(company_id, conversation_id, contact_id, sender, message, type, channel) values (${session.company_id}, ${conversationId}, ${contactLink!.contact_id}, 'bot', ${content}, ${messageType}, 'webchat')`;
              }
            }
            await tx`update public.webchatbot_sessions set current_node_key = ${result.state.currentNodeId}, metadata = metadata || ${tx.json(asJson({ flowState: result.state }))}, last_activity_at = now() where id = ${session.id}`;
          }
        }
        if (!generated) {
          await tx`insert into public.automation_jobs(company_id, conversation_id, inbound_message_id, kind, payload) values (${session.company_id}, ${conversationId}, ${mirrored!.id}, 'ai_response', ${tx.json(asJson({ sessionId: session.id }))}) on conflict (kind, inbound_message_id) where inbound_message_id is not null do nothing`;
        }
        const messages = await tx`select id::text, sender, message_type, content, payload, created_at::text from public.webchatbot_messages where company_id = ${session.company_id} and session_id = ${session.id} and id >= ${visitorMessage.id} order by id`;
        return { duplicate: false, messages };
      });
      return reply.code(201).send(response);
    });

    app.post<{ Params: { sessionKey: string } }>('/public/webchat/sessions/:sessionKey/attachments', { config: { rateLimit: { max: 12, timeWindow: '5 minutes' } } }, async (request, reply) => {
      const part = await request.file();
      if (!part) throw new AppError(400, 'FILE_REQUIRED', 'Selecciona un archivo.');
      const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','audio/mpeg','audio/ogg','audio/webm','audio/mp4','audio/wav']);
      if (!allowed.has(part.mimetype)) throw new AppError(415, 'FILE_TYPE_NOT_ALLOWED', 'El tipo de archivo no está permitido.');
      const bytes = await part.toBuffer();
      const safeName = part.filename.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 180) || 'archivo';
      const relationship = await db.begin(async (tx) => {
        const [session] = await tx<{
          id: string; company_id: string; visitor_name: string | null; visitor_email: string | null;
          visitor_phone: string | null; live_chat_conversation_id: string | null;
        }[]>`
          select id::text,company_id::text,visitor_name,visitor_email,visitor_phone,live_chat_conversation_id::text
          from public.webchatbot_sessions where public_session_key_hash=${sha256(request.params.sessionKey)} and status<>'closed' for update
        `;
        if (!session) throw notFound('Sesión no encontrada o cerrada.');
        let conversationId = session.live_chat_conversation_id;
        if (!conversationId) {
          const internalPhone = session.visitor_phone?.trim() || `web:${session.id}`;
          const [contact] = await tx<{ id: string }[]>`
            insert into public.contacts(company_id,name,phone_number,last_message_at)
            values (${session.company_id},${session.visitor_name ?? session.visitor_email ?? 'Visitante web'},${internalPhone},now())
            on conflict(company_id,phone_number) do update set last_message_at=now() returning id::text
          `;
          const [conversation] = await tx<{ id: string }[]>`
            insert into public.conversations(company_id,contact_id,channel,external_thread_key,status,last_activity_at)
            values (${session.company_id},${contact!.id},'webchat',${session.id},'open',now())
            on conflict(company_id,contact_id,channel) where status<>'closed' do update set last_activity_at=now() returning id::text
          `;
          conversationId = conversation!.id;
          await tx`update public.webchatbot_sessions set live_chat_conversation_id=${conversationId},last_activity_at=now() where id=${session.id}`;
        }
        const [conversation] = await tx<{ contact_id: string }[]>`select contact_id::text from public.conversations where company_id=${session.company_id} and id=${conversationId}`;
        return { sessionId: session.id, companyId: session.company_id, conversationId: conversationId!, contactId: conversation!.contact_id };
      });
      const storagePath = `${relationship.companyId}/${relationship.conversationId}/web-${randomUUID()}-${safeName}`;
      const upload = await fetch(`${config.supabaseUrl}/storage/v1/object/chat-attachments/${encodeURIComponent(storagePath).replace(/%2F/g, '/')}`, {
        method: 'POST',
        headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': part.mimetype, 'x-upsert': 'false' },
        body: new Uint8Array(bytes),
      });
      if (!upload.ok) throw new AppError(502, 'STORAGE_UPLOAD_FAILED', 'No se pudo guardar el archivo.');
      const messageType = part.mimetype.startsWith('image/') ? 'image' : part.mimetype.startsWith('audio/') ? 'audio' : 'document';
      const webchatMessage = await db.begin(async (tx) => {
        const [message] = await tx<{ id: string }[]>`
          insert into public.messages(company_id,conversation_id,contact_id,sender,message,type,channel)
          values (${relationship.companyId},${relationship.conversationId},${relationship.contactId},'contact',${safeName},${messageType},'webchat') returning id::text
        `;
        const [attachment] = await tx<{ id: string }[]>`
          insert into public.attachments(company_id,message_id,file_name,mime_type,size_bytes,storage_path,sha256)
          values (${relationship.companyId},${message!.id},${safeName},${part.mimetype},${bytes.length},${storagePath},${createHash('sha256').update(bytes).digest('hex')}) returning id::text
        `;
        const [webMessage] = await tx`
          insert into public.webchatbot_messages(company_id,session_id,conversation_id,sender,message_type,content,payload)
          values (${relationship.companyId},${relationship.sessionId},${relationship.conversationId},'visitor',${messageType},${safeName},${tx.json(asJson({ attachmentId: attachment!.id, fileName: safeName, mimeType: part.mimetype, sizeBytes: bytes.length }))})
          returning id::text,sender,message_type,content,payload,created_at::text
        `;
        await tx`update public.conversations set total_messages=total_messages+1,last_activity_at=now() where company_id=${relationship.companyId} and id=${relationship.conversationId}`;
        return webMessage;
      });
      return reply.code(201).send(webchatMessage);
    });

    app.get<{ Params: { sessionKey: string; attachmentId: string } }>('/public/webchat/sessions/:sessionKey/attachments/:attachmentId', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
      if (!/^\d+$/.test(request.params.attachmentId)) throw notFound('Archivo no encontrado.');
      const [attachment] = await db<{ storage_path: string }[]>`
        select a.storage_path from public.attachments a
        join public.messages m on m.company_id=a.company_id and m.id=a.message_id
        join public.webchatbot_sessions s on s.company_id=m.company_id and s.live_chat_conversation_id=m.conversation_id
        where s.public_session_key_hash=${sha256(request.params.sessionKey)} and a.id=${request.params.attachmentId}
        limit 1
      `;
      if (!attachment) throw notFound('Archivo no encontrado.');
      return reply.redirect(await signedStorageUrl(config, attachment.storage_path));
    });

    app.post<{ Params: { sessionKey: string } }>('/public/webchat/sessions/:sessionKey/request-agent', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (request) => {
      const input = requestAgentSchema.parse(request.body ?? {});
      return db.begin(async (tx) => {
        const [session] = await tx<{
          id: string; company_id: string; live_chat_conversation_id: string | null;
          visitor_name: string | null; visitor_email: string | null; visitor_phone: string | null;
        }[]>`
          select id::text,company_id::text,live_chat_conversation_id::text,visitor_name,visitor_email,visitor_phone
          from public.webchatbot_sessions where public_session_key_hash=${sha256(request.params.sessionKey)} and status<>'closed' for update
        `;
        if (!session) throw notFound('Sesión no encontrada.');
        const visitor = {
          name: input.visitor?.name || session.visitor_name || 'Visitante web',
          email: input.visitor?.email || session.visitor_email || null,
          phone: input.visitor?.phone || session.visitor_phone || null,
        };
        await tx`
          update public.webchatbot_sessions set status='waiting_agent',live_chat_requested=true,
            live_chat_requested_at=coalesce(live_chat_requested_at,now()),last_activity_at=now(),
            visitor_name=${visitor.name},visitor_email=${visitor.email},visitor_phone=${visitor.phone}
          where id=${session.id}
        `;
        let conversationId = session.live_chat_conversation_id;
        if (!conversationId) {
          const internalPhone = visitor.phone?.trim() || `web:${session.id}`;
          const [contact] = await tx<{ id: string }[]>`
            insert into public.contacts(company_id,name,phone_number,last_message_at)
            values (${session.company_id},${visitor.name},${internalPhone},now())
            on conflict(company_id,phone_number) do update set name=excluded.name,last_message_at=now() returning id::text
          `;
          const [conversation] = await tx<{ id: string }[]>`
            insert into public.conversations(company_id,contact_id,channel,external_thread_key,status,agent_requested_at,last_activity_at)
            values (${session.company_id},${contact!.id},'webchat',${session.id},'waiting',now(),now())
            on conflict(company_id,contact_id,channel) where status<>'closed' do update set status='waiting',agent_requested_at=now(),last_activity_at=now() returning id::text
          `;
          conversationId = conversation!.id;
          await tx`update public.webchatbot_sessions set live_chat_conversation_id=${conversationId} where id=${session.id}`;
        } else {
          await tx`update public.conversations set status='waiting',agent_requested_at=now(),last_activity_at=now() where company_id=${session.company_id} and id=${conversationId}`;
          await tx`update public.contacts set name=${visitor.name} where company_id=${session.company_id} and id=(select contact_id from public.conversations where company_id=${session.company_id} and id=${conversationId})`;
        }
        return { requested: true, conversationId };
      });
    });
  };
}
