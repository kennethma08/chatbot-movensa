import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
try {
  loadEnvFile(resolve(projectRoot, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export type JsonRow = Record<string, unknown>;

export function dataDirectory(): string {
  const configured = process.env.MIGRATION_DATA_DIR;
  return configured ? resolve(projectRoot, configured) : resolve(projectRoot, 'scripts/migration/data');
}

export async function ensureDirectory(path: string) {
  await mkdir(path, { recursive: true });
}

export function normalizeForJson(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { __base64: value.toString('base64') };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeForJson(item)]));
  return value;
}

export function reviveBuffer(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveBuffer);
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    if (typeof row.__base64 === 'string') return Buffer.from(row.__base64, 'base64');
    return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, reviveBuffer(item)]));
  }
  return value;
}

export async function writeJson(path: string, value: unknown) {
  await ensureDirectory(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function readNdjson(path: string): Promise<JsonRow[]> {
  const rows: JsonRow[] = [];
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) rows.push(reviveBuffer(JSON.parse(line)) as JsonRow);
  return rows;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
