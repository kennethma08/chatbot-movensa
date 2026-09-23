import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { buildApp } from './apps/api/src/app.js';
import { loadConfig } from './apps/api/src/config.js';
import { createDatabase } from './apps/api/src/database.js';
import { createAiWorker } from './apps/api/src/workers/ai-worker.js';
import { createOutboxWorker } from './apps/api/src/workers/outbox-worker.js';
import { createMediaWorker } from './apps/api/src/workers/media-worker.js';

try {
  loadEnvFile(resolve(process.cwd(), '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const app = Fastify({
  logger: config.logLevel === 'silent' ? false : {
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
        'body.accessToken', 'body.appSecret', 'body.verifyToken', 'body.apiKey',
      ],
      censor: '[REDACTED]',
    },
  },
  genReqId: () => randomUUID(),
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: true,
});
await buildApp({ config, db, app });
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

// A direct listen call lets Vercel package the monorepo as one Fastify function.
void Fastify;
await app.listen({ port: config.port, host: config.host });
outbox.start();
ai.start();
media.start();

