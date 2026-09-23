import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuthService } from '../src/auth.js';
import type { AppConfig } from '../src/config.js';
import type { Database } from '../src/database.js';

const config: AppConfig = {
  nodeEnv: 'test', port: 3100, host: '127.0.0.1', databaseUrl: 'postgres://unused',
  supabaseUrl: 'http://127.0.0.1:54321', supabaseJwksUrl: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
  supabaseJwtIssuer: 'http://127.0.0.1:54321/auth/v1', supabaseSecretKey: 'test-secret-key-that-is-long-enough',
  encryptionKey: randomBytes(32), allowedOrigins: new Set(['http://127.0.0.1:5173']),
  publicApiUrl: 'http://127.0.0.1:3100', publicWidgetUrl: 'http://127.0.0.1:4174/movensa-widget.js', logLevel: 'silent',
};
const db = (() => Promise.resolve([])) as unknown as Database;
const auth: AuthService = { resolve: async () => ({ authUserId: crypto.randomUUID(), userId: '1', companyId: '1', role: 'admin', name: 'Test', email: 'test@example.com' }) };

describe('API application', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('exposes liveness without touching the database', async () => {
    app = await buildApp({ config, db, auth });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'movensa-api' });
  });

  it('returns a consistent error envelope for unknown routes', async () => {
    app = await buildApp({ config, db, auth });
    const response = await app.inject({ method: 'GET', url: '/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('ROUTE_NOT_FOUND');
    expect(response.json().error.requestId).toMatch(/[0-9a-f-]{36}/);
  });
});
