import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { dataDirectory, readNdjson, type JsonRow } from './io.js';
import { importOrder, type SourceTable } from './tables.js';
import { normalizeFlowDocument, normalizeInstallType, normalizeWidgetPosition } from './transformers.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Define DATABASE_URL para el PostgreSQL/Supabase de destino.');
const db = postgres(databaseUrl, { max: 4, prepare: false });
const inputDir = dataDirectory();
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseSecret = process.env.SUPABASE_SECRET_KEY;

function value(row: JsonRow, key: string): unknown { return row[key]; }
function text(row: JsonRow, key: string): string | null { const item = value(row, key); return item === null || item === undefined || String(item).trim() === '' ? null : String(item); }
function numberValue(row: JsonRow, key: string): number | null { const item = value(row, key); return item === null || item === undefined ? null : Number(item); }
function booleanValue(row: JsonRow, key: string, fallback = false): boolean { const item = value(row, key); return item === null || item === undefined ? fallback : Boolean(item); }
function csv(raw: string | null): string[] { return raw?.split(',').map((item) => item.trim()).filter(Boolean) ?? []; }
function json(raw: unknown, fallback: unknown): unknown {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}
function timeFromMinutes(raw: number | null): string | null {
  if (raw === null || raw < 0 || raw > 1439) return null;
  return `${String(Math.floor(raw / 60)).padStart(2, '0')}:${String(raw % 60).padStart(2, '0')}:00`;
}
function withoutUndefined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, item]) => item !== undefined));
}
function base(row: JsonRow, keys: string[]) { return Object.fromEntries(keys.map((key) => [key, row[key]]).filter(([, item]) => item !== undefined)); }
function roleFromName(name: string | null): 'super_admin' | 'admin' | 'agent' {
  const normalized = name?.toLocaleLowerCase().replace(/[^a-z]/g, '') ?? '';
  return normalized.includes('super') ? 'super_admin' : normalized.includes('admin') ? 'admin' : 'agent';
}
function normalizeStatus(raw: string | null, allowed: string[], fallback: string): string { const status = raw?.toLocaleLowerCase() ?? ''; return allowed.includes(status) ? status : fallback; }

const sourceProfiles = await readNdjson(resolve(inputDir, 'profiles.ndjson'));
const profileRoles = new Map(sourceProfiles.map((row) => [String(row.id), roleFromName(text(row, 'name'))]));
const sourceUsers = await readNdjson(resolve(inputDir, 'users.ndjson'));
const tenantUserKeys = new Set(sourceUsers
  .filter((row) => row.company_id !== null && row.company_id !== undefined)
  .map((row) => `${row.company_id}:${row.id}`));
const sourceIntegrations = await readNdjson(resolve(inputDir, 'integrations.ndjson'));
const integrationByCompany = new Map(sourceIntegrations.map((row) => [String(row.company_id), row.id]));

