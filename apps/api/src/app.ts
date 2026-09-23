import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import rawBody from 'fastify-raw-body';
import { ZodError } from 'zod';
import { createAuthService, type AuthService } from './auth.js';
import type { AppConfig } from './config.js';
import type { Database } from './database.js';
import { AppError } from './errors.js';
import { adminRoutes } from './routes/admin.js';
import { conversationRoutes } from './routes/conversations.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { directoryRoutes } from './routes/directory.js';
import { metaRoutes } from './routes/meta.js';
import { profileRoutes } from './routes/profile.js';
import { webchatRoutes } from './routes/webchat.js';

interface BuildDependencies {
  config: AppConfig;
  db: Database;
  auth?: AuthService;
  app?: FastifyInstance;
}

export async function buildApp({ config, db, auth = createAuthService(config, db), app: providedApp }: BuildDependencies): Promise<FastifyInstance> {
  const app = providedApp ?? Fastify({
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

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    delegator(request, callback) {
      const isPublicWebchat = request.url.startsWith('/v1/public/webchat/');
      callback(null, {
        credentials: !isPublicWebchat,
        origin(origin, originCallback) {
          if (!origin) return originCallback(null, true);
          if (isPublicWebchat && /^https?:\/\//i.test(origin)) return originCallback(null, true);
          if (config.allowedOrigins.has(origin)) return originCallback(null, true);
          return originCallback(new Error('Origen no permitido'), false);
        },
        allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      });
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 180,
    timeWindow: '1 minute',
    ban: 3,
    keyGenerator: (request) => request.ip,
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 20 * 1024 * 1024, fields: 10 },
  });
  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true,
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    error: { code: 'ROUTE_NOT_FOUND', message: 'Ruta no encontrada.', requestId: request.id },
  }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos.',
          requestId: request.id,
          details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id, ...(error.details === undefined ? {} : { details: error.details }) },
      });
    }
    const candidate = error as { statusCode?: unknown };
    const statusCode = typeof candidate.statusCode === 'number' && candidate.statusCode < 500 ? candidate.statusCode : 500;
    if (statusCode >= 500) request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(statusCode).send({
      error: {
        code: statusCode === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR',
        message: statusCode === 429 ? 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' : 'Ocurrió un error interno.',
        requestId: request.id,
      },
    });
  });

  app.get('/health/live', async () => ({ status: 'ok', service: 'movensa-api' }));
  app.get('/health/ready', async () => {
    await db`select 1`;
    return { status: 'ready' };
  });

  await app.register(async (v1) => {
    await v1.register(dashboardRoutes({ auth, db, config }));
    await v1.register(conversationRoutes({ auth, db, config }));
    await v1.register(directoryRoutes({ auth, db }));
    await v1.register(profileRoutes({ auth, db, config }));
    await v1.register(adminRoutes({ auth, db, config }));
    await v1.register(metaRoutes({ db, config }));
    await v1.register(webchatRoutes({ db, config }));
  }, { prefix: '/v1' });

  return app;
}
