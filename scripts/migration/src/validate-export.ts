import { resolve } from 'node:path';
import { dataDirectory, readJson, readNdjson, sha256File, writeJson } from './io.js';
import { sourceTables } from './tables.js';
import { normalizeFlowDocument } from './transformers.js';

type Manifest = { exportedAt: string; migrations?: string[]; tables: Record<string, { rows: number; sha256: string; present: boolean }>; assets?: Record<string, { sourceReference: string; sha256: string | null; present: boolean }> };
type Check = { name: string; ok: boolean; detail: string };

const directory = dataDirectory();
const manifest = await readJson<Manifest>(resolve(directory, 'manifest.json'));
const all = new Map<string, Awaited<ReturnType<typeof readNdjson>>>();
const checks: Check[] = [];

for (const table of sourceTables) {
  const path = resolve(directory, `${table}.ndjson`);
  const rows = await readNdjson(path);
  all.set(table, rows);
  const expected = manifest.tables[table];
  if (!expected) throw new Error(`El manifiesto no contiene la tabla ${table}.`);
  checks.push({ name: `file.${table}.count`, ok: rows.length === expected.rows, detail: `${rows.length}/${expected.rows}` });
  const hash = await sha256File(path);
  checks.push({ name: `file.${table}.sha256`, ok: hash === expected.sha256, detail: hash });
}

function ids(table: string): Set<string> { return new Set((all.get(table) ?? []).map((row) => String(row.id))); }
function orphanCount(table: string, foreignKey: string, parent: string): number {
  const parentIds = ids(parent);
  return (all.get(table) ?? []).filter((row) => row[foreignKey] !== null && row[foreignKey] !== undefined && Number(row[foreignKey]) !== 0 && !parentIds.has(String(row[foreignKey]))).length;
}

for (const [table, foreignKey, parent] of [
  ['contacts','company_id','companies'], ['users','company_id','companies'], ['conversations','company_id','companies'],
  ['conversations','contact_id','contacts'], ['messages','conversation_id','conversations'], ['messages','contact_id','contacts'],
  ['attachments','message_id','messages'], ['webchatbot_widgets','company_id','companies'],
  ['webchatbot_installation_keys','widget_id','webchatbot_widgets'], ['webchatbot_sessions','installation_key_id','webchatbot_installation_keys'],
  ['webchatbot_messages','session_id','webchatbot_sessions'], ['webchatbot_events','session_id','webchatbot_sessions'],
] as const) {
  const count = orphanCount(table, foreignKey, parent);
  checks.push({ name: `relationship.${table}.${foreignKey}`, ok: count === 0, detail: `orphans=${count}` });
}

const companyById = new Map((all.get('companies') ?? []).map((row) => [String(row.id), row]));
const contactById = new Map((all.get('contacts') ?? []).map((row) => [String(row.id), row]));
let tenantMismatches = 0;
for (const conversation of all.get('conversations') ?? []) {
  const contact = contactById.get(String(conversation.contact_id));
  if (contact && String(contact.company_id) !== String(conversation.company_id)) tenantMismatches += 1;
  if (!companyById.has(String(conversation.company_id))) tenantMismatches += 1;
}
checks.push({ name: 'tenant.conversations', ok: tenantMismatches === 0, detail: `mismatches=${tenantMismatches}` });

const administrativeEvents = (all.get('webchatbot_events') ?? []).filter((row) => Number(row.session_id) === 0);
const allowedAdministrativeEvents = new Set(['installation_key_updated','widget_saved','flow_saved','flow_deleted','flow_published','installation_key_created']);
const invalidAdministrativeEvents = administrativeEvents.filter((row) => !allowedAdministrativeEvents.has(String(row.event_type))).length;
checks.push({
  name: 'repair.webchat_admin_event_session',
  ok: invalidAdministrativeEvents === 0,
  detail: `convert_session_0_to_null=${administrativeEvents.length}, invalid=${invalidAdministrativeEvents}`,
});

let invalidJson = 0;
for (const [table, columns] of Object.entries({
  webchatbot_flows: ['builder_json','published_json'], webchatbot_widgets: ['content_json'],
  webchatbot_sessions: ['metadata_json'], webchatbot_messages: ['payload_json'], webchatbot_events: ['metadata_json'],
  whatsapp_bot_flows: ['builder_json','published_json'], whatsapp_bot_execution_states: ['variables_json'],
})) {
  for (const row of all.get(table) ?? []) for (const column of columns) {
    if (row[column] === null || row[column] === undefined || row[column] === '') continue;
    try { JSON.parse(String(row[column])); } catch { invalidJson += 1; }
  }
}
checks.push({ name: 'json.valid', ok: invalidJson === 0, detail: `invalid=${invalidJson}` });

let invalidConvertedFlows = 0;
for (const table of ['webchatbot_flows', 'whatsapp_bot_flows']) for (const item of all.get(table) ?? []) {
  for (const column of ['builder_json', 'published_json']) {
    if (!item[column]) continue;
    try { normalizeFlowDocument(JSON.parse(String(item[column]))); } catch { invalidConvertedFlows += 1; }
  }
}
checks.push({ name: 'transform.flows', ok: invalidConvertedFlows === 0, detail: `invalid=${invalidConvertedFlows}` });

let missingWidgetAssets = 0;
for (const [fileName, asset] of Object.entries(manifest.assets ?? {})) {
  if (!asset.present) { missingWidgetAssets += 1; continue; }
  const path = resolve(directory, 'widget-assets', fileName);
  try { if (await sha256File(path) !== asset.sha256) missingWidgetAssets += 1; } catch { missingWidgetAssets += 1; }
}
checks.push({ name: 'source.widget_assets', ok: missingWidgetAssets === 0, detail: `missing_or_changed=${missingWidgetAssets}` });

const pending = ['20260614120000_CompanyAgentFarewellMessage','20260615103000_CompanyAiModule'].filter((migration) => !(manifest.migrations ?? []).includes(migration));
checks.push({ name: 'source.pending_migrations', ok: pending.length === 0, detail: pending.length ? `pending=${pending.join(',')}` : 'none' });

const expectedWarnings = new Set(['source.pending_migrations', 'source.widget_assets']);
const failed = checks.filter((check) => !check.ok && !expectedWarnings.has(check.name));
await writeJson(resolve(directory, 'preflight-report.json'), { checkedAt: new Date().toISOString(), ok: failed.length === 0, checks });
for (const check of checks) console.log(`${check.ok ? 'OK' : expectedWarnings.has(check.name) ? 'EXPECTED' : 'FAIL'} ${check.name}: ${check.detail}`);
if (failed.length) throw new Error(`Preflight falló: ${failed.length} comprobaciones.`);
console.log('Preflight del export aprobado. Las migraciones pendientes se incorporan en el esquema PostgreSQL, no se aplican al origen.');
