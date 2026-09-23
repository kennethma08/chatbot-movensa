import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { asJson, type Database } from '../database.js';
import { AppError, notFound } from '../errors.js';
import { decryptSecret, safeEqualText, sha256, verifyMetaSignature } from '../security/crypto.js';
import { executeFlow, type FlowEffect } from '../services/flow-engine.js';

interface Dependencies { db: Database; config: AppConfig }

const verificationQuery = z.object({
  'hub.mode': z.string(),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string(),
});

type IncomingMessage = {
  id: string;
  from: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  location?: { latitude?: number; longitude?: number; name?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; caption?: string; filename?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
};

function extractMessages(payload: unknown): Array<{ message: IncomingMessage; name?: string }> {
  if (!payload || typeof payload !== 'object') return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const result: Array<{ message: IncomingMessage; name?: string }> = [];
  for (const entry of entries) {
    const changes = entry && typeof entry === 'object' ? (entry as { changes?: unknown }).changes : undefined;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = change && typeof change === 'object' ? (change as { value?: unknown }).value : undefined;
      if (!value || typeof value !== 'object') continue;
      const block = value as { messages?: unknown; contacts?: Array<{ profile?: { name?: string } }> };
      if (!Array.isArray(block.messages)) continue;
      for (const message of block.messages) {
        if (message && typeof message === 'object') {
          const name = block.contacts?.[0]?.profile?.name;
          result.push({ message: message as IncomingMessage, ...(name ? { name } : {}) });
        }
      }
    }
  }
  return result.filter(({ message }) => Boolean(message.id && message.from));
}

function extractStatuses(payload: unknown): Array<{ id: string; status: string; recipient?: string; errorCode?: string }> {
  if (!payload || typeof payload !== 'object') return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const result: Array<{ id: string; status: string; recipient?: string; errorCode?: string }> = [];
  for (const entry of entries) {
    const changes = entry && typeof entry === 'object' ? (entry as { changes?: unknown }).changes : undefined;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const block = change && typeof change === 'object' ? (change as { value?: { statuses?: unknown } }).value : undefined;
      if (!Array.isArray(block?.statuses)) continue;
      for (const raw of block.statuses) {
        if (!raw || typeof raw !== 'object') continue;
        const status = raw as { id?: string; status?: string; recipient_id?: string; errors?: Array<{ code?: number }> };
        if (status.id && status.status) result.push({
          id: status.id,
          status: status.status,
          ...(status.recipient_id ? { recipient: status.recipient_id } : {}),
          ...(status.errors?.[0]?.code ? { errorCode: String(status.errors[0].code) } : {}),
        });
      }
    }
  }
  return result;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 18) throw new AppError(400, 'INVALID_PHONE', 'Número de teléfono inválido.');
  return `+${digits}`;
}

function messageBody(message: IncomingMessage): { text: string | null; type: string; latitude: number | null; longitude: number | null; locationName: string | null; mediaId?: string; fileName?: string } {
  if (message.type === 'text') return { text: message.text?.body?.slice(0, 4096) ?? '', type: 'text', latitude: null, longitude: null, locationName: null };
  if (message.type === 'location') return {
    text: message.location?.name ?? null,
    type: 'location',
    latitude: message.location?.latitude ?? null,
    longitude: message.location?.longitude ?? null,
    locationName: message.location?.name ?? null,
  };
  const media = message.type === 'image' ? message.image : message.type === 'document' ? message.document : message.type === 'audio' ? message.audio : undefined;
  return {
    text: message.type === 'image' ? message.image?.caption ?? null : message.type === 'document' ? message.document?.caption ?? null : null,
    type: ['image', 'document', 'audio'].includes(message.type ?? '') ? message.type! : 'system',
    latitude: null,
    longitude: null,
    locationName: null,
    ...(media?.id ? { mediaId: media.id } : {}),
    ...(message.type === 'document' && message.document?.filename ? { fileName: message.document.filename } : {}),
  };
}

function effectContent(effect: FlowEffect): { message: string | null; type: string; outbox: Record<string, unknown> } | null {
  if (effect.type === 'handoff') return null;
  if (effect.type === 'text') return { message: effect.text, type: 'text', outbox: { text: effect.text } };
  if (effect.type === 'template') return { message: `Plantilla: ${effect.name}`, type: 'template', outbox: effect };
  if (effect.type === 'location') return { message: effect.name ?? 'Ubicación', type: 'location', outbox: effect };
  return { message: effect.caption ?? effect.url, type: effect.mediaType, outbox: effect };
}

