import { resolve } from 'node:path';
import postgres from 'postgres';
import { dataDirectory, readNdjson, writeJson } from './io.js';

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const secret = process.env.SUPABASE_SECRET_KEY;
if (!databaseUrl || !supabaseUrl || !secret) throw new Error('Define DATABASE_URL, SUPABASE_URL y SUPABASE_SECRET_KEY.');
const authUrl = supabaseUrl;
const secretKey = secret;
const db = postgres(databaseUrl, { max: 2, prepare: false });

async function main() {
  const users = await readNdjson(resolve(dataDirectory(), 'users.ndjson'));
  const results: Array<{ legacyId: string; email: string; status: string }> = [];
  for (const source of users) {
    if (!source.status || !source.email) continue;
    const email = String(source.email).trim().toLocaleLowerCase();
    const response = await fetch(`${authUrl}/auth/v1/invite`, {
      method: 'POST',
      headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, data: { name: source.name } }),
    });
    if (!response.ok) {
      results.push({ legacyId: String(source.id), email, status: `failed:${response.status}` });
      continue;
    }
    const payload = await response.json() as { id?: string; user?: { id?: string } };
    const authId = payload.id ?? payload.user?.id;
    if (!authId) { results.push({ legacyId: String(source.id), email, status: 'failed:invalid-response' }); continue; }
    await db`update public.users set auth_user_id = ${authId}::uuid, password_migration_status = 'invited' where id = ${String(source.id)}`;
    results.push({ legacyId: String(source.id), email, status: 'invited' });
  }
  await writeJson(resolve(dataDirectory(), 'user-onboarding-report.json'), { createdAt: new Date().toISOString(), results });
  if (results.some((result) => result.status.startsWith('failed'))) throw new Error('Algunas invitaciones fallaron. Revisa user-onboarding-report.json.');
}

try { await main(); } finally { await db.end({ timeout: 5 }); }
