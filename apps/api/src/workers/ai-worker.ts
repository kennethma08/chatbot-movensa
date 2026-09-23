import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { asJson, type Database } from '../database.js';
import { decryptSecret } from '../security/crypto.js';

interface AiJob {
  id: string;
  company_id: string;
  conversation_id: string;
  inbound_message_id: string | null;
  attempts: number;
  payload: { phone?: string };
}

export interface AiSettings {
  is_enabled: boolean;
  provider: 'openai' | 'deepseek' | 'gemini';
  model: string;
  api_key_ciphertext: string | null;
  api_base_url: string | null;
  response_mode: 'disabled' | 'always' | 'outside_business_hours' | 'unassigned_only';
  system_prompt: string | null;
  fallback_message: string | null;
  temperature: number;
  max_tokens: number;
  daily_message_limit: number | null;
  monthly_message_limit: number | null;
  pause_when_assigned: boolean;
  escalate_on_human_request: boolean;
}

function asksForHuman(text: string): boolean {
  return /\b(agente|asesor|persona|humano|operador|representante|human|agent)\b/i.test(text);
}

function localMinuteAndDay(timeZone: string): { minute: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minute: hour * 60 + minute, day: dayMap[weekday] ?? 1 };
}

function isBusinessOpen(company: { time_zone: string; business_hours_start: string | null; business_hours_end: string | null; business_days: number[] }): boolean {
  if (!company.business_hours_start || !company.business_hours_end) return false;
  const current = localMinuteAndDay(company.time_zone);
  const parse = (raw: string) => {
    const [hour = '0', minute = '0'] = raw.split(':');
    return Number(hour) * 60 + Number(minute);
  };
  return company.business_days.includes(current.day) && current.minute >= parse(company.business_hours_start) && current.minute < parse(company.business_hours_end);
}