export function metaRoutes({ db, config }: Dependencies): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Params: { phoneNumberId: string } }>('/meta/webhook/:phoneNumberId', {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const query = verificationQuery.parse(request.query);
      const [integration] = await db<{ verify_token_hash: string | null }[]>`
        select verify_token_hash from public.integrations
        where phone_number_id = ${request.params.phoneNumberId} and provider = 'whatsapp_cloud' and is_active
        limit 1
      `;
      if (!integration?.verify_token_hash || query['hub.mode'] !== 'subscribe' || !safeEqualText(sha256(query['hub.verify_token']), integration.verify_token_hash)) {
        throw new AppError(403, 'WEBHOOK_VERIFICATION_FAILED', 'Verificación de webhook rechazada.');
      }
      return reply.type('text/plain').send(query['hub.challenge']);
    });

    app.post<{ Params: { phoneNumberId: string } }>('/meta/webhook/:phoneNumberId', {
      config: { rawBody: true, rateLimit: { max: 300, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const rawInput = request.rawBody;
      if (!rawInput) throw new AppError(400, 'RAW_BODY_REQUIRED', 'No se pudo validar el cuerpo del webhook.');
      const rawBody = typeof rawInput === 'string' ? Buffer.from(rawInput, 'utf8') : rawInput;
      const [integration] = await db<{
        id: string; company_id: string; app_secret_ciphertext: string | null;
      }[]>`
        select id::text, company_id::text, app_secret_ciphertext
        from public.integrations where phone_number_id = ${request.params.phoneNumberId}
          and provider = 'whatsapp_cloud' and is_active limit 1
      `;
      if (!integration?.app_secret_ciphertext) throw notFound('Integración no configurada.');
      const appSecret = decryptSecret(integration.app_secret_ciphertext, config.encryptionKey);
      if (!verifyMetaSignature(rawBody, request.headers['x-hub-signature-256'] as string | undefined, appSecret)) {
        throw new AppError(401, 'INVALID_META_SIGNATURE', 'La firma de Meta no es válida.');
      }

      const companyId = integration.company_id;
      const statuses = extractStatuses(request.body);
      for (const status of statuses) {
        await db`
          update public.outbox_messages set
            status = case when ${status.status} = 'failed' then 'failed' else status end,
            error_code = coalesce(${status.errorCode ?? null}, error_code),
            next_attempt_at = case when ${status.status} = 'failed' then now() + interval '30 seconds' else next_attempt_at end
          where company_id = ${companyId} and message_meta_id = ${status.id}
        `;
        await db`
          insert into public.company_whatsapp_events(company_id,event_type,source,success,to_phone_masked,phone_number_id,summary,detail)
          values (${companyId}, ${`delivery.${status.status}`}, 'meta_webhook', ${status.status !== 'failed'},
            ${status.recipient ? `***${status.recipient.slice(-4)}` : null}, ${request.params.phoneNumberId},
            ${`Estado ${status.status}`}, ${db.json(asJson({ messageId: status.id, errorCode: status.errorCode ?? null }))})
        `;
      }
      const items = extractMessages(request.body);
      for (const item of items) {
        await db.begin(async (tx) => {
          const inbound = messageBody(item.message);
          const phone = normalizePhone(item.message.from);
          const [receipt] = await tx`
            insert into public.received_messages(company_id, integration_id, message_meta_id, payload)
            values (${companyId}, ${integration.id}, ${item.message.id}, ${tx.json(asJson({
              id: item.message.id,
              from: phone,
              type: inbound.type,
              timestamp: item.message.timestamp ?? null,
              mediaId: inbound.mediaId ?? null,
            }))})
            on conflict (integration_id, message_meta_id) do nothing
            returning id
          `;
          if (!receipt) return;

          const [contact] = await tx<{ id: string }[]>`
            insert into public.contacts(company_id, name, phone_number, last_message_at)
            values (${companyId}, ${item.name?.slice(0, 160) ?? null}, ${phone}, now())
            on conflict (company_id, phone_number) do update set
              name = coalesce(excluded.name, public.contacts.name), last_message_at = now()
            returning id::text
          `;
          if (!contact) throw new Error('No se pudo resolver el contacto');
          const [conversation] = await tx<{ id: string }[]>`
            insert into public.conversations(company_id, contact_id, channel, status, last_activity_at)
            values (${companyId}, ${contact.id}, 'whatsapp', 'open', now())
            on conflict (company_id, contact_id, channel) where status <> 'closed'
            do update set last_activity_at = now()
            returning id::text
          `;
          if (!conversation) throw new Error('No se pudo resolver la conversación');
          const [savedMessage] = await tx<{ id: string }[]>`
            insert into public.messages(
              company_id, conversation_id, contact_id, sender, message, type, channel, external_message_id,
              latitude, longitude, location_name, sent_at
            ) values (
              ${companyId}, ${conversation.id}, ${contact.id}, 'contact', ${inbound.text}, ${inbound.type}, 'whatsapp',
              ${item.message.id}, ${inbound.latitude}, ${inbound.longitude}, ${inbound.locationName},
              ${item.message.timestamp ? new Date(Number(item.message.timestamp) * 1000).toISOString() : new Date().toISOString()}
            ) on conflict (company_id, external_message_id) do nothing returning id::text
          `;
          if (savedMessage) {
            await tx`update public.conversations set total_messages = total_messages + 1, last_activity_at = now() where company_id = ${companyId} and id = ${conversation.id}`;
            if (inbound.mediaId) {
              await tx`
                insert into public.automation_jobs(company_id,conversation_id,inbound_message_id,kind,payload)
                values (${companyId},${conversation.id},${savedMessage.id},'media_download',${tx.json(asJson({ mediaId: inbound.mediaId, fileName: inbound.fileName ?? null, type: inbound.type }))})
                on conflict (kind,inbound_message_id) where inbound_message_id is not null do nothing
              `;
            }
          }

          const [flow] = await tx<{ id: string; published: unknown }[]>`
            select id::text, published from public.whatsapp_bot_flows where company_id = ${companyId} and is_active and status = 'published' limit 1
          `;
          if (flow && savedMessage) {
            const [storedState] = await tx<{ current_node_id: string | null; status: 'active' | 'waiting' | 'completed' | 'failed'; variables: Record<string, string> }[]>`
              select current_node_id, status, variables from public.whatsapp_bot_execution_states
              where company_id = ${companyId} and conversation_id = ${conversation.id}
            `;
            const prior = storedState && storedState.status !== 'completed'
              ? { currentNodeId: storedState.current_node_id, status: storedState.status, variables: storedState.variables }
              : null;
            const result = executeFlow(flow.published, prior, inbound.text ?? undefined);
            await tx`
              insert into public.whatsapp_bot_execution_states(company_id, conversation_id, flow_id, current_node_id, status, variables, last_input_at)
              values (${companyId}, ${conversation.id}, ${flow.id}, ${result.state.currentNodeId}, ${result.state.status}, ${tx.json(asJson(result.state.variables))}, now())
              on conflict (company_id, conversation_id) do update set flow_id = excluded.flow_id, current_node_id = excluded.current_node_id,
                status = excluded.status, variables = excluded.variables, last_input_at = now()
            `;
            for (const effect of result.effects) {
              if (effect.type === 'handoff') {
                await tx`update public.conversations set status = 'waiting', agent_requested_at = now() where company_id = ${companyId} and id = ${conversation.id}`;
                continue;
              }
              const content = effectContent(effect);
              if (!content) continue;
              const [outgoingMessage] = await tx<{ id: string }[]>`
                insert into public.messages(company_id, conversation_id, contact_id, sender, message, type, channel)
                values (${companyId}, ${conversation.id}, ${contact.id}, 'bot', ${content.message}, ${content.type}, 'whatsapp')
                returning id::text
              `;
              await tx`
                insert into public.outbox_messages(
                  company_id, integration_id, conversation_id, idempotency_key, phone_number_id, recipient, type, content, next_attempt_at
                ) values (
                  ${companyId}, ${integration.id}, ${conversation.id}, ${randomUUID()}, ${request.params.phoneNumberId}, ${phone},
                  ${content.type}, ${tx.json(asJson({ ...content.outbox, messageId: outgoingMessage?.id }))}, now()
                )
              `;
            }
          } else if (savedMessage) {
            await tx`
              insert into public.automation_jobs(company_id, conversation_id, inbound_message_id, kind, payload)
              values (${companyId}, ${conversation.id}, ${savedMessage.id}, 'ai_response', ${tx.json(asJson({ phone }))})
              on conflict (kind, inbound_message_id) where inbound_message_id is not null do nothing
            `;
          }

          await tx`update public.received_messages set status = 'processed', processed_at = now() where id = ${receipt.id}`;
        });
      }
      return reply.code(200).send({ received: true });
    });
  };
}
