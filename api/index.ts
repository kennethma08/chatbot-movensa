import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { createDatabase } from '../apps/api/src/database.js';
import { createAiWorker } from '../apps/api/src/workers/ai-worker.js';
import { createOutboxWorker } from '../apps/api/src/workers/outbox-worker.js';
import { createMediaWorker } from '../apps/api/src/workers/media-worker.js';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const appPromise = buildApp({ config, db });
const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const outbox = createOutboxWorker(db, config, workerId);
const ai = createAiWorker(db, config, workerId);
const media = createMediaWorker(db, config, workerId);

async function drainPendingWork() {
  await Promise.all([outbox.tick(), ai.tick(), media.tick()]);
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const app = await appPromise;
  await app.ready();

  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      response.off('error', reject);
      resolve();
    };
    response.once('finish', finish);
    response.once('close', finish);
    response.once('error', reject);
    app.server.emit('request', request, response);
  });

  await drainPendingWork();
}
