import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { strToU8, zipSync } from 'fflate';
import {
  aiSettingsSchema,
  companyUpsertSchema,
  flowDocumentSchema,
  integrationUpsertSchema,
  rolesFor,
  userUpsertSchema,
} from '../../../../packages/shared/src/index.js';
import { z } from 'zod';
import type { AuthService } from '../auth.js';
import { requireAuth } from '../auth.js';
import type { AppConfig } from '../config.js';
import { asJson, type Database } from '../database.js';
import { AppError, forbidden, notFound } from '../errors.js';
import { createOpaqueToken, decryptSecret, encryptSecret, safeEqualText, sha256 } from '../security/crypto.js';
import { registerAudit } from '../services/audit.js';
import { loadAdminOverview } from '../services/admin-overview.js';
import { callAiProvider, type AiSettings } from '../workers/ai-worker.js';

interface Dependencies { auth: AuthService; db: Database; config: AppConfig }

function parseId(raw: string): string {
  if (!/^\d+$/.test(raw)) throw new AppError(400, 'INVALID_ID', 'Identificador inválido.');
  return raw;
}

function assertCompanyAccess(request: FastifyRequest, companyId: string) {
  if (request.session.role !== 'super_admin' && request.session.companyId !== companyId) {
    throw forbidden('La empresa solicitada no pertenece a tu sesión.');
  }
}

const templateSchema = z.object({
  name: z.string().trim().min(1).max(250),
  language: z.string().trim().min(2).max(20),
  templateIdentifier: z.string().trim().max(250).nullable().optional(),
  bodyParamCount: z.number().int().min(0).max(100).default(0),
  isActive: z.boolean().default(true),
  metaStatus: z.string().max(80).nullable().optional(),
  metaCategory: z.string().max(80).nullable().optional(),
  metaComponents: z.array(z.record(z.string(), z.unknown())).default([]),
});

const knowledgeSchema = z.object({
  title: z.string().trim().min(2).max(160),
  category: z.string().trim().max(80).nullable().optional(),
  content: z.string().trim().min(1).max(50_000),
  isActive: z.boolean().default(true),
});

const flowSchema = z.object({
  name: z.string().trim().min(2).max(250),
  description: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().default(false),
  document: flowDocumentSchema,
});

const widgetSchema = z.object({
  name: z.string().trim().min(2).max(160),
  isActive: z.boolean(),
  activeFlowId: z.string().regex(/^\d+$/).nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  fontFamily: z.string().trim().min(1).max(200),
  position: z.enum(['bottom-left', 'bottom-right']),
  headerTitle: z.string().trim().min(1).max(160),
  welcomeText: z.string().trim().max(1000),
  placeholderText: z.string().trim().max(160),
  bubbleText: z.string().trim().max(80),
  brandText: z.string().trim().max(80),
  showBranding: z.boolean(),
  allowFreeText: z.boolean(),
  allowLiveChat: z.boolean(),
  borderRadius: z.number().int().min(0).max(32),
  launcherIcon: z.url().nullable().optional(),
  conversationEmptyImage: z.url().nullable().optional(),
  content: z.object({
    quickLinks: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
    faqCategories: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
    articleCategories: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  }).catchall(z.unknown()),
});

const installationSchema = z.object({
  widgetId: z.string().regex(/^\d+$/),
  name: z.string().trim().min(2).max(160),
  installType: z.enum(['script', 'wordpress']),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).min(1).max(50),
});

const wordpressPluginSchema = z.object({ activationKey: z.string().min(20).max(200) });

function phpSingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizeAllowedDomain(value: string): string {
  const candidate = value.trim().toLowerCase();
  const wildcard = candidate.startsWith('*.');
  const withoutWildcard = wildcard ? candidate.slice(2) : candidate;
  try {
    const parsed = new URL(/^https?:\/\//i.test(withoutWildcard) ? withoutWildcard : `http://${withoutWildcard}`);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host.includes('*')) throw new Error('invalid host');
    return wildcard ? `*.${host}` : host;
  } catch {
    throw new AppError(400, 'INSTALLATION_DOMAIN_INVALID', `El dominio “${value}” no es válido.`);
  }
}

function csvCell(value: unknown): string {
  const normalized = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return `"${normalized.replace(/"/g, '""')}"`;
}

function csvReply(reply: import('fastify').FastifyReply, fileName: string, headers: string[], rows: unknown[][]) {
  const csv = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n');
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${fileName}"`)
    .send(`\ufeff${csv}`);
}

const templateTestSchema = z.object({
  templateId: z.string().regex(/^\d+$/),
  recipient: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/),
  headerParameters: z.array(z.string().max(1024)).max(20).default([]),
  headerMediaUrl: z.url().nullable().optional(),
  parameters: z.array(z.string().max(1024)).max(100).default([]),
});

const aiPromptSchema = z.object({ prompt: z.string().trim().min(1).max(10_000) });

type MetaIntegration = {
  id: string;
  phone_number_id: string | null;
  waba_id: string | null;
  api_base_url: string;
  api_version: string;
  access_token_ciphertext: string | null;
  is_active: boolean;
};

async function metaIntegration(db: Database, companyId: string): Promise<MetaIntegration> {
  const [integration] = await db<MetaIntegration[]>`
    select id::text, phone_number_id, waba_id, api_base_url, api_version, access_token_ciphertext, is_active
    from public.integrations where company_id=${companyId} and provider='whatsapp_cloud' order by id desc limit 1
  `;
  if (!integration?.is_active || !integration.access_token_ciphertext || !integration.phone_number_id) {
    throw new AppError(409, 'INTEGRATION_INCOMPLETE', 'Activa la integración y configura sus credenciales antes de continuar.');
  }
  const base = new URL(integration.api_base_url);
  if (base.protocol !== 'https:' || base.hostname !== 'graph.facebook.com') {
    throw new AppError(400, 'META_BASE_URL_INVALID', 'La URL de Meta debe ser https://graph.facebook.com.');
  }
  return integration;
}

