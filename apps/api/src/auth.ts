import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppRole, SessionContext } from '../../../packages/shared/src/index.js';
import type { AppConfig } from './config.js';
import type { Database } from './database.js';
import { AppError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionContext;
  }
}

export interface AuthService {
  resolve(request: FastifyRequest): Promise<SessionContext>;
}

export function createAuthService(config: AppConfig, db: Database): AuthService {
  const jwks = createRemoteJWKSet(new URL(config.supabaseJwksUrl));
  return {
    async resolve(request) {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith('Bearer ')) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Debes iniciar sesión.');
      }
      const token = authorization.slice('Bearer '.length);
      let subject: string;
      try {
        const result = await jwtVerify(token, jwks, {
          issuer: config.supabaseJwtIssuer,
          audience: 'authenticated',
        });
        if (!result.payload.sub) throw new Error('JWT sin subject');
        subject = result.payload.sub;
      } catch {
        throw new AppError(401, 'INVALID_TOKEN', 'La sesión no es válida o expiró.');
      }

      const rows = await db<{
        id: string;
        company_id: string | null;
        role: AppRole;
        name: string;
        email: string;
        company_is_enabled: boolean | null;
      }[]>`
        select u.id, u.company_id, u.role, u.name, u.email, c.is_enabled as company_is_enabled
        from public.users u
        left join public.companies c on c.id = u.company_id
        where u.auth_user_id = ${subject}::uuid and u.status = true
        limit 1
      `;
      const user = rows[0];
      if (!user) throw new AppError(403, 'PROFILE_DISABLED', 'El usuario no tiene un perfil activo.');
      if (user.role !== 'super_admin' && user.company_id === null) {
        throw new AppError(403, 'COMPANY_MISSING', 'El usuario no pertenece a una empresa activa.');
      }
      if (user.role !== 'super_admin' && user.company_is_enabled !== true) {
        throw new AppError(403, 'COMPANY_DISABLED', 'La empresa está deshabilitada.');
      }
      return {
        authUserId: subject,
        userId: user.id,
        companyId: user.company_id,
        role: user.role,
        name: user.name,
        email: user.email,
      };
    },
  };
}

export function requireAuth(auth: AuthService, allowedRoles?: readonly AppRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const session = await auth.resolve(request);
    if (allowedRoles && !allowedRoles.includes(session.role)) {
      throw new AppError(403, 'ROLE_FORBIDDEN', 'Tu perfil no permite realizar esta acción.');
    }
    request.session = session;
  };
}

export function requireCompany(request: FastifyRequest): string {
  if (request.session.companyId === null) {
    throw new AppError(400, 'COMPANY_REQUIRED', 'Selecciona una empresa para continuar.');
  }
  return request.session.companyId;
}

export function resolveCompanyScope(request: FastifyRequest, requestedCompanyId?: string): string {
  if (request.session.role === 'super_admin') {
    if (!requestedCompanyId || !/^\d+$/.test(requestedCompanyId)) {
      throw new AppError(400, 'COMPANY_REQUIRED', 'Indica una empresa válida.');
    }
    return requestedCompanyId;
  }
  return requireCompany(request);
}
