import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth.js';
import { requireAuth } from '../auth.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../database.js';
import { AppError, notFound } from '../errors.js';

interface Dependencies { auth: AuthService; db: Database; config: AppConfig }

const profileInput = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.email().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
});

async function signedAvatarUrl(config: AppConfig, path: string): Promise<string | null> {
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/sign/profile-avatars/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'POST',
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  const payload = await response.json() as { signedURL?: string; signedUrl?: string };
  const signed = payload.signedURL ?? payload.signedUrl;
  if (!response.ok || !signed) return null;
  return signed.startsWith('http') ? signed : `${config.supabaseUrl}/storage/v1${signed}`;
}

export function profileRoutes({ auth, db, config }: Dependencies): FastifyPluginAsync {
  return async (app) => {
    app.get('/profile', { preHandler: requireAuth(auth) }, async (request) => {
      const [profile] = await db<{
        id: string; name: string; email: string; phone: string | null; role: string;
        company_name: string | null; avatar_file_name: string | null; avatar_updated_at: string | null;
      }[]>`
        select u.id::text, u.name, u.email, u.phone, u.role, c.name as company_name,
          u.avatar_file_name, u.avatar_updated_at::text
        from public.users u left join public.companies c on c.id = u.company_id
        where u.id = ${request.session.userId}
      `;
      if (!profile) throw notFound('Perfil no encontrado.');
      return { ...profile, avatarUrl: profile.avatar_file_name ? await signedAvatarUrl(config, profile.avatar_file_name) : null };
    });

    app.patch('/profile', { preHandler: requireAuth(auth) }, async (request) => {
      const input = profileInput.parse(request.body);
      const [current] = await db<{
        id: string; auth_user_id: string | null; company_id: string | null; email: string; role: string;
      }[]>`
        select id::text,auth_user_id::text,company_id::text,email,role
        from public.users where id=${request.session.userId}
      `;
      if (!current) throw notFound('Perfil no encontrado.');
      const nextEmail = input.email ?? current.email;
      const emailChanged = nextEmail.toLocaleLowerCase() !== current.email.toLocaleLowerCase();
      if (current.role === 'agent' && emailChanged) {
        throw new AppError(403, 'AGENT_EMAIL_IMMUTABLE', 'El correo de una cuenta de agente no se puede editar.');
      }
      if (emailChanged) {
        const [duplicate] = await db`
          select id from public.users
          where company_id is not distinct from ${current.company_id}::bigint
            and lower(email)=lower(${nextEmail}) and id<>${request.session.userId}
          limit 1
        `;
        if (duplicate) throw new AppError(409, 'EMAIL_EXISTS', 'Ya existe una cuenta con ese correo.');
        const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users/${current.auth_user_id ?? request.session.authUserId}`, {
          method: 'PUT',
          headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ email: nextEmail, email_confirm: true }),
        });
        if (!response.ok) throw new AppError(502, 'AUTH_EMAIL_UPDATE_FAILED', 'Supabase Auth no pudo actualizar el correo.');
      }
      const [updated] = await db`
        update public.users set name=${input.name}, email=${nextEmail}, phone=${input.phone || null}, updated_at=now()
        where id=${request.session.userId} returning id::text,name,email,phone,role
      `;
      return updated;
    });

    app.post('/profile/avatar', { preHandler: requireAuth(auth) }, async (request, reply) => {
      const file = await request.file();
      if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Selecciona una imagen.');
      const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
      if (!allowed.has(file.mimetype)) throw new AppError(415, 'FILE_TYPE_NOT_ALLOWED', 'Usa una imagen JPG, PNG, WebP o GIF.');
      const bytes = await file.toBuffer();
      if (bytes.length > 5 * 1024 * 1024) throw new AppError(413, 'FILE_TOO_LARGE', 'La imagen no puede superar 5 MiB.');
      const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : file.mimetype === 'image/gif' ? 'gif' : 'jpg';
      const storagePath = `${request.session.authUserId}/${randomUUID()}.${extension}`;
      const upload = await fetch(`${config.supabaseUrl}/storage/v1/object/profile-avatars/${encodeURIComponent(storagePath).replace(/%2F/g, '/')}`, {
        method: 'POST',
        headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': file.mimetype, 'x-upsert': 'false' },
        body: new Uint8Array(bytes),
      });
      if (!upload.ok) throw new AppError(502, 'AVATAR_UPLOAD_FAILED', 'No se pudo guardar la foto de perfil.');
      await db`
        update public.users set avatar_file_name=${storagePath}, avatar_mime_type=${file.mimetype}, avatar_updated_at=now(), updated_at=now()
        where id=${request.session.userId}
      `;
      const avatarUrl = await signedAvatarUrl(config, storagePath);
      if (!avatarUrl) throw new AppError(502, 'AVATAR_SIGN_FAILED', 'La foto se guardó, pero no se pudo preparar su vista previa.');
      return reply.code(201).send({ avatarUrl });
    });

    app.get('/profile/avatar', { preHandler: requireAuth(auth) }, async (request, reply) => {
      const [profile] = await db<{ avatar_file_name: string | null }[]>`select avatar_file_name from public.users where id=${request.session.userId}`;
      if (!profile?.avatar_file_name) throw notFound('El perfil no tiene una foto.');
      const avatarUrl = await signedAvatarUrl(config, profile.avatar_file_name);
      if (!avatarUrl) throw notFound('La foto de perfil ya no está disponible.');
      return reply.redirect(avatarUrl);
    });
  };
}