async function uploadAttachment(row: JsonRow): Promise<{ storagePath: string; sha256: string | null }> {
  const data = row.data;
  const existing = text(row, 'storage_path');
  if (!Buffer.isBuffer(data)) return { storagePath: existing ?? `legacy/missing/${row.id}`, sha256: null };
  if (!supabaseUrl || !supabaseSecret) throw new Error('Los adjuntos binarios requieren SUPABASE_URL y SUPABASE_SECRET_KEY.');
  const safeName = (text(row, 'file_name') ?? `attachment-${row.id}`).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 180);
  const path = `${row.company_id}/${row.message_id}/${row.id}-${safeName}`;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/chat-attachments/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${supabaseSecret}`, apikey: supabaseSecret, 'content-type': text(row, 'mime_type') ?? 'application/octet-stream', 'x-upsert': 'false' },
    body: new Uint8Array(data),
  });
  if (!response.ok && response.status !== 409) throw new Error(`No se pudo subir attachment ${row.id}: HTTP ${response.status}`);
  return { storagePath: path, sha256: createHash('sha256').update(data).digest('hex') };
}

async function uploadWidgetAsset(row: JsonRow, column: 'launcher_icon' | 'conversation_empty_image'): Promise<string | null> {
  const raw = text(row, column);
  if (!raw) return null;
  if (/^https:\/\//i.test(raw)) return raw;
  const fileName = basename(raw.replace(/\\/g, '/'));
  const sourcePath = resolve(inputDir, 'widget-assets', fileName);
  let data: Buffer;
  try { data = await readFile(sourcePath); } catch { console.warn(`Widget ${row.id}: no se encontró ${fileName}; ${column} quedará vacío.`); return null; }
  if (!supabaseUrl || !supabaseSecret) throw new Error('Los recursos visuales del widget requieren SUPABASE_URL y SUPABASE_SECRET_KEY.');
  const extension = extname(fileName).toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
  const path = `${row.company_id}/${fileName}`;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/widget-assets/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${supabaseSecret}`, apikey: supabaseSecret, 'content-type': mime, 'x-upsert': 'true' },
    body: new Uint8Array(data),
  });
  if (!response.ok) throw new Error(`No se pudo subir recurso de widget ${fileName}: HTTP ${response.status}`);
  return `${supabaseUrl}/storage/v1/object/public/widget-assets/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function transform(table: SourceTable, row: JsonRow): Promise<Record<string, unknown> | null> {
  switch (table) {
    case 'companies': return withoutUndefined({
      ...base(row, ['id','name','description','contact_email','contact_phone','time_zone','is_enabled','flow_key','created_at','updated_at']),
      code: text(row, 'code') ?? `legacy-${row.id}`,
      notification_mode: normalizeStatus(text(row, 'notification_mode'), ['disabled','always','outside_business_hours'], 'disabled'),
      notification_recipients: csv(text(row, 'notification_recipients_csv')),
      business_hours_start: timeFromMinutes(numberValue(row, 'business_hours_start_minutes')),
      business_hours_end: timeFromMinutes(numberValue(row, 'business_hours_end_minutes')),
      business_days: [1,2,3,4,5],
      whatsapp_bot_mode: text(row, 'whatsapp_bot_mode') === 'disabled' ? 'disabled' : 'visual',
      agent_farewell_message: text(row, 'agent_farewell_message'),
    });
    case 'profiles': {
      const role = roleFromName(text(row, 'name'));
      if (role === 'super_admin') return null;
      return { ...base(row, ['id','company_id','name']), role, created_at: new Date().toISOString() };
    }
    case 'users': {
      const role = profileRoles.get(String(row.idProfile)) ?? 'agent';
      return withoutUndefined({
        ...base(row, ['id','name','email','phone','status','contact_id','last_login','last_activity','is_online','avatar_mime_type','avatar_file_name','avatar_updated_at','conversation_count']),
        auth_user_id: null,
        company_id: role === 'super_admin' ? null : row.company_id,
        profile_id: role === 'super_admin' ? null : row.idProfile,
        legacy_profile_id: row.idProfile,
        role,
        password_migration_status: booleanValue(row, 'status', true) ? 'reset_required' : 'disabled',
      });
    }
    case 'contacts': return base(row, ['id','company_id','name','phone_number','country','status','welcome_sent','last_message_at','last_location_latitude','last_location_longitude','created_at']);
    case 'conversations': return withoutUndefined({
      ...base(row, ['id','company_id','contact_id','channel','external_thread_key','status','greeting_sent','total_messages','ai_messages','rating','closed_by_user_id','assigned_user_id','assigned_at','assigned_by_user_id','agent_requested_at','last_agent_alert_email_at','started_at','last_activity_at','ended_at']),
      first_response_seconds: row.first_response_time,
    });
    case 'messages': return base(row, ['id','company_id','conversation_id','contact_id','sender','message','type','channel','latitude','longitude','location_name','sent_at']);
    case 'attachments': {
      const uploaded = await uploadAttachment(row);
      return {
        ...base(row, ['id','company_id','message_id','file_name','mime_type','size_bytes','whatsapp_media_id','uploaded_at']),
        storage_bucket: 'chat-attachments', storage_path: uploaded.storagePath, sha256: uploaded.sha256,
      };
    }
    case 'integrations': return {
      ...base(row, ['id','company_id','provider','phone_number_id','waba_id','app_id','api_base_url','api_version','created_at','updated_at']),
      app_secret_ciphertext: null, access_token_ciphertext: null, verify_token_hash: null, is_active: false,
    };
    case 'whatsapp_templates': return withoutUndefined({
      ...base(row, ['id','company_id','name','language','template_identifier','body_param_count','is_active','meta_status','meta_category','meta_header_format','meta_header_param_count','meta_button_count','created_at','updated_at']),
      meta_components: json(row.meta_component_summary, []),
    });
    case 'bot_settings': return { ...base(row, ['id','company_id','name']), configuration: json(row.configuration_json, {}) };
    case 'received_messages': {
      const integrationId = integrationByCompany.get(String(row.company_id));
      if (!integrationId || !row.message_meta_id) return null;
      return { ...base(row, ['id','company_id','message_meta_id','status']), integration_id: integrationId, payload: json(row.data_json, {}), received_at: new Date().toISOString() };
    }
    case 'outbox_messages': return withoutUndefined({
      ...base(row, ['id','company_id','integration_id','phone_number_id','status','message_meta_id','error_code','error_message']),
      idempotency_key: `legacy-${row.id}`,
      recipient: text(row, 'recepient') ?? 'unknown',
      type: text(row, 'type') ?? 'text', content: json(row.content_json, {}), attempts: row.tries ?? 0,
      next_attempt_at: row.next_attempt_at, created_at: new Date().toISOString(),
    });
    case 'whatsapp_bot_flows': return {
      ...base(row, ['id','company_id','name','description','status','is_active','created_at','updated_at','published_at']),
      builder: normalizeFlowDocument(json(row.builder_json, null)), published: row.published_json ? normalizeFlowDocument(json(row.published_json, null)) : null,
    };
    case 'whatsapp_bot_execution_states': return {
      ...base(row, ['id','company_id','conversation_id','flow_id','current_node_id','status','created_at','updated_at','last_input_at']),
      variables: json(row.variables_json, {}),
    };
    case 'webchatbot_flows': return {
      ...base(row, ['id','company_id','name','description','status','is_active','created_at','updated_at','published_at']),
      builder: normalizeFlowDocument(json(row.builder_json, null)), published: row.published_json ? normalizeFlowDocument(json(row.published_json, null)) : null,
    };
    case 'webchatbot_widgets': return withoutUndefined({
      ...base(row, ['id','company_id','name','is_active','active_flow_id','primary_color','accent_color','background_color','text_color','font_family','header_title','welcome_text','placeholder_text','bubble_text','brand_text','show_branding','allow_free_text','allow_live_chat','border_radius','created_at','updated_at']),
      position: normalizeWidgetPosition(row.position),
      launcher_icon: await uploadWidgetAsset(row, 'launcher_icon'),
      conversation_empty_image: await uploadWidgetAsset(row, 'conversation_empty_image'),
      content: json(row.content_json, { sections: { home: true, conversation: true, faqs: true, articles: true }, quickLinks: [], faqCategories: [], articleCategories: [] }),
    });
    case 'webchatbot_installation_keys': {
      const raw = text(row, 'activation_key'); if (!raw) return null;
      return { ...base(row, ['id','company_id','widget_id','name','is_active','created_at','last_used_at']), install_type: normalizeInstallType(row.install_type), activation_key_hash: createHash('sha256').update(raw).digest('hex'), activation_key_prefix: raw.slice(0, 8), allowed_domains: csv(text(row, 'allowed_domains_csv')) };
    }
    case 'webchatbot_sessions': {
      const raw = text(row, 'public_session_key'); if (!raw) return null;
      return withoutUndefined({
        ...base(row, ['id','company_id','widget_id','installation_key_id','flow_id','origin_domain','page_url','referrer_url','visitor_name','visitor_email','visitor_phone','current_node_key','live_chat_requested','live_chat_requested_at','live_chat_conversation_id','started_at','last_activity_at','ended_at']),
        public_session_key_hash: createHash('sha256').update(raw).digest('hex'), public_session_key_prefix: raw.slice(0, 8),
        status: text(row, 'status') === 'live_chat' ? 'live' : row.status, metadata: json(row.metadata_json, {}),
      });
    }
    case 'webchatbot_messages': return {
      ...base(row, ['id','company_id','session_id','conversation_id','sender','message_type','content','created_at']), payload: json(row.payload_json, null),
    };
    case 'webchatbot_events': return {
      ...base(row, ['id','company_id','conversation_id','channel','event_type','node_key','label','value','created_at']),
      session_id: numberValue(row, 'session_id') === 0 ? null : row.session_id,
      metadata: json(row.metadata_json, null),
    };
    case 'company_ai_settings': return {
      ...base(row, ['id','company_id','provider','model','api_base_url','response_mode','system_prompt','fallback_message','temperature','max_tokens','daily_message_limit','monthly_message_limit','pause_when_assigned','escalate_on_human_request','created_at','updated_at','last_tested_at','last_test_success','last_test_message']),
      is_enabled: false, api_key_ciphertext: null,
    };
    case 'company_ai_knowledge_items': return base(row, ['id','company_id','title','category','content','is_active','created_at','updated_at']);
    case 'ai_usage_logs': return withoutUndefined({
      ...base(row, ['id','company_id','conversation_id','message_id','provider','model','prompt_tokens','completion_tokens','total_tokens','estimated_cost_usd','success','duration_ms','reason','created_at']),
      error_code: text(row, 'error_message') ? 'LEGACY_ERROR' : null,
    });
    case 'ai_conversation_logs': return withoutUndefined({
      ...base(row, ['id','company_id','conversation_id','inbound_message_id','outbound_message_id','provider','model','response_mode','decision','prompt_excerpt','response_text','success','escalated_to_human','created_at']),
      error_code: text(row, 'error_message') ? 'LEGACY_ERROR' : null,
    });
    case 'company_admin_audits': {
      const actorUserId = row.actor_user_id;
      const actorBelongsToTenant = actorUserId !== null && actorUserId !== undefined && tenantUserKeys.has(`${row.company_id}:${actorUserId}`);
      return {
        ...base(row, ['id','company_id','action','actor_name','actor_email','actor_role','created_at']),
        actor_user_id: actorBelongsToTenant ? actorUserId : null,
        detail: { legacyText: text(row, 'detail') },
      };
    }
    case 'company_whatsapp_events': return {
      ...base(row, ['id','company_id','event_type','source','success','template_name','language','phone_number_id','summary','created_at']),
      to_phone_masked: text(row, 'to_phone') ? `***${text(row, 'to_phone')!.slice(-4)}` : null,
      detail: { legacyText: text(row, 'detail') },
    };
    case 'user_session_events': return {
      ...base(row, ['id','user_id','company_id','role','event_type','success','user_name','email','ip_address','created_at']), detail: { legacyText: text(row, 'detail') },
    };
  }
}

async function insertRows(table: SourceTable, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const normalized = rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
  for (let offset = 0; offset < normalized.length; offset += 250) {
    const batch = normalized.slice(offset, offset + 250);
    await db`insert into ${db(table)} ${db(batch, ...columns)} on conflict do nothing`;
  }
}

async function main() {
  try {
    for (const table of importOrder) {
      const source = await readNdjson(resolve(inputDir, `${table}.ndjson`));
      const transformed: Record<string, unknown>[] = [];
      for (const row of source) {
        const item = await transform(table, row);
        if (item) transformed.push(item);
      }
      await insertRows(table, transformed);
      console.log(`${table}: ${transformed.length}/${source.length}`);
    }
    await db`insert into public.data_retention_policies(company_id) select id from public.companies on conflict (company_id) do nothing`;
    for (const table of importOrder) {
      await db.unsafe(`select setval(pg_get_serial_sequence('public.${table}', 'id'), greatest(coalesce((select max(id) from public.${table}), 1), 1), exists(select 1 from public.${table}))`).catch(() => undefined);
    }
    console.log('Importación terminada. Ejecuta migration:verify antes de habilitar tráfico.');
  } finally {
    await db.end({ timeout: 5 });
  }
}

await main();
