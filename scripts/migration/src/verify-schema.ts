import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationDirectory = resolve(root, 'supabase/migrations');
const db = new PGlite();

async function main() {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create schema storage;
    create table storage.buckets(
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
  `);
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    await db.exec(await readFile(resolve(migrationDirectory, file), 'utf8'));
    console.log(`OK migration ${file}`);
  }
  const schema = await db.query<{ tables: number; foreign_keys: number; rls_tables: number }>(`
    select
      (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tables,
      (select count(*)::int from information_schema.table_constraints where constraint_schema='public' and constraint_type='FOREIGN KEY') as foreign_keys,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity) as rls_tables
  `);
  const stats = schema.rows[0]!;
  if (stats.tables < 29) throw new Error(`Solo se crearon ${stats.tables} tablas.`);
  if (stats.foreign_keys < 40) throw new Error(`Solo se crearon ${stats.foreign_keys} claves foráneas.`);
  if (stats.rls_tables !== stats.tables) throw new Error(`RLS incompleto: ${stats.rls_tables}/${stats.tables}.`);

  await db.exec(`
    insert into auth.users(id,email) values
      ('00000000-0000-0000-0000-000000000001','a@example.com'),
      ('00000000-0000-0000-0000-000000000002','b@example.com');
    insert into public.companies(id,name,code) values (1,'Alpha','alpha'),(2,'Beta','beta');
    insert into public.profiles(id,company_id,name,role) values (1,1,'Agente','agent'),(2,2,'Agente','agent');
    insert into public.users(id,auth_user_id,company_id,profile_id,name,email,role)
      values (1,'00000000-0000-0000-0000-000000000001',1,1,'Agente A','a@example.com','agent'),
             (2,'00000000-0000-0000-0000-000000000002',2,2,'Agente B','b@example.com','agent');
    set role authenticated;
    select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
  `);
  let directReadRejected = false;
  try {
    await db.query<{ id: number }>('select id from public.companies order by id');
  } catch { directReadRejected = true; }
  if (!directReadRejected) throw new Error('El rol web autenticado pudo omitir el API y leer tablas directamente.');
  let crossTenantRejected = false;
  try {
    await db.exec("insert into public.contacts(company_id,name,phone_number) values (2,'Intruso','+50255550000')");
  } catch { crossTenantRejected = true; }
  if (!crossTenantRejected) throw new Error('RLS permitió escribir en otra empresa.');
  await db.exec('reset role');
  console.log(`Esquema válido: ${stats.tables} tablas, ${stats.foreign_keys} FKs, RLS ${stats.rls_tables}/${stats.tables}.`);
}

try { await main(); } finally { await db.close(); }
