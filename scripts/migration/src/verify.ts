import { resolve } from 'node:path';
import postgres from 'postgres';
import { dataDirectory, readJson, readNdjson, writeJson } from './io.js';
import { sourceTables } from './tables.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Define DATABASE_URL.');
const db = postgres(databaseUrl, { max: 2, prepare: false });
const directory = dataDirectory();

type Manifest = { exportedAt: string; tables: Record<string, { rows: number; sha256: string; present: boolean }> };
type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const manifest = await readJson<Manifest>(resolve(directory, 'manifest.json'));
  const checks: Check[] = [];
  for (const table of sourceTables) {
    const source = manifest.tables[table]?.rows ?? 0;
    const sourceRows = await readNdjson(resolve(directory, `${table}.ndjson`));
    let expectedRows = sourceRows;
    if (table === 'profiles') {
      expectedRows = sourceRows.filter((row) => !String(row.name ?? '').toLocaleLowerCase().includes('super'));
    }
    if (table === 'received_messages') {
      expectedRows = sourceRows.filter((row) => row.message_meta_id);
    }
    const expected = expectedRows.length;
    const result = await db.unsafe(`select count(*)::int as count from public.${table}`);
    const actual = Number(result[0]?.count ?? 0);
    // Every imported table preserves the legacy bigint primary key. Reconcile the
    // exact cutover IDs so normal post-migration activity does not masquerade as a
    // duplicate import or data-loss failure.
    const sourceIds = expectedRows.map((row) => Number(row.id)).filter(Number.isSafeInteger);
    const [matched] = sourceIds.length
      ? await db.unsafe<{ count: number }[]>(
          `select count(*)::int as count from public.${table} where id = any($1::bigint[])`,
          [sourceIds],
        )
      : [{ count: 0 }];
    const imported = Number(matched?.count ?? 0);
    checks.push({
      name: `count.${table}`,
      ok: sourceIds.length === expected && imported === expected,
      detail: `source=${source}, expected=${expected}, imported=${imported}, destination=${actual}`,
    });
  }

  const [integrity] = await db<{
    orphan_conversations: number; orphan_messages: number; tenant_mismatch_messages: number;
    duplicate_open_conversations: number; plaintext_secrets: number; legacy_password_columns: number;
  }[]>`
    select
      (select count(*)::int from public.conversations c left join public.contacts ct on ct.company_id=c.company_id and ct.id=c.contact_id where ct.id is null) as orphan_conversations,
      (select count(*)::int from public.messages m left join public.conversations c on c.company_id=m.company_id and c.id=m.conversation_id where c.id is null) as orphan_messages,
      (select count(*)::int from public.messages m join public.conversations c on c.id=m.conversation_id where m.company_id<>c.company_id) as tenant_mismatch_messages,
      (select count(*)::int from (select company_id,contact_id,channel,count(*) from public.conversations where status<>'closed' group by 1,2,3 having count(*)>1) x) as duplicate_open_conversations,
      (select count(*)::int from public.integrations where access_token_ciphertext is not null or app_secret_ciphertext is not null or verify_token_hash is not null) as plaintext_secrets,
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='users' and column_name in ('pass','password','password_hash')) as legacy_password_columns
  `;
  for (const [key, raw] of Object.entries(integrity ?? {})) checks.push({ name: `integrity.${key}`, ok: Number(raw) === 0, detail: String(raw) });

  const [schema] = await db<{ foreign_keys: number; rls_tables: number; public_tables: number }[]>`
    select
      (select count(*)::int from information_schema.table_constraints where constraint_schema='public' and constraint_type='FOREIGN KEY') as foreign_keys,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity) as rls_tables,
      (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as public_tables
  `;
  checks.push({ name: 'schema.foreign_keys', ok: (schema?.foreign_keys ?? 0) >= 40, detail: String(schema?.foreign_keys ?? 0) });
  checks.push({ name: 'schema.rls_coverage', ok: schema?.rls_tables === schema?.public_tables, detail: `${schema?.rls_tables}/${schema?.public_tables}` });

  const failed = checks.filter((check) => !check.ok);
  const report = { verifiedAt: new Date().toISOString(), sourceExportedAt: manifest.exportedAt, ok: failed.length === 0, checks };
  await writeJson(resolve(directory, 'reconciliation.json'), report);
  for (const check of checks) console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`);
  if (failed.length) throw new Error(`Conciliación fallida: ${failed.length} comprobaciones.`);
  console.log('Conciliación aprobada.');
}

try { await main(); } finally { await db.end({ timeout: 5 }); }
