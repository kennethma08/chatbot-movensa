import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';
import { createAiWorker } from './workers/ai-worker.js';
import { createOutboxWorker } from './workers/outbox-worker.js';
import { createMediaWorker } from './workers/media-worker.js';

try {
  loadEnvFile(resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const app = await buildApp({ config, db });
const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const outbox = createOutboxWorker(db, config, workerId);
const ai = createAiWorker(db, config, workerId);
const media = createMediaWorker(db, config, workerId);

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Graceful shutdown');
  outbox.stop();
  ai.stop();
  media.stop();
  await app.close();
  await db.end({ timeout: 5 });
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
outbox.start();
ai.start();
media.start();
