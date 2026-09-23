import { randomBytes } from 'node:crypto';
import type { AppRole } from '@movensa/shared';
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

function authFor(role: AppRole): AuthService {
  return {
    resolve: async () => ({
      authUserId: crypto.randomUUID(),
      userId: role === 'super_admin' ? '1' : role === 'admin' ? '2' : '3',
      companyId: role === 'super_admin' ? null : '10',
      role,
      name: role,
      email: `${role}@example.com`,
    }),
  };
}

describe('role permission matrix', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it.each([
    ['agent', '/v1/team'],
    ['agent', '/v1/reports/overview'],
    ['agent', '/v1/admin/companies'],
    ['admin', '/v1/admin/companies/10'],
    ['admin', '/v1/admin/companies/10/flows/webchat'],
    ['super_admin', '/v1/contacts'],
  ] satisfies Array<[AppRole, string]>)('rejects %s on %s', async (role, url) => {
    app = await buildApp({ config, db, auth: authFor(role) });
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ROLE_FORBIDDEN');
  });

  it.each([
    ['agent', '/v1/contacts'],
    ['admin', '/v1/team'],
    ['admin', '/v1/reports/overview'],
    ['super_admin', '/v1/admin/companies'],
    ['super_admin', '/v1/conversations?companyId=10'],
    ['super_admin', '/v1/team?companyId=10'],
    ['super_admin', '/v1/reports/overview?companyId=10'],
  ] satisfies Array<[AppRole, string]>)('allows %s on %s', async (role, url) => {
    app = await buildApp({ config, db, auth: authFor(role) });
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
  });

  it('requires an explicit company for a super administrator workspace', async () => {
    app = await buildApp({ config, db, auth: authFor('super_admin') });
    const response = await app.inject({ method: 'GET', url: '/v1/conversations' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('COMPANY_REQUIRED');
  });
});
