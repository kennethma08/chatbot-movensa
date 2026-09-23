import type { FastifyRequest } from 'fastify';
import { asJson, type Database } from '../database.js';

export async function registerAudit(
  db: Database,
  request: FastifyRequest,
  companyId: string,
  action: string,
  detail: Record<string, unknown>,
) {
  const ip = request.ip && request.ip !== 'unknown' ? request.ip : null;
  const actorUserId = request.session.companyId === companyId ? request.session.userId : null;
  await db`
    insert into public.company_admin_audits (
      company_id, action, detail, actor_user_id, actor_name, actor_email, actor_role, request_id, ip_address
    ) values (
      ${companyId}, ${action}, ${db.json(asJson(detail))}, ${actorUserId}, ${request.session.name},
      ${request.session.email}, ${request.session.role}, ${request.id}::uuid, ${ip}::inet
    )
  `;
}