export async function callAiProvider(settings: AiSettings, key: string, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  const started = Date.now();
  try {
    if (settings.provider === 'gemini') {
      const base = (settings.api_base_url ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
      const response = await fetch(`${base}/models/${encodeURIComponent(settings.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: messages.find((message) => message.role === 'system')?.content ?? '' }] },
          contents: messages.filter((message) => message.role !== 'system').map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }],
          })),
          generationConfig: { temperature: settings.temperature, maxOutputTokens: settings.max_tokens },
        }),
        signal: controller.signal,
      });
      const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? `Gemini HTTP ${response.status}`);
      return {
        text: body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? '',
        promptTokens: body.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: body.usageMetadata?.totalTokenCount ?? 0,
        durationMs: Date.now() - started,
      };
    }
    const defaultBase = settings.provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1';
    const response = await fetch(`${(settings.api_base_url ?? defaultBase).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: settings.model, messages, temperature: settings.temperature, max_tokens: settings.max_tokens }),
      signal: controller.signal,
    });
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? `Proveedor IA HTTP ${response.status}`);
    return {
      text: body.choices?.[0]?.message?.content?.trim() ?? '',
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      totalTokens: body.usage?.total_tokens ?? 0,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createAiWorker(db: Database, config: AppConfig, instanceId: string) {
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  async function claim(): Promise<AiJob | null> {
    return db.begin(async (tx) => {
      const [job] = await tx<AiJob[]>`
        select id::text, company_id::text, conversation_id::text, inbound_message_id::text, attempts, payload
        from public.automation_jobs
        where kind = 'ai_response' and status in ('pending','failed') and next_attempt_at <= now()
        order by created_at for update skip locked limit 1
      `;
      if (!job) return null;
      await tx`update public.automation_jobs set status = 'processing', attempts = attempts + 1, locked_at = now(), locked_by = ${instanceId} where id = ${job.id}`;
      return job;
    });
  }

  async function finish(jobId: string, status: 'completed' | 'failed' | 'dead_letter', errorCode?: string, attempts = 0) {
    const retryAt = status === 'failed' ? new Date(Date.now() + Math.min(900, 2 ** attempts * 10) * 1000).toISOString() : null;
    await db`update public.automation_jobs set status = ${status}, error_code = ${errorCode ?? null}, next_attempt_at = coalesce(${retryAt}, next_attempt_at), locked_at = null, locked_by = null where id = ${jobId}`;
  }

  async function processOne(): Promise<boolean> {
    const job = await claim();
    if (!job) return false;
    const companyId = job.company_id;
    const conversationId = job.conversation_id;
    try {
      const [settings] = await db<AiSettings[]>`select * from public.company_ai_settings where company_id = ${companyId}`;
      const [conversation] = await db<{
        contact_id: string; assigned_user_id: string | null; status: string; channel: string;
        time_zone: string; business_hours_start: string | null; business_hours_end: string | null; business_days: number[];
      }[]>`
        select c.contact_id::text, c.assigned_user_id::text, c.status, c.channel, co.time_zone,
          co.business_hours_start::text, co.business_hours_end::text, co.business_days
        from public.conversations c join public.companies co on co.id = c.company_id
        where c.company_id = ${companyId} and c.id = ${conversationId}
      `;
      if (!settings?.is_enabled || !settings.api_key_ciphertext || !conversation || conversation.status === 'closed') {
        await finish(job.id, 'completed'); return true;
      }
      const inboundRows = await db<{ message: string | null }[]>`
        select message from public.messages where company_id = ${companyId} and id = ${job.inbound_message_id} limit 1
      `;
      const inboundText = inboundRows[0]?.message ?? '';
      if (settings.escalate_on_human_request && asksForHuman(inboundText)) {
        await db`update public.conversations set status = 'waiting', agent_requested_at = now() where company_id = ${companyId} and id = ${conversationId}`;
        await db`
          insert into public.ai_conversation_logs(company_id, conversation_id, inbound_message_id, decision, success, escalated_to_human)
          values (${companyId}, ${conversationId}, ${job.inbound_message_id}, 'human_requested', true, true)
        `;
        await finish(job.id, 'completed'); return true;
      }
      if (settings.pause_when_assigned && conversation.assigned_user_id) { await finish(job.id, 'completed'); return true; }
      if (settings.response_mode === 'disabled' || (settings.response_mode === 'outside_business_hours' && isBusinessOpen(conversation))) {
        await finish(job.id, 'completed'); return true;
      }
      if (settings.response_mode === 'unassigned_only' && conversation.assigned_user_id) { await finish(job.id, 'completed'); return true; }

      const [limits] = await db<{ daily: number; monthly: number }[]>`
        select count(*) filter (where created_at >= date_trunc('day', now()) and success)::int as daily,
          count(*) filter (where created_at >= date_trunc('month', now()) and success)::int as monthly
        from public.ai_usage_logs where company_id = ${companyId}
      `;
      if ((settings.daily_message_limit && (limits?.daily ?? 0) >= settings.daily_message_limit) ||
          (settings.monthly_message_limit && (limits?.monthly ?? 0) >= settings.monthly_message_limit)) {
        await finish(job.id, 'completed'); return true;
      }

      const history = await db<{ sender: string; message: string | null }[]>`
        select sender, message from public.messages
        where company_id = ${companyId} and conversation_id = ${conversationId} and message is not null
        order by sent_at desc, id desc limit 16
      `;
      const knowledge = await db<{ title: string; content: string }[]>`
        select title, content from public.company_ai_knowledge_items
        where company_id = ${companyId} and is_active order by updated_at desc nulls last, id limit 30
      `;
      const system = [
        settings.system_prompt ?? 'Eres un asistente de servicio al cliente. Responde con precisión, brevedad y honestidad.',
        'No inventes datos. Si falta información o el cliente pide una persona, indica que transferirás la conversación.',
        knowledge.length ? `Conocimiento autorizado:\n${knowledge.map((item) => `# ${item.title}\n${item.content}`).join('\n\n').slice(0, 30_000)}` : '',
      ].filter(Boolean).join('\n\n');
      const messages = [
        { role: 'system' as const, content: system },
        ...history.reverse().map((message) => ({
          role: message.sender === 'contact' ? 'user' as const : 'assistant' as const,
          content: message.message ?? '',
        })),
      ];
      const result = await callAiProvider(settings, decryptSecret(settings.api_key_ciphertext, config.encryptionKey), messages);
      const answer = result.text || settings.fallback_message || 'No pude responder en este momento. Te comunicaré con un agente.';

      await db.begin(async (tx) => {
        const [outbound] = await tx<{ id: string }[]>`
          insert into public.messages(company_id, conversation_id, contact_id, sender, message, type, channel)
          values (${companyId}, ${conversationId}, ${conversation.contact_id}, 'ai', ${answer}, 'text', ${conversation.channel}) returning id::text
        `;
        const [integration] = await tx<{ id: string; phone_number_id: string }[]>`
          select id::text, phone_number_id from public.integrations where company_id = ${companyId} and provider = 'whatsapp_cloud' and is_active limit 1
        `;
        if (conversation.channel === 'whatsapp' && integration && job.payload.phone) {
          await tx`
            insert into public.outbox_messages(company_id, integration_id, conversation_id, idempotency_key, phone_number_id, recipient, type, content, next_attempt_at)
            values (${companyId}, ${integration.id}, ${conversationId}, ${randomUUID()}, ${integration.phone_number_id}, ${job.payload.phone}, 'text', ${tx.json(asJson({ text: answer, messageId: outbound?.id }))}, now())
          `;
        } else if (conversation.channel === 'webchat') {
          const [session] = await tx<{ id: string }[]>`select id::text from public.webchatbot_sessions where company_id=${companyId} and live_chat_conversation_id=${conversationId} and status<>'closed' order by id desc limit 1`;
          if (session) await tx`insert into public.webchatbot_messages(company_id,session_id,conversation_id,sender,message_type,content) values (${companyId},${session.id},${conversationId},'ai','text',${answer})`;
        }
        await tx`
          insert into public.ai_usage_logs(company_id, conversation_id, message_id, provider, model, prompt_tokens, completion_tokens, total_tokens, success, duration_ms, reason)
          values (${companyId}, ${conversationId}, ${outbound?.id ?? null}, ${settings.provider}, ${settings.model}, ${result.promptTokens}, ${result.completionTokens}, ${result.totalTokens}, true, ${result.durationMs}, 'inbound_response')
        `;
        await tx`
          insert into public.ai_conversation_logs(company_id, conversation_id, inbound_message_id, outbound_message_id, provider, model, response_mode, decision, response_text, success)
          values (${companyId}, ${conversationId}, ${job.inbound_message_id}, ${outbound?.id ?? null}, ${settings.provider}, ${settings.model}, ${settings.response_mode}, 'responded', ${answer.slice(0, 4000)}, true)
        `;
        await tx`update public.conversations set total_messages = total_messages + 1, ai_messages = ai_messages + 1, last_activity_at = now() where company_id = ${companyId} and id = ${conversationId}`;
      });
      await finish(job.id, 'completed');
      return true;
    } catch (error) {
      const summary = error instanceof Error ? error.name : 'AI_FAILED';
      await db`
        insert into public.ai_usage_logs(company_id, conversation_id, provider, model, success, error_code, reason)
        select ${companyId}, ${conversationId}, coalesce(provider, 'unknown'), coalesce(model, 'unknown'), false, ${summary}, 'worker_error'
        from public.company_ai_settings where company_id = ${companyId}
      `;
      await finish(job.id, job.attempts + 1 >= 5 ? 'dead_letter' : 'failed', summary, job.attempts + 1);
      return true;
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      for (let index = 0; index < 5; index += 1) if (!(await processOne())) break;
    } finally { running = false; }
  }

  return {
    start() { if (!timer) { timer = setInterval(() => void tick(), 3_000); timer.unref(); void tick(); } },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
    tick,
  };
}