async function graphRequest<T>(integration: MetaIntegration, config: AppConfig, path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const base = integration.api_base_url.replace(/\/$/, '');
    const response = await fetch(`${base}/${integration.api_version}/${path.replace(/^\//, '')}`, {
      headers: { authorization: `Bearer ${decryptSecret(integration.access_token_ciphertext!, config.encryptionKey)}` },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as T & { error?: { message?: string; code?: number } };
    if (!response.ok) throw new AppError(502, 'META_REQUEST_FAILED', body.error?.message ?? `Meta respondió HTTP ${response.status}.`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export function adminRoutes({ auth, db, config }: Dependencies): FastifyPluginAsync {
  const adminGuard = requireAuth(auth, rolesFor('managePlatform'));
  return async (app) => {
    app.get('/admin/companies', { preHandler: adminGuard }, async () => {
      return db`
        select c.id::text, c.name, c.code, c.contact_email, c.contact_phone, c.time_zone, c.is_enabled,
          c.created_at::text,
          (select count(*)::int from public.users u where u.company_id = c.id) as users,
          (select count(*)::int from public.contacts ct where ct.company_id = c.id) as contacts,
          (select count(*)::int from public.conversations cv where cv.company_id = c.id and cv.status <> 'closed') as open_conversations,
          (select count(*)::int from public.messages m where m.company_id = c.id) as messages,
          (select max(m.sent_at)::text from public.messages m where m.company_id = c.id and m.sender = 'contact') as last_inbound_message_at,
          (select count(*)::int from public.company_whatsapp_events e where e.company_id = c.id and not e.success and e.created_at >= now() - interval '7 days') as recent_failures,
          (
            case when c.is_enabled and not exists(select 1 from public.integrations i where i.company_id = c.id and i.is_active) then 1 else 0 end +
            case when c.is_enabled and not exists(select 1 from public.users u where u.company_id = c.id and u.status) then 1 else 0 end +
            case when c.is_enabled and not exists(select 1 from public.users u where u.company_id = c.id and u.role = 'admin' and u.status) then 1 else 0 end +
            (select count(*)::int from public.company_whatsapp_events e where e.company_id = c.id and not e.success and e.created_at >= now() - interval '7 days')
          )::int as alerts_count,
          exists(select 1 from public.integrations i where i.company_id = c.id and i.is_active) as integration_ready
        from public.companies c
        order by c.name
      `;
    });

    app.post('/admin/companies', { preHandler: adminGuard }, async (request, reply) => {
      const input = companyUpsertSchema.parse(request.body);
      const created = await db.begin(async (tx) => {
        const [company] = await tx`
          insert into public.companies(
            name, code, description, contact_email, contact_phone, time_zone, is_enabled,
            flow_key, notification_mode, notification_recipients,
            business_hours_start, business_hours_end, agent_farewell_message
          ) values (
            ${input.name}, ${input.code}, ${input.description ?? null}, ${input.contactEmail ?? null},
            ${input.contactPhone ?? null}, ${input.timeZone}, ${input.isEnabled}, ${input.flowKey ?? null},
            ${input.notificationMode}, ${input.notificationRecipients}, ${input.businessHoursStart ?? null},
            ${input.businessHoursEnd ?? null}, ${input.agentFarewellMessage ?? null}
          ) returning *
        `;
        if (!company) throw new AppError(500, 'CREATE_FAILED', 'No se pudo crear la empresa.');
        const companyId = String(company.id);
        await tx`insert into public.profiles(company_id,name,role) values (${companyId},'Administrador','admin'),(${companyId},'Agente','agent')`;
        const defaultFlow = {
          version: 1,
          nodes: [
            { id: 'start', type: 'start', label: 'Inicio', position: { x: 80, y: 80 }, data: {} },
            { id: 'welcome', type: 'text', label: 'Bienvenida', position: { x: 80, y: 200 }, data: { text: 'Hola, ¿cómo podemos ayudarte?' } },
            { id: 'handoff', type: 'handoff', label: 'Atención humana', position: { x: 80, y: 320 }, data: { reason: 'Nuevo visitante' } },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'welcome' }, { id: 'e2', source: 'welcome', target: 'handoff' }],
        };
        const [flow] = await tx<{ id: string }[]>`
          insert into public.webchatbot_flows(company_id,name,description,status,is_active,builder,published,published_at)
          values (${companyId},'Flujo inicial','Bienvenida y transferencia a un agente','published',true,${tx.json(asJson(defaultFlow))},${tx.json(asJson(defaultFlow))},now()) returning id::text
        `;
        await tx`
          insert into public.webchatbot_widgets(company_id,name,active_flow_id)
          values (${companyId},'Widget principal',${flow!.id})
        `;
        await tx`insert into public.whatsapp_bot_flows(company_id,name,description,builder) values (${companyId},'Flujo inicial','Borrador inicial',${tx.json(asJson(defaultFlow))})`;
        await tx`insert into public.data_retention_policies(company_id) values (${companyId})`;
        return company;
      });
      if (!created) throw new AppError(500, 'CREATE_FAILED', 'No se pudo crear la empresa.');
      await registerAudit(db, request, String(created.id), 'company.created', { code: input.code });
      return reply.code(201).send(created);
    });

    app.get<{ Params: { companyId: string } }>('/admin/companies/:companyId', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId);
      assertCompanyAccess(request, companyId);
      const [company] = await db`
        select c.*,
          (select count(*)::int from public.users u where u.company_id = c.id) as user_count,
          (select count(*)::int from public.conversations cv where cv.company_id = c.id and cv.status <> 'closed') as open_conversations,
          (select count(*)::int from public.contacts ct where ct.company_id = c.id) as contact_count
        from public.companies c where c.id = ${companyId}
      `;
      if (!company) throw notFound('Empresa no encontrada.');
      return company;
    });

    app.put<{ Params: { companyId: string } }>('/admin/companies/:companyId', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId);
      assertCompanyAccess(request, companyId);
      const input = companyUpsertSchema.parse(request.body);
      const [updated] = await db`
        update public.companies set name = ${input.name}, code = ${input.code}, description = ${input.description ?? null},
          contact_email = ${input.contactEmail ?? null}, contact_phone = ${input.contactPhone ?? null}, time_zone = ${input.timeZone},
          is_enabled = ${input.isEnabled}, flow_key = ${input.flowKey ?? null}, notification_mode = ${input.notificationMode},
          notification_recipients = ${input.notificationRecipients}, business_hours_start = ${input.businessHoursStart ?? null},
          business_hours_end = ${input.businessHoursEnd ?? null}, agent_farewell_message = ${input.agentFarewellMessage ?? null}
        where id = ${companyId} returning *
      `;
      if (!updated) throw notFound('Empresa no encontrada.');
      await registerAudit(db, request, companyId, 'company.updated', { code: input.code });
      return updated;
    });

    app.patch<{ Params: { companyId: string } }>('/admin/companies/:companyId/toggle', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId);
      assertCompanyAccess(request, companyId);
      const [updated] = await db`update public.companies set is_enabled=not is_enabled,updated_at=now() where id=${companyId} returning id::text,is_enabled`;
      if (!updated) throw notFound('Empresa no encontrada.');
      await registerAudit(db, request, companyId, 'company.status.changed', { enabled: updated.is_enabled });
      return updated;
    });

    app.get<{ Params: { companyId: string } }>('/admin/companies/:companyId/integration', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId);
      assertCompanyAccess(request, companyId);
      const [integration] = await db`
        select id::text, provider, phone_number_id, waba_id, app_id, api_base_url, api_version, is_active,
          access_token_ciphertext is not null as has_access_token,
          app_secret_ciphertext is not null as has_app_secret,
          verify_token_hash is not null as has_verify_token,
          created_at::text, updated_at::text
        from public.integrations where company_id = ${companyId} and provider = 'whatsapp_cloud'
        order by id desc limit 1
      `;
      return integration ?? null;
    });

    app.put<{ Params: { companyId: string } }>('/admin/companies/:companyId/integration', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId);
      assertCompanyAccess(request, companyId);
      const input = integrationUpsertSchema.parse(request.body);
      const [current] = await db<{ id: string; access_token_ciphertext: string | null; app_secret_ciphertext: string | null; verify_token_hash: string | null }[]>`
        select id::text, access_token_ciphertext, app_secret_ciphertext, verify_token_hash
        from public.integrations where company_id = ${companyId} and provider = 'whatsapp_cloud' order by id desc limit 1
      `;
      const accessToken = input.accessToken ? encryptSecret(input.accessToken, config.encryptionKey) : current?.access_token_ciphertext ?? null;
      const appSecret = input.appSecret ? encryptSecret(input.appSecret, config.encryptionKey) : current?.app_secret_ciphertext ?? null;
      const verifyTokenHash = input.verifyToken ? sha256(input.verifyToken) : current?.verify_token_hash ?? null;
      const [saved] = current
        ? await db`
            update public.integrations set phone_number_id = ${input.phoneNumberId}, waba_id = ${input.wabaId ?? null},
              app_id = ${input.appId ?? null}, access_token_ciphertext = ${accessToken}, app_secret_ciphertext = ${appSecret},
              verify_token_hash = ${verifyTokenHash}, api_base_url = ${input.apiBaseUrl}, api_version = ${input.apiVersion}, is_active = ${input.isActive}
            where company_id = ${companyId} and id = ${current.id} returning id::text, phone_number_id, is_active
          `
        : await db`
            insert into public.integrations(
              company_id, provider, phone_number_id, waba_id, app_id, access_token_ciphertext, app_secret_ciphertext,
              verify_token_hash, api_base_url, api_version, is_active
            ) values (
              ${companyId}, 'whatsapp_cloud', ${input.phoneNumberId}, ${input.wabaId ?? null}, ${input.appId ?? null},
              ${accessToken}, ${appSecret}, ${verifyTokenHash}, ${input.apiBaseUrl}, ${input.apiVersion}, ${input.isActive}
            ) returning id::text, phone_number_id, is_active
          `;
      await registerAudit(db, request, companyId, 'integration.updated', {
        phoneNumberId: input.phoneNumberId,
        rotatedAccessToken: Boolean(input.accessToken),
        rotatedAppSecret: Boolean(input.appSecret),
        rotatedVerifyToken: Boolean(input.verifyToken),
      });
      return saved;
    });

    app.post<{ Params: { companyId: string } }>('/admin/companies/:companyId/integration/test', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const integration = await metaIntegration(db, companyId);
      const result = await graphRequest<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
        integration, config, `${integration.phone_number_id}?fields=id,display_phone_number,verified_name,quality_rating`,
      );
      await registerAudit(db, request, companyId, 'integration.tested', { success: true, phoneNumberId: integration.phone_number_id });
      return { success: true, phoneNumber: result.display_phone_number ?? null, verifiedName: result.verified_name ?? null, qualityRating: result.quality_rating ?? null };
    });

    app.get<{ Params: { companyId: string } }>('/admin/companies/:companyId/users', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId);
      assertCompanyAccess(request, companyId);
      return db`
        select id::text, auth_user_id::text, name, email, phone, role, status, is_online,
          password_migration_status, last_login::text, last_activity::text
        from public.users where company_id = ${companyId} order by role, name
      `;
    });

    app.get<{ Params: { companyId: string } }>('/admin/companies/:companyId/audits', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      return db`
        select id::text, action, detail, actor_name, actor_email, actor_role, request_id::text, created_at::text
        from public.company_admin_audits where company_id=${companyId}
        order by created_at desc limit 200
      `;
    });

    app.get<{ Params: { companyId: string } }>('/admin/companies/:companyId/overview', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const [health] = await db`
        select
          c.is_enabled as company_enabled,
          exists(select 1 from public.integrations i where i.company_id=c.id and i.is_active) as has_active_integration,
          exists(select 1 from public.integrations i where i.company_id=c.id and nullif(i.phone_number_id,'') is not null) as has_phone_number_id,
          exists(select 1 from public.integrations i where i.company_id=c.id and nullif(i.verify_token_hash,'') is not null) as has_verify_token,
          exists(select 1 from public.users u where u.company_id=c.id and u.role='admin' and u.status) as has_primary_admin,
          (select count(*)::int from public.users u where u.company_id=c.id) as total_users,
          (select count(*)::int from public.users u where u.company_id=c.id and u.status) as enabled_users,
          (select count(*)::int from public.users u where u.company_id=c.id and u.status and u.is_online and u.last_activity >= now() - interval '5 minutes') as online_users,
          (select count(*)::int from public.conversations cv where cv.company_id=c.id and cv.status<>'closed') as open_conversations,
          (select '/v1/meta/webhook/' || i.phone_number_id from public.integrations i where i.company_id=c.id and nullif(i.phone_number_id,'') is not null order by i.is_active desc, i.updated_at desc nulls last limit 1) as webhook_path,
          (select max(i.updated_at)::text from public.integrations i where i.company_id=c.id) as integration_updated_at,
          (select max(m.sent_at)::text from public.messages m where m.company_id=c.id and m.sender='contact') as last_inbound_message_at,
          (select e.created_at::text from public.company_whatsapp_events e where e.company_id=c.id and not e.success order by e.created_at desc limit 1) as last_failure_at,
          (select e.summary from public.company_whatsapp_events e where e.company_id=c.id and not e.success order by e.created_at desc limit 1) as last_failure_detail
        from public.companies c where c.id=${companyId}
      `;
      if (!health) throw notFound('Empresa no encontrada.');
      const [summary] = await db`
        select
          (select count(*)::int from public.users where company_id=${companyId}) as users_count,
          (select count(*)::int from public.contacts where company_id=${companyId}) as contacts_count,
          (select count(*)::int from public.conversations where company_id=${companyId} and status<>'closed') as open_conversations_count,
          (select count(*)::int from public.messages where company_id=${companyId}) as messages_count,
          (select max(sent_at)::text from public.messages where company_id=${companyId} and sender='contact') as last_inbound_message_at
      `;
      const events = await db`
        select id::text, event_type, source, success, template_name, language, to_phone_masked, phone_number_id, summary, created_at::text
        from public.company_whatsapp_events where company_id=${companyId} order by created_at desc limit 50
      `;
      return { health, summary, events };
    });

    app.post<{ Params: { companyId: string } }>('/admin/companies/:companyId/users', { preHandler: adminGuard }, async (request, reply) => {
      const companyId = parseId(request.params.companyId);
      assertCompanyAccess(request, companyId);
      const input = userUpsertSchema.parse(request.body);
      const existing = await db`select 1 from public.users where company_id = ${companyId} and lower(email) = lower(${input.email})`;
      if (existing[0]) throw new AppError(409, 'EMAIL_EXISTS', 'Ya existe un usuario con ese correo en la empresa.');

      const directPassword = Boolean(input.password);
      const response = await fetch(`${config.supabaseUrl}/auth/v1/${directPassword ? 'admin/users' : 'invite'}`, {
        method: 'POST',
        headers: {
          apikey: config.supabaseSecretKey,
          authorization: `Bearer ${config.supabaseSecretKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(directPassword
          ? { email: input.email, password: input.password, email_confirm: true, user_metadata: { name: input.name } }
          : { email: input.email, data: { name: input.name } }),
      });
      if (!response.ok) {
        const body = await response.text();
        request.log.warn({ status: response.status, body: body.slice(0, 300) }, 'Supabase user creation failed');
        throw new AppError(502, 'AUTH_USER_CREATE_FAILED', 'Supabase Auth no pudo crear el usuario.');
      }
      const invited = await response.json() as { id?: string; user?: { id?: string } };
      const authUserId = invited.id ?? invited.user?.id;
      if (!authUserId) throw new AppError(502, 'AUTH_USER_CREATE_INVALID', 'Supabase Auth devolvió una respuesta inválida.');
      const [created] = await db`
        insert into public.users(auth_user_id, company_id, name, email, phone, role, status, password_migration_status)
        values (${authUserId}::uuid, ${companyId}, ${input.name}, ${input.email}, ${input.phone ?? null}, ${input.role}, ${input.status}, ${directPassword ? 'completed' : 'invited'})
        returning id::text, auth_user_id::text, name, email, phone, role, status, password_migration_status
      `;
      await registerAudit(db, request, companyId, directPassword ? 'user.created' : 'user.invited', { userId: created?.id, email: input.email, role: input.role });
      return reply.code(201).send(created);
    });

    app.put<{ Params: { companyId: string; userId: string } }>('/admin/companies/:companyId/users/:userId', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const userId = parseId(request.params.userId);
      const input = userUpsertSchema.parse(request.body);
      const [current] = await db<{ auth_user_id: string | null; email: string; role: 'admin' | 'agent' }[]>`
        select auth_user_id::text,email,role from public.users where company_id=${companyId} and id=${userId}
      `;
      if (!current) throw notFound('Usuario no encontrado.');
      const emailChanged = input.email.toLocaleLowerCase() !== current.email.toLocaleLowerCase();
      if (current.role === 'agent' && emailChanged) {
        throw new AppError(403, 'AGENT_EMAIL_IMMUTABLE', 'El correo de una cuenta de agente no se puede editar.');
      }
      if (emailChanged) {
        const [duplicate] = await db`
          select id from public.users where company_id=${companyId} and lower(email)=lower(${input.email}) and id<>${userId} limit 1
        `;
        if (duplicate) throw new AppError(409, 'EMAIL_EXISTS', 'Ya existe un usuario con ese correo en la empresa.');
      }
      let authUserId = current.auth_user_id;
      if (authUserId) {
        const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users/${authUserId}`, {
          method: 'PUT',
          headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ email: input.email, email_confirm: true, user_metadata: { name: input.name }, ...(input.password ? { password: input.password } : {}) }),
        });
        if (!response.ok) throw new AppError(502, 'AUTH_USER_UPDATE_FAILED', 'Supabase Auth no pudo actualizar el usuario.');
      } else if (input.password) {
        const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
          method: 'POST',
          headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ email: input.email, password: input.password, email_confirm: true, user_metadata: { name: input.name } }),
        });
        if (!response.ok) throw new AppError(502, 'AUTH_USER_CREATE_FAILED', 'Supabase Auth no pudo crear el acceso del usuario.');
        const created = await response.json() as { id?: string; user?: { id?: string } };
        authUserId = created.id ?? created.user?.id ?? null;
        if (!authUserId) throw new AppError(502, 'AUTH_USER_CREATE_INVALID', 'Supabase Auth devolvió una respuesta inválida.');
      }
      const [updated] = await db`
        update public.users set auth_user_id=coalesce(${authUserId}::uuid,auth_user_id),name=${input.name},email=${input.email},phone=${input.phone ?? null},role=${input.role},status=${input.status},
          password_migration_status=case when ${Boolean(input.password)} then 'completed' else password_migration_status end,updated_at=now()
        where company_id=${companyId} and id=${userId}
        returning id::text,auth_user_id::text,name,email,phone,role,status,password_migration_status
      `;
      await registerAudit(db, request, companyId, 'user.updated', { userId, email: input.email, role: input.role });
      return updated;
    });

    app.post<{ Params: { companyId: string; userId: string } }>('/admin/companies/:companyId/users/:userId/password', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const userId = parseId(request.params.userId);
      const input = z.object({ password: z.string().min(8).max(72) }).parse(request.body);
      const [user] = await db<{ auth_user_id: string | null; name: string; email: string }[]>`select auth_user_id::text,name,email from public.users where company_id=${companyId} and id=${userId}`;
      if (!user) throw notFound('Usuario no encontrado.');
      const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users${user.auth_user_id ? `/${user.auth_user_id}` : ''}`, {
        method: user.auth_user_id ? 'PUT' : 'POST',
        headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(user.auth_user_id ? { password: input.password } : { email: user.email, password: input.password, email_confirm: true, user_metadata: { name: user.name } }),
      });
      if (!response.ok) throw new AppError(502, 'AUTH_PASSWORD_UPDATE_FAILED', 'Supabase Auth no pudo cambiar la contraseña.');
      let authUserId = user.auth_user_id;
      if (!authUserId) {
        const created = await response.json() as { id?: string; user?: { id?: string } };
        authUserId = created.id ?? created.user?.id ?? null;
        if (!authUserId) throw new AppError(502, 'AUTH_USER_CREATE_INVALID', 'Supabase Auth devolvió una respuesta inválida.');
      }
      await db`update public.users set auth_user_id=${authUserId}::uuid,password_migration_status='completed',updated_at=now() where company_id=${companyId} and id=${userId}`;
      await registerAudit(db, request, companyId, 'user.password.reset', { userId });
      return { updated: true };
    });

    app.patch<{ Params: { companyId: string; userId: string } }>('/admin/companies/:companyId/users/:userId/toggle', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const userId = parseId(request.params.userId);
      if (String(request.session.userId) === userId) throw new AppError(409, 'SELF_DISABLE_FORBIDDEN', 'No puedes deshabilitar tu propia cuenta.');
      const [updated] = await db`
        update public.users set status=not status, is_online=false, last_activity=now()
        where company_id=${companyId} and id=${userId} returning id::text, status
      `;
      if (!updated) throw notFound('Usuario no encontrado.');
      await registerAudit(db, request, companyId, 'user.status.changed', { userId, enabled: updated.status });
      return updated;
    });

    app.post<{ Params: { companyId: string; userId: string } }>('/admin/companies/:companyId/users/:userId/recovery', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const userId = parseId(request.params.userId);
      const [user] = await db<{ email: string }[]>`select email from public.users where company_id=${companyId} and id=${userId}`;
      if (!user) throw notFound('Usuario no encontrado.');
      const response = await fetch(`${config.supabaseUrl}/auth/v1/recover`, {
        method: 'POST',
        headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });
      if (!response.ok) throw new AppError(502, 'AUTH_RECOVERY_FAILED', 'Supabase Auth no pudo enviar el correo de recuperación.');
      await registerAudit(db, request, companyId, 'user.recovery.requested', { userId });
      return { sent: true };
    });

    app.get<{ Params: { companyId: string } }>('/admin/companies/:companyId/templates', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      return db`select id::text, name, language, template_identifier, body_param_count, is_active, meta_status, meta_category, meta_components, updated_at::text from public.whatsapp_templates where company_id = ${companyId} order by name, language`;
    });

    app.post<{ Params: { companyId: string } }>('/admin/companies/:companyId/templates', { preHandler: adminGuard }, async (request, reply) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const input = templateSchema.parse(request.body);
      const [saved] = await db`
        insert into public.whatsapp_templates(company_id, name, language, template_identifier, body_param_count, is_active, meta_status, meta_category, meta_components)
        values (${companyId}, ${input.name}, ${input.language}, ${input.templateIdentifier ?? null}, ${input.bodyParamCount}, ${input.isActive}, ${input.metaStatus ?? null}, ${input.metaCategory ?? null}, ${db.json(asJson(input.metaComponents))})
        on conflict (company_id, name, language) do update set template_identifier = excluded.template_identifier,
          body_param_count = excluded.body_param_count, is_active = excluded.is_active, meta_status = excluded.meta_status,
          meta_category = excluded.meta_category, meta_components = excluded.meta_components
        returning *
      `;
      await registerAudit(db, request, companyId, 'template.upserted', { name: input.name, language: input.language });
      return reply.code(201).send(saved);
    });

    app.put<{ Params: { companyId: string; templateId: string } }>('/admin/companies/:companyId/templates/:templateId', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const templateId = parseId(request.params.templateId);
      const input = templateSchema.parse(request.body);
      const [saved] = await db`
        update public.whatsapp_templates set name=${input.name},language=${input.language},template_identifier=${input.templateIdentifier ?? null},
          body_param_count=${input.bodyParamCount},is_active=${input.isActive},meta_components=${db.json(asJson(input.metaComponents))},updated_at=now()
        where company_id=${companyId} and id=${templateId} returning *
      `;
      if (!saved) throw notFound('Plantilla no encontrada.');
      await registerAudit(db, request, companyId, 'template.updated', { templateId, name: input.name, language: input.language });
      return saved;
    });

    app.delete<{ Params: { companyId: string; templateId: string } }>('/admin/companies/:companyId/templates/:templateId', { preHandler: adminGuard }, async (request, reply) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const templateId = parseId(request.params.templateId);
      const [removed] = await db`delete from public.whatsapp_templates where company_id=${companyId} and id=${templateId} returning id::text, name, language`;
      if (!removed) throw notFound('Plantilla no encontrada.');
      await registerAudit(db, request, companyId, 'template.deleted', { templateId, name: removed.name, language: removed.language });
      return reply.code(204).send();
    });

    app.post<{ Params: { companyId: string } }>('/admin/companies/:companyId/templates/sync', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const integration = await metaIntegration(db, companyId);
      if (!integration.waba_id) throw new AppError(409, 'WABA_ID_REQUIRED', 'Configura el WABA ID antes de sincronizar plantillas.');
      const result = await graphRequest<{ data?: Array<{ id?: string; name?: string; language?: string; status?: string; category?: string; components?: Array<Record<string, unknown>> }> }>(
        integration, config, `${integration.waba_id}/message_templates?fields=id,name,language,status,category,components&limit=250`,
      );
      let synced = 0;
      for (const template of result.data ?? []) {
        if (!template.name || !template.language) continue;
        const components = template.components ?? [];
        const body = components.find((component) => component.type === 'BODY');
        const bodyText = typeof body?.text === 'string' ? body.text : '';
        const bodyParamCount = Math.max(0, ...Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1] ?? 0)));
        const header = components.find((component) => component.type === 'HEADER');
        const headerText = typeof header?.text === 'string' ? header.text : '';
        const headerParamCount = Math.max(0, ...Array.from(headerText.matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1] ?? 0)));
        const buttons = components.find((component) => component.type === 'BUTTONS');
        const buttonCount = Array.isArray(buttons?.buttons) ? buttons.buttons.length : 0;
        await db`
          insert into public.whatsapp_templates(
            company_id,name,language,template_identifier,body_param_count,is_active,meta_status,meta_category,
            meta_header_format,meta_header_param_count,meta_button_count,meta_components
          ) values (
            ${companyId},${template.name},${template.language},${template.id ?? null},${bodyParamCount},true,
            ${template.status ?? null},${template.category ?? null},${typeof header?.format === 'string' ? header.format : null},
            ${headerParamCount},${buttonCount},${db.json(asJson(components))}
          ) on conflict(company_id,name,language) do update set template_identifier=excluded.template_identifier,
            body_param_count=excluded.body_param_count,is_active=true,meta_status=excluded.meta_status,
            meta_category=excluded.meta_category,meta_header_format=excluded.meta_header_format,
            meta_header_param_count=excluded.meta_header_param_count,meta_button_count=excluded.meta_button_count,
            meta_components=excluded.meta_components,updated_at=now()
        `;
        synced += 1;
      }
      await registerAudit(db, request, companyId, 'templates.synced', { count: synced });
      return { synced };
    });

    app.post<{ Params: { companyId: string } }>('/admin/companies/:companyId/templates/test-send', { preHandler: adminGuard }, async (request, reply) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const input = templateTestSchema.parse(request.body);
      const integration = await metaIntegration(db, companyId);
      const [template] = await db<{ name: string; language: string; body_param_count: number; meta_status: string | null; meta_header_format: string | null; meta_header_param_count: number }[]>`
        select name,language,body_param_count,meta_status,meta_header_format,meta_header_param_count from public.whatsapp_templates where company_id=${companyId} and id=${input.templateId} and is_active
      `;
      if (!template) throw notFound('Plantilla no encontrada.');
      if (template.meta_status && template.meta_status !== 'APPROVED') throw new AppError(409, 'TEMPLATE_NOT_APPROVED', 'Meta todavía no ha aprobado esta plantilla.');
      if (input.parameters.length !== template.body_param_count) throw new AppError(400, 'TEMPLATE_PARAMETER_COUNT', `La plantilla requiere ${template.body_param_count} parámetros.`);
      if (input.headerParameters.length !== template.meta_header_param_count) throw new AppError(400, 'TEMPLATE_HEADER_PARAMETER_COUNT', `La cabecera requiere ${template.meta_header_param_count} parámetros.`);
      const idempotencyKey = `template-test:${companyId}:${randomUUID()}`;
      const [queued] = await db`
        insert into public.outbox_messages(company_id,integration_id,idempotency_key,phone_number_id,recipient,type,content)
        values (${companyId},${integration.id},${idempotencyKey},${integration.phone_number_id},${input.recipient},'template',${db.json(asJson({ name: template.name, language: template.language, parameters: input.parameters, headerParameters: input.headerParameters, headerMediaUrl: input.headerMediaUrl ?? null, headerFormat: template.meta_header_format }))})
        returning id::text,status
      `;
      await registerAudit(db, request, companyId, 'template.test.queued', { templateId: input.templateId, outboxId: queued?.id });
      return reply.code(202).send(queued);
    });

    app.get<{ Params: { companyId: string } }>('/admin/companies/:companyId/ai', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const [settings] = await db`
        select id::text, is_enabled, provider, model, api_base_url, response_mode, system_prompt, fallback_message,
          temperature::float8, max_tokens, daily_message_limit, monthly_message_limit, pause_when_assigned,
          escalate_on_human_request, api_key_ciphertext is not null as has_api_key,
          last_tested_at::text, last_test_success, last_test_message
        from public.company_ai_settings where company_id = ${companyId}
      `;
      const knowledge = await db`select id::text, title, category, content, is_active, updated_at::text from public.company_ai_knowledge_items where company_id = ${companyId} order by category nulls last, title`;
      return { settings: settings ?? null, knowledge };
    });

    app.get<{ Params: { companyId: string }; Querystring: { days?: string } }>('/admin/companies/:companyId/ai/analytics', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const days = Math.min(180, Math.max(1, Number(request.query.days) || 30));
      const [summary] = await db`
        select
          count(*)::int as total_requests,
          count(*) filter (where success)::int as successful_requests,
          count(*) filter (where not success)::int as failed_requests,
          coalesce(sum(estimated_cost_usd),0)::float8 as estimated_cost_usd,
          coalesce(sum(total_tokens),0)::int as total_tokens,
          coalesce(sum(prompt_tokens),0)::int as prompt_tokens,
          coalesce(sum(completion_tokens),0)::int as completion_tokens,
          count(*) filter (where success and created_at >= date_trunc('day',now()))::int as today_messages,
          count(*) filter (where success and created_at >= date_trunc('month',now()))::int as month_messages,
          coalesce(sum(total_tokens) filter (where created_at >= date_trunc('day',now())),0)::int as today_tokens,
          coalesce(sum(total_tokens) filter (where created_at >= date_trunc('month',now())),0)::int as month_tokens,
          coalesce(sum(estimated_cost_usd) filter (where created_at >= date_trunc('day',now())),0)::float8 as today_estimated_cost_usd,
          coalesce(sum(estimated_cost_usd) filter (where created_at >= date_trunc('month',now())),0)::float8 as month_estimated_cost_usd
        from public.ai_usage_logs
        where company_id=${companyId} and created_at >= date_trunc('day',now()) - (${days - 1} * interval '1 day')
      `;
      const byProvider = await db`
        select provider,count(*)::int as requests,count(*) filter (where success)::int as successes,
          count(*) filter (where not success)::int as failures,coalesce(sum(total_tokens),0)::int as tokens,
          coalesce(sum(estimated_cost_usd),0)::float8 as estimated_cost_usd
        from public.ai_usage_logs where company_id=${companyId}
          and created_at >= date_trunc('day',now()) - (${days - 1} * interval '1 day')
        group by provider order by requests desc
      `;
      const byModel = await db`
        select provider,model,count(*)::int as requests,coalesce(sum(total_tokens),0)::int as tokens,
          coalesce(sum(estimated_cost_usd),0)::float8 as estimated_cost_usd
        from public.ai_usage_logs where company_id=${companyId}
          and created_at >= date_trunc('day',now()) - (${days - 1} * interval '1 day')
        group by provider,model order by requests desc
      `;
      const byDecision = await db`
        select decision,count(*)::int as count,count(*) filter (where success)::int as successful,
          count(*) filter (where escalated_to_human)::int as escalated
        from public.ai_conversation_logs where company_id=${companyId}
          and created_at >= date_trunc('day',now()) - (${days - 1} * interval '1 day')
        group by decision order by count desc
      `;
      const daily = await db`
        select created_at::date::text as date,count(*)::int as requests,coalesce(sum(total_tokens),0)::int as tokens,
          coalesce(sum(estimated_cost_usd),0)::float8 as estimated_cost_usd
        from public.ai_usage_logs where company_id=${companyId}
          and created_at >= date_trunc('day',now()) - (${days - 1} * interval '1 day')
        group by created_at::date order by created_at::date
      `;
      const recentConversations = await db`
        select id::text,conversation_id::text,provider,model,decision,success,escalated_to_human,
          response_text,error_code as error_message,created_at::text
        from public.ai_conversation_logs where company_id=${companyId}
          and created_at >= date_trunc('day',now()) - (${days - 1} * interval '1 day')
        order by created_at desc limit 80
      `;
      return { days, summary, byProvider, byModel, byDecision, daily, recentConversations };
    });

    app.put<{ Params: { companyId: string } }>('/admin/companies/:companyId/ai', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const input = aiSettingsSchema.parse(request.body);
      const [current] = await db<{ api_key_ciphertext: string | null }[]>`select api_key_ciphertext from public.company_ai_settings where company_id = ${companyId}`;
      const apiKey = input.apiKey ? encryptSecret(input.apiKey, config.encryptionKey) : current?.api_key_ciphertext ?? null;
      const [saved] = await db`
        insert into public.company_ai_settings(
          company_id, is_enabled, provider, model, api_key_ciphertext, api_base_url, response_mode, system_prompt,
          fallback_message, temperature, max_tokens, daily_message_limit, monthly_message_limit,
          pause_when_assigned, escalate_on_human_request
        ) values (
          ${companyId}, ${input.isEnabled}, ${input.provider}, ${input.model}, ${apiKey}, ${input.apiBaseUrl ?? null},
          ${input.responseMode}, ${input.systemPrompt ?? null}, ${input.fallbackMessage ?? null}, ${input.temperature},
          ${input.maxTokens}, ${input.dailyMessageLimit ?? null}, ${input.monthlyMessageLimit ?? null},
          ${input.pauseWhenAssigned}, ${input.escalateOnHumanRequest}
        ) on conflict (company_id) do update set is_enabled = excluded.is_enabled, provider = excluded.provider,
          model = excluded.model, api_key_ciphertext = excluded.api_key_ciphertext, api_base_url = excluded.api_base_url,
          response_mode = excluded.response_mode, system_prompt = excluded.system_prompt, fallback_message = excluded.fallback_message,
          temperature = excluded.temperature, max_tokens = excluded.max_tokens, daily_message_limit = excluded.daily_message_limit,
          monthly_message_limit = excluded.monthly_message_limit, pause_when_assigned = excluded.pause_when_assigned,
          escalate_on_human_request = excluded.escalate_on_human_request
        returning id::text, is_enabled, provider, model, response_mode
      `;
      await registerAudit(db, request, companyId, 'ai.settings.updated', { provider: input.provider, model: input.model, rotatedKey: Boolean(input.apiKey) });
      return saved;
    });

    app.post<{ Params: { companyId: string } }>('/admin/companies/:companyId/ai/knowledge', { preHandler: adminGuard }, async (request, reply) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const input = knowledgeSchema.parse(request.body);
      const [saved] = await db`
        insert into public.company_ai_knowledge_items(company_id, title, category, content, is_active)
        values (${companyId}, ${input.title}, ${input.category ?? null}, ${input.content}, ${input.isActive}) returning *
      `;
      return reply.code(201).send(saved);
    });

    app.delete<{ Params: { companyId: string; itemId: string } }>('/admin/companies/:companyId/ai/knowledge/:itemId', { preHandler: adminGuard }, async (request, reply) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const itemId = parseId(request.params.itemId);
      const [removed] = await db`delete from public.company_ai_knowledge_items where company_id=${companyId} and id=${itemId} returning id::text,title`;
      if (!removed) throw notFound('Elemento de conocimiento no encontrado.');
      await registerAudit(db, request, companyId, 'ai.knowledge.deleted', { itemId, title: removed.title });
      return reply.code(204).send();
    });

    app.post<{ Params: { companyId: string } }>('/admin/companies/:companyId/ai/test', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const input = aiPromptSchema.parse(request.body ?? { prompt: 'Responde únicamente: conexión correcta' });
      const [settings] = await db<AiSettings[]>`select * from public.company_ai_settings where company_id=${companyId}`;
      if (!settings?.api_key_ciphertext) throw new AppError(409, 'AI_KEY_REQUIRED', 'Configura una API key antes de probar el proveedor.');
      try {
        const result = await callAiProvider(settings, decryptSecret(settings.api_key_ciphertext, config.encryptionKey), [
          { role: 'system', content: settings.system_prompt ?? 'Responde de forma breve y útil.' },
          { role: 'user', content: input.prompt },
        ]);
        await db.begin(async (tx) => {
          await tx`update public.company_ai_settings set last_tested_at=now(),last_test_success=true,last_test_message='Conexión correcta' where company_id=${companyId}`;
          await tx`insert into public.ai_usage_logs(company_id,provider,model,prompt_tokens,completion_tokens,total_tokens,success,duration_ms,reason) values (${companyId},${settings.provider},${settings.model},${result.promptTokens},${result.completionTokens},${result.totalTokens},true,${result.durationMs},'admin_test')`;
        });
        await registerAudit(db, request, companyId, 'ai.provider.tested', { success: true, provider: settings.provider, model: settings.model });
        return { success: true, response: result.text, usage: { promptTokens: result.promptTokens, completionTokens: result.completionTokens, totalTokens: result.totalTokens }, durationMs: result.durationMs };
      } catch (error) {
        const summary = error instanceof Error ? error.message.slice(0, 300) : 'Error desconocido';
        await db`update public.company_ai_settings set last_tested_at=now(),last_test_success=false,last_test_message=${summary} where company_id=${companyId}`;
        await registerAudit(db, request, companyId, 'ai.provider.tested', { success: false, provider: settings.provider, model: settings.model });
        throw new AppError(502, 'AI_PROVIDER_FAILED', 'El proveedor de IA rechazó la prueba. Revisa credenciales, modelo y URL base.');
      }
    });

    for (const kind of ['whatsapp', 'webchat'] as const) {
      const table = kind === 'whatsapp' ? 'whatsapp_bot_flows' : 'webchatbot_flows';
      app.get<{ Params: { companyId: string } }>(`/admin/companies/:companyId/flows/${kind}`, { preHandler: adminGuard }, async (request) => {
        const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
        return db.unsafe(`select id::text, name, description, status, is_active, builder, published, updated_at::text, published_at::text from public.${table} where company_id = $1 and status <> 'archived' order by updated_at desc nulls last, created_at desc`, [companyId]);
      });
      app.post<{ Params: { companyId: string } }>(`/admin/companies/:companyId/flows/${kind}`, { preHandler: adminGuard }, async (request, reply) => {
        const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
        const input = flowSchema.parse(request.body);
        const saved = await db.begin(async (tx) => {
          if (input.isActive) await tx.unsafe(`update public.${table} set is_active=false where company_id=$1`, [companyId]);
          const rows = await tx.unsafe(`insert into public.${table}(company_id, name, description, is_active, builder) values ($1,$2,$3,$4,$5::jsonb) returning *`, [companyId, input.name, input.description ?? null, input.isActive, JSON.stringify(input.document)]);
          return rows[0];
        });
        return reply.code(201).send(saved);
      });
      app.put<{ Params: { companyId: string; flowId: string } }>(`/admin/companies/:companyId/flows/${kind}/:flowId`, { preHandler: adminGuard }, async (request) => {
        const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
        const flowId = parseId(request.params.flowId);
        const input = flowSchema.parse(request.body);
        const saved = await db.begin(async (tx) => {
          if (input.isActive) await tx.unsafe(`update public.${table} set is_active=false where company_id=$1 and id<>$2`, [companyId, flowId]);
          const rows = await tx.unsafe(
            `update public.${table} set name=$3,description=$4,is_active=$5,builder=$6::jsonb,updated_at=now() where company_id=$1 and id=$2 and status<>'archived' returning *`,
            [companyId, flowId, input.name, input.description ?? null, input.isActive, JSON.stringify(input.document)],
          );
          return rows[0];
        });
        if (!saved) throw notFound('Flujo no encontrado.');
        await registerAudit(db, request, companyId, `${kind}.flow.updated`, { flowId });
        return saved;
      });
      app.post<{ Params: { companyId: string; flowId: string } }>(`/admin/companies/:companyId/flows/${kind}/:flowId/publish`, { preHandler: adminGuard }, async (request) => {
        const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
        const flowId = parseId(request.params.flowId);
        return db.begin(async (tx) => {
          const rows = await tx.unsafe(`select builder from public.${table} where company_id = $1 and id = $2 for update`, [companyId, flowId]);
          const flow = rows[0] as { builder?: unknown } | undefined;
          if (!flow) throw notFound('Flujo no encontrado.');
          flowDocumentSchema.parse(flow.builder);
          await tx.unsafe(`update public.${table} set is_active = false where company_id = $1`, [companyId]);
          const [published] = await tx.unsafe(`update public.${table} set status='published', is_active=true, published=builder, published_at=now() where company_id=$1 and id=$2 returning *`, [companyId, flowId]);
          return published;
        });
      });
      app.post<{ Params: { companyId: string; flowId: string } }>(`/admin/companies/:companyId/flows/${kind}/:flowId/activate`, { preHandler: adminGuard }, async (request) => {
        const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
        const flowId = parseId(request.params.flowId);
        return db.begin(async (tx) => {
          const rows = await tx.unsafe(`select id from public.${table} where company_id=$1 and id=$2 and published is not null and status<>'archived' for update`, [companyId, flowId]);
          if (!rows[0]) throw new AppError(409, 'FLOW_NOT_PUBLISHED', 'Publica el flujo antes de activarlo.');
          await tx.unsafe(`update public.${table} set is_active=false where company_id=$1`, [companyId]);
          const [activated] = await tx.unsafe(`update public.${table} set is_active=true,status='published',updated_at=now() where company_id=$1 and id=$2 returning *`, [companyId, flowId]);
          return activated;
        });
      });
      app.delete<{ Params: { companyId: string; flowId: string } }>(`/admin/companies/:companyId/flows/${kind}/:flowId`, { preHandler: adminGuard }, async (request, reply) => {
        const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
        const flowId = parseId(request.params.flowId);
        const archived = await db.begin(async (tx) => {
          if (kind === 'webchat') await tx`update public.webchatbot_widgets set active_flow_id=null where company_id=${companyId} and active_flow_id=${flowId}`;
          const [updated] = await tx.unsafe(`update public.${table} set status='archived',is_active=false,updated_at=now() where company_id=$1 and id=$2 and status<>'archived' returning id::text`, [companyId, flowId]);
          return updated;
        });
        if (!archived) throw notFound('Flujo no encontrado.');
        await registerAudit(db, request, companyId, `${kind}.flow.archived`, { flowId });
        return reply.code(204).send();
      });
    }

    app.get<{ Params: { companyId: string } }>('/admin/companies/:companyId/widgets', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const widgets = await db`
        select id::text, name, is_active, active_flow_id::text, primary_color, accent_color, background_color,
          text_color, font_family, position, header_title, welcome_text, placeholder_text, bubble_text,
          brand_text, show_branding, allow_free_text, allow_live_chat, border_radius, launcher_icon,
          conversation_empty_image, content, updated_at::text
        from public.webchatbot_widgets where company_id = ${companyId} order by name
      `;
      const installations = await db`
        select id::text, widget_id::text, name, install_type, activation_key_prefix, allowed_domains,
          is_active, created_at::text, last_used_at::text
        from public.webchatbot_installation_keys where company_id = ${companyId} order by created_at desc
      `;
      const [analytics] = await db`
        select
          count(*) filter (where started_at >= now() - interval '7 days')::int as started_sessions,
          count(*) filter (where status = 'active')::int as active_sessions,
          count(*) filter (where live_chat_requested and started_at >= now() - interval '7 days')::int as live_chat_requests
        from public.webchatbot_sessions where company_id = ${companyId}
      `;
      return { widgets, installations, analytics: analytics ?? { started_sessions: 0, active_sessions: 0, live_chat_requests: 0 } };
    });

    app.put<{ Params: { companyId: string; widgetId: string } }>('/admin/companies/:companyId/widgets/:widgetId', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const widgetId = parseId(request.params.widgetId);
      const input = widgetSchema.parse(request.body);
      if (input.activeFlowId !== null && input.activeFlowId !== undefined) {
        const flow = await db`select 1 from public.webchatbot_flows where company_id = ${companyId} and id = ${input.activeFlowId}`;
        if (!flow[0]) throw notFound('Flujo webchat no encontrado.');
      }
      const [saved] = await db`
        update public.webchatbot_widgets set name = ${input.name}, is_active = ${input.isActive},
          active_flow_id = ${input.activeFlowId ?? null}, primary_color = ${input.primaryColor}, accent_color = ${input.accentColor},
          background_color = ${input.backgroundColor}, text_color = ${input.textColor}, font_family = ${input.fontFamily},
          position = ${input.position}, header_title = ${input.headerTitle}, welcome_text = ${input.welcomeText},
          placeholder_text = ${input.placeholderText}, bubble_text = ${input.bubbleText}, brand_text = ${input.brandText},
          show_branding = ${input.showBranding}, allow_free_text = ${input.allowFreeText}, allow_live_chat = ${input.allowLiveChat},
          border_radius = ${input.borderRadius}, launcher_icon = ${input.launcherIcon ?? null},
          conversation_empty_image = ${input.conversationEmptyImage ?? null}, content = ${db.json(asJson(input.content))}
        where company_id = ${companyId} and id = ${widgetId} returning *
      `;
      if (!saved) throw notFound('Widget no encontrado.');
      await registerAudit(db, request, companyId, 'webchat.widget.updated', { widgetId: widgetId.toString() });
      return saved;
    });

    app.post<{ Params: { companyId: string; widgetId: string; kind: string } }>('/admin/companies/:companyId/widgets/:widgetId/assets/:kind', { preHandler: adminGuard }, async (request, reply) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const widgetId = parseId(request.params.widgetId);
      if (!['launcher', 'empty'].includes(request.params.kind)) throw new AppError(400, 'ASSET_KIND_INVALID', 'Tipo de recurso visual inválido.');
      const widget = await db`select 1 from public.webchatbot_widgets where company_id=${companyId} and id=${widgetId}`;
      if (!widget[0]) throw notFound('Widget no encontrado.');
      const part = await request.file();
      if (!part) throw new AppError(400, 'FILE_REQUIRED', 'Selecciona una imagen.');
      const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
      const extension = extensions[part.mimetype];
      if (!extension) throw new AppError(415, 'FILE_TYPE_NOT_ALLOWED', 'Usa una imagen JPG, PNG, WebP o SVG.');
      const bytes = await part.toBuffer();
      if (bytes.length > 5 * 1024 * 1024) throw new AppError(413, 'FILE_TOO_LARGE', 'La imagen no puede superar 5 MB.');
      if (extension === 'svg' && /<script|\bon\w+\s*=|javascript:/i.test(bytes.toString('utf8'))) throw new AppError(415, 'SVG_UNSAFE', 'El SVG contiene contenido no permitido.');
      const storagePath = `${companyId}/${widgetId}/${request.params.kind}-${randomUUID()}.${extension}`;
      const upload = await fetch(`${config.supabaseUrl}/storage/v1/object/widget-assets/${encodeURIComponent(storagePath).replace(/%2F/g, '/')}`, {
        method: 'POST',
        headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': part.mimetype, 'x-upsert': 'false' },
        body: new Uint8Array(bytes),
      });
      if (!upload.ok) throw new AppError(502, 'STORAGE_UPLOAD_FAILED', 'No se pudo guardar la imagen del widget.');
      const url = `${config.supabaseUrl}/storage/v1/object/public/widget-assets/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
      if (request.params.kind === 'launcher') await db`update public.webchatbot_widgets set launcher_icon=${url} where company_id=${companyId} and id=${widgetId}`;
      else await db`update public.webchatbot_widgets set conversation_empty_image=${url} where company_id=${companyId} and id=${widgetId}`;
      await registerAudit(db, request, companyId, 'webchat.widget.asset.updated', { widgetId, kind: request.params.kind, mimeType: part.mimetype, sizeBytes: bytes.length });
      return reply.code(201).send({ url });
    });

    app.post<{ Params: { companyId: string } }>('/admin/companies/:companyId/installations', { preHandler: adminGuard }, async (request, reply) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const input = installationSchema.parse(request.body);
      const allowedDomains = [...new Set(input.allowedDomains.map(normalizeAllowedDomain))];
      const widget = await db`select 1 from public.webchatbot_widgets where company_id = ${companyId} and id = ${input.widgetId}`;
      if (!widget[0]) throw notFound('Widget no encontrado.');
      const activationKey = createOpaqueToken(36);
      const [created] = await db`
        insert into public.webchatbot_installation_keys(
          company_id, widget_id, name, install_type, activation_key_hash, activation_key_prefix, allowed_domains
        ) values (
          ${companyId}, ${input.widgetId}, ${input.name}, ${input.installType}, ${sha256(activationKey)},
          ${activationKey.slice(0, 8)}, ${allowedDomains}
        ) returning id::text, name, install_type, activation_key_prefix, allowed_domains, is_active, created_at::text
      `;
      await registerAudit(db, request, companyId, 'webchat.installation.created', { installationId: created?.id, domains: allowedDomains });
      return reply.code(201).send({ ...created, activationKey });
    });

    app.patch<{ Params: { companyId: string; installationId: string } }>('/admin/companies/:companyId/installations/:installationId/toggle', { preHandler: adminGuard }, async (request) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const installationId = parseId(request.params.installationId);
      const [updated] = await db`update public.webchatbot_installation_keys set is_active = not is_active where company_id = ${companyId} and id = ${installationId} returning id::text, is_active`;
      if (!updated) throw notFound('Instalación no encontrada.');
      await registerAudit(db, request, companyId, 'webchat.installation.status.changed', { installationId, enabled: updated.is_active });
      return updated;
    });

    app.post<{ Params: { companyId: string; installationId: string } }>('/admin/companies/:companyId/installations/:installationId/wordpress-plugin', { preHandler: adminGuard }, async (request, reply) => {
      const companyId = parseId(request.params.companyId); assertCompanyAccess(request, companyId);
      const installationId = parseId(request.params.installationId);
      const input = wordpressPluginSchema.parse(request.body);
      const [installation] = await db<{ id: string; name: string; install_type: string; activation_key_hash: string }[]>`
        select id::text, name, install_type, activation_key_hash
        from public.webchatbot_installation_keys
        where company_id=${companyId} and id=${installationId}
      `;
      if (!installation) throw notFound('Instalación no encontrada.');
      if (installation.install_type !== 'wordpress') throw new AppError(409, 'INSTALLATION_TYPE_INVALID', 'Esta instalación no es de tipo WordPress.');
      if (!safeEqualText(sha256(input.activationKey), installation.activation_key_hash)) {
        throw new AppError(403, 'ACTIVATION_KEY_INVALID', 'La clave temporal no corresponde a esta instalación.');
      }

      const widgetUrl = phpSingleQuoted(config.publicWidgetUrl);
      const apiUrl = phpSingleQuoted(`${config.publicApiUrl}/v1`);
      const activationKey = phpSingleQuoted(input.activationKey);
      const plugin = `<?php
/**
 * Plugin Name: Grupo Movensa Webchat
 * Description: Instala el widget seguro de atención de Grupo Movensa en este sitio.
 * Version: 1.1.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */
if (!defined('ABSPATH')) { exit; }

function movensa_webchat_render_widget() {
    static $rendered = false;
    if ($rendered || is_admin()) { return; }
    $rendered = true;
    $widget_url = '${widgetUrl}';
    $api_url = '${apiUrl}';
    $activation_key = '${activationKey}';
    printf(
        '<script id="movensa-webchat-script" src="%s" data-key="%s" data-api-url="%s" defer></script>' . "\n",
        esc_url($widget_url),
        esc_attr($activation_key),
        esc_url($api_url)
    );
}
add_action('wp_footer', 'movensa_webchat_render_widget', PHP_INT_MAX);
`;
      const readme = `Grupo Movensa Webchat\n\nInstalación\n1. En WordPress abre Plugins > Añadir plugin > Subir plugin.\n2. Selecciona este ZIP, instálalo y activa “Grupo Movensa Webchat”.\n3. Limpia la caché de WordPress/CDN y abre el sitio en uno de los dominios autorizados.\n\nEl plugin carga el script con defer al final de la página, evita duplicados y no modifica el contenido del tema. La clave incluida pertenece únicamente a la instalación “${installation.name}”. Si se expone o se pierde, pausa esta instalación y genera otra desde Grupo Movensa.\n`;
      const archive = zipSync({
        'movensa-webchat/movensa-webchat.php': strToU8(plugin),
        'movensa-webchat/readme.txt': strToU8(readme),
      }, { level: 9 });
      await registerAudit(db, request, companyId, 'webchat.wordpress_plugin.downloaded', { installationId });
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', 'attachment; filename="movensa-webchat.zip"')
        .send(Buffer.from(archive));
    });

    app.get('/admin/operations', { preHandler: adminGuard }, async () => {
      const overview = await loadAdminOverview(db);
      const failures = await db`
        select id::text, company_id::text, type, status, attempts, error_code, left(error_message, 300) as error_message, created_at::text
        from public.outbox_messages where status in ('failed','dead_letter') order by created_at desc limit 50
      `;
      return { ...overview, failures };
    });

    app.get<{ Params: { kind: string } }>('/admin/operations/export/:kind', { preHandler: adminGuard }, async (request, reply) => {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
      if (request.params.kind === 'companies') {
        const rows = await db<Array<Record<string, unknown>>>`
          select c.name,c.code,c.is_enabled,
            exists(select 1 from public.integrations i where i.company_id=c.id and i.is_active) as has_integration,
            (select i.phone_number_id from public.integrations i where i.company_id=c.id and i.is_active order by i.id desc limit 1) as phone_number_id,
            (select count(*)::int from public.users u where u.company_id=c.id) as users,
            (select count(*)::int from public.contacts ct where ct.company_id=c.id) as contacts,
            (select count(*)::int from public.conversations cv where cv.company_id=c.id and cv.status<>'closed') as open_conversations,
            (select count(*)::int from public.messages m where m.company_id=c.id) as messages,
            (select max(m.sent_at)::text from public.messages m where m.company_id=c.id and m.sender='contact') as last_inbound,
            c.created_at::text,c.updated_at::text
          from public.companies c order by c.name
        `;
        return csvReply(reply, `movensa-empresas-${stamp}.csv`, ['Empresa','Código','Estado','Con integración','Phone Number ID','Usuarios','Contactos','Chats abiertos','Mensajes','Último inbound','Creada','Actualizada'], rows.map((row) => [row.name,row.code,row.is_enabled ? 'Habilitada' : 'Deshabilitada',row.has_integration ? 'Sí' : 'No',row.phone_number_id,row.users,row.contacts,row.open_conversations,row.messages,row.last_inbound,row.created_at,row.updated_at]));
      }
      if (request.params.kind === 'users') {
        const rows = await db<Array<Record<string, unknown>>>`
          select coalesce(c.name,'Sin empresa') as company,u.name,u.email,u.phone,u.role,u.status,u.is_online,u.last_activity::text
          from public.users u left join public.companies c on c.id=u.company_id order by c.name nulls last,u.name
        `;
        return csvReply(reply, `movensa-usuarios-${stamp}.csv`, ['Empresa','Usuario','Correo','Teléfono','Rol','Estado','Online','Última actividad'], rows.map((row) => [row.company,row.name,row.email,row.phone,row.role,row.status,row.is_online ? 'Sí' : 'No',row.last_activity]));
      }
      if (request.params.kind === 'events') {
        const rows = await db<Array<Record<string, unknown>>>`
          select e.created_at::text,c.name as company,e.event_type,e.source,e.success,e.template_name,e.language,
            e.to_phone_masked,e.phone_number_id,e.summary,e.detail
          from public.company_whatsapp_events e left join public.companies c on c.id=e.company_id
          order by e.created_at desc limit 2000
        `;
        return csvReply(reply, `movensa-eventos-whatsapp-${stamp}.csv`, ['Fecha','Empresa','Tipo','Origen','Resultado','Plantilla','Idioma','Destino','Phone Number ID','Resumen','Detalle'], rows.map((row) => [row.created_at,row.company,row.event_type,row.source,row.success ? 'OK' : 'Error',row.template_name,row.language,row.to_phone_masked,row.phone_number_id,row.summary,row.detail]));
      }
      if (request.params.kind === 'sessions') {
        const rows = await db<Array<Record<string, unknown>>>`
          select e.created_at::text,coalesce(c.name,'Sin empresa') as company,e.user_name,e.email,e.role,e.event_type,e.success,e.ip_address::text,e.detail
          from public.user_session_events e left join public.companies c on c.id=e.company_id
          order by e.created_at desc limit 3000
        `;
        return csvReply(reply, `movensa-sesiones-${stamp}.csv`, ['Fecha','Empresa','Usuario','Correo','Rol','Evento','Resultado','IP','Detalle'], rows.map((row) => [row.created_at,row.company,row.user_name,row.email,row.role,row.event_type,row.success ? 'OK' : 'Error',row.ip_address,row.detail]));
      }
      throw new AppError(400, 'EXPORT_KIND_INVALID', 'La exportación solicitada no está soportada.');
    });

    app.post('/admin/operations/housekeeping', { preHandler: adminGuard }, async (request) => {
      const result = await db.begin(async (tx) => {
        const offline = await tx`update public.users set is_online=false where is_online and last_activity < now() - interval '15 minutes' returning id`;
        const whatsapp = await tx`delete from public.company_whatsapp_events where created_at < now() - interval '60 days' returning id`;
        const audits = await tx`delete from public.company_admin_audits where created_at < now() - interval '90 days' returning id`;
        const sessions = await tx`delete from public.user_session_events where created_at < now() - interval '30 days' returning id`;
        return {
          forcedOfflineUsers: offline.length,
          deletedWhatsappEvents: whatsapp.length,
          deletedAdminAudits: audits.length,
          deletedSessionEvents: sessions.length,
        };
      });
      return {
        success: true,
        ...result,
        message: `Mantenimiento completado. Online corregidos: ${result.forcedOfflineUsers}; eventos WhatsApp: ${result.deletedWhatsappEvents}; auditorías: ${result.deletedAdminAudits}; sesiones: ${result.deletedSessionEvents}.`,
        requestId: request.id,
      };
    });
  };
}
