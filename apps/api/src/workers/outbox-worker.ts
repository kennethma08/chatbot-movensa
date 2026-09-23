import type { AppConfig } from '../config.js';
import type { Database } from '../database.js';
import { decryptSecret } from '../security/crypto.js';

interface OutboxJob {
  id: string;
  api_base_url: string;
  api_version: string;
  access_token_ciphertext: string;
  phone_number_id: string;
  recipient: string;
  type: string;
  content: Record<string, unknown>;
  attempts: number;
}

function graphPayload(job: OutboxJob): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: job.recipient.replace(/\D/g, '') };
  if (job.type === 'text') return { ...base, type: 'text', text: { preview_url: false, body: String(job.content.text ?? '') } };
  if (job.type === 'template') return {
    ...base,
    type: 'template',
    template: {
      name: job.content.name,
      language: { code: job.content.language ?? 'es' },
      components: [
        ...(job.content.headerMediaUrl ? [{ type: 'header', parameters: [{ type: String(job.content.headerFormat ?? 'image').toLowerCase(), [String(job.content.headerFormat ?? 'image').toLowerCase()]: { link: String(job.content.headerMediaUrl) } }] }] : []),
        ...(!job.content.headerMediaUrl && Array.isArray(job.content.headerParameters) && job.content.headerParameters.length ? [{ type: 'header', parameters: job.content.headerParameters.map((value) => ({ type: 'text', text: String(value) })) }] : []),
        ...(Array.isArray(job.content.parameters) && job.content.parameters.length ? [{ type: 'body', parameters: job.content.parameters.map((value) => ({ type: 'text', text: String(value) })) }] : []),
      ],
    },
  };
  if (job.type === 'location') return {
    ...base,
    type: 'location',
    location: { latitude: job.content.latitude, longitude: job.content.longitude, name: job.content.name },
  };
  if (['image', 'document', 'audio'].includes(job.type)) return {
    ...base,
    type: job.type,
    [job.type]: {
      link: job.content.url,
      ...(job.content.caption ? { caption: job.content.caption } : {}),
    },
  };
  throw new Error(`Tipo de outbox no compatible: ${job.type}`);
}

export function createOutboxWorker(db: Database, config: AppConfig, instanceId: string) {
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  async function claim(): Promise<OutboxJob | null> {
    return db.begin(async (tx) => {
      const [job] = await tx<OutboxJob[]>`
        select o.id::text, i.api_base_url, i.api_version, i.access_token_ciphertext,
          o.phone_number_id, o.recipient, o.type, o.content, o.attempts
        from public.outbox_messages o
        join public.integrations i on i.company_id = o.company_id and i.id = o.integration_id
        where o.status in ('pending','failed') and coalesce(o.next_attempt_at, now()) <= now()
          and i.is_active and i.access_token_ciphertext is not null
        order by o.created_at
        for update of o skip locked
        limit 1
      `;
      if (!job) return null;
      await tx`update public.outbox_messages set status = 'processing', attempts = attempts + 1, error_message = null where id = ${job.id}`;
      return job;
    });
  }

  async function processOne(): Promise<boolean> {
    const job = await claim();
    if (!job) return false;
    try {
      const token = decryptSecret(job.access_token_ciphertext, config.encryptionKey);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(`${job.api_base_url.replace(/\/$/, '')}/${job.api_version}/${job.phone_number_id}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(graphPayload(job)),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      const body = await response.json().catch(() => ({})) as { messages?: Array<{ id?: string }>; error?: { code?: number; message?: string } };
      if (!response.ok) throw new Error(`META_${body.error?.code ?? response.status}:${body.error?.message ?? 'request failed'}`);
      await db`
        update public.outbox_messages set status = 'sent', sent_at = now(), message_meta_id = ${body.messages?.[0]?.id ?? null},
          error_code = null, error_message = null
        where id = ${job.id}
      `;
      return true;
    } catch (error) {
      const attempt = job.attempts + 1;
      const dead = attempt >= 7;
      const delaySeconds = Math.min(900, 2 ** attempt * 5);
      const summary = error instanceof Error ? error.message.slice(0, 500) : 'UNKNOWN_ERROR';
      await db`
        update public.outbox_messages set status = ${dead ? 'dead_letter' : 'failed'},
          next_attempt_at = ${dead ? null : new Date(Date.now() + delaySeconds * 1000).toISOString()},
          error_code = ${summary.split(':')[0] ?? 'SEND_FAILED'}, error_message = ${summary}
        where id = ${job.id}
      `;
      return true;
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      for (let index = 0; index < 20; index += 1) {
        if (!(await processOne())) break;
      }
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), 2_000);
      timer.unref();
      void tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    tick,
    instanceId,
  };
}
