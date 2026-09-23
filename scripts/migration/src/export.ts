import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { ConnectionPool } from 'mssql';
import { dataDirectory, ensureDirectory, normalizeForJson, sha256File, writeJson } from './io.js';
import { sourceTables } from './tables.js';

type SqlModule = typeof import('mssql');

function removeLegacySecrets(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...row };
  if (table === 'users') delete sanitized.pass;
  if (table === 'integrations') {
    delete sanitized.access_token_enc;
    delete sanitized.app_secret_enc;
    delete sanitized.verify_token_hash;
  }
  if (table === 'company_ai_settings') delete sanitized.api_key_enc;
  return sanitized;
}

async function connect(): Promise<ConnectionPool> {
  const useNative = process.env.SQLSERVER_DRIVER === 'msnodesqlv8';
  const loaded = (useNative ? await import('mssql/msnodesqlv8.js') : await import('mssql')) as unknown as { default?: SqlModule } & SqlModule;
  const sql = loaded.default ?? loaded;
  const server = process.env.SQLSERVER_SERVER;
  const database = process.env.SQLSERVER_DATABASE;
  if (!server || !database) throw new Error('Define SQLSERVER_SERVER y SQLSERVER_DATABASE.');
  const trusted = process.env.SQLSERVER_TRUSTED_CONNECTION === 'true';
  if (useNative) {
    const driver = process.env.SQLSERVER_ODBC_DRIVER ?? 'ODBC Driver 17 for SQL Server';
    const connectionString = [
      `Driver={${driver}}`,
      `Server={${server}}`,
      `Database={${database}}`,
      trusted ? 'Trusted_Connection={yes}' : `Uid={${process.env.SQLSERVER_USER ?? ''}};Pwd={${process.env.SQLSERVER_PASSWORD ?? ''}}`,
      `Encrypt={${process.env.SQLSERVER_ENCRYPT === 'true' ? 'yes' : 'no'}}`,
      'TrustServerCertificate={yes}',
    ].join(';');
    return sql.connect({ connectionString } as never);
  }
  const config = {
    server,
    database,
    ...(trusted ? {} : { user: process.env.SQLSERVER_USER, password: process.env.SQLSERVER_PASSWORD }),
    options: {
      encrypt: process.env.SQLSERVER_ENCRYPT === 'true',
      trustServerCertificate: process.env.SQLSERVER_TRUST_CERTIFICATE !== 'false',
      ...(trusted ? { trustedConnection: true } : {}),
    },
    pool: { min: 0, max: 3, idleTimeoutMillis: 10_000 },
  };
  return sql.connect(config);
}

async function main() {
  const outputDir = dataDirectory();
  await ensureDirectory(outputDir);
  const pool = await connect();
  const manifest: { exportedAt: string; source: string; migrations: string[]; tables: Record<string, { rows: number; sha256: string; present: boolean }>; assets: Record<string, { sourceReference: string; sha256: string | null; present: boolean }> } = {
    exportedAt: new Date().toISOString(),
    source: `${process.env.SQLSERVER_SERVER}/${process.env.SQLSERVER_DATABASE}`,
    migrations: [],
    tables: {},
    assets: {},
  };
  try {
    const availableResult = await pool.request().query<{ name: string }>("select name from sys.tables where schema_id = schema_id('dbo')");
    const available = new Set(availableResult.recordset.map((row) => row.name));
    if (available.has('__EFMigrationsHistory')) {
      const migrations = await pool.request().query<{ MigrationId: string }>('select MigrationId from dbo.[__EFMigrationsHistory] order by MigrationId');
      manifest.migrations = migrations.recordset.map((row) => row.MigrationId);
    }
    for (const table of sourceTables) {
      const path = resolve(outputDir, `${table}.ndjson`);
      if (!available.has(table)) {
        await writeFile(path, '', 'utf8');
        manifest.tables[table] = { rows: 0, sha256: await sha256File(path), present: false };
        console.log(`${table}: no existe (0)`);
        continue;
      }
      const result = await pool.request().query<Record<string, unknown>>(`select * from dbo.[${table}] order by id`);
      const stream = createWriteStream(path, { encoding: 'utf8' });
      for (const row of result.recordset) stream.write(`${JSON.stringify(normalizeForJson(removeLegacySecrets(table, row)))}\n`);
      await new Promise<void>((accept, reject) => { stream.end(accept); stream.on('error', reject); });
      manifest.tables[table] = { rows: result.recordset.length, sha256: await sha256File(path), present: true };
      if (table === 'webchatbot_widgets') {
        const legacyAssetDirectory = process.env.LEGACY_WEBCHAT_ASSETS_DIR;
        const targetDirectory = resolve(outputDir, 'widget-assets');
        await mkdir(targetDirectory, { recursive: true });
        for (const row of result.recordset) for (const column of ['launcher_icon', 'conversation_empty_image'] as const) {
          const sourceReference = typeof row[column] === 'string' ? row[column] : '';
          if (!sourceReference) continue;
          const fileName = basename(sourceReference.replace(/\\/g, '/'));
          if (manifest.assets[fileName]) continue;
          const sourcePath = legacyAssetDirectory ? resolve(legacyAssetDirectory, fileName) : '';
          const targetPath = resolve(targetDirectory, fileName);
          try {
            if (!sourcePath) throw new Error('LEGACY_WEBCHAT_ASSETS_DIR no definido');
            await copyFile(sourcePath, targetPath);
            manifest.assets[fileName] = { sourceReference, sha256: await sha256File(targetPath), present: true };
          } catch {
            manifest.assets[fileName] = { sourceReference, sha256: null, present: false };
          }
        }
      }
      console.log(`${table}: ${result.recordset.length}`);
    }
    await writeJson(resolve(outputDir, 'manifest.json'), manifest);
    console.log(`Exportación finalizada en ${outputDir}`);
  } finally {
    await pool.close();
  }
}

await main();
