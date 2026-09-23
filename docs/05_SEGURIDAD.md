# Modelo de seguridad

## Controles implementados

- JWT validado contra JWKS, issuer y audience de Supabase.
- Rol/empresa cargados desde la tabla de perfil habilitada.
- RLS y `FORCE ROW LEVEL SECURITY` en 29/29 tablas.
- 62 claves foráneas, muchas compuestas con `company_id`.
- CORS por allowlist, Helmet, límites globales y límites más estrictos en rutas públicas.
- Firma `X-Hub-Signature-256` obligatoria para Meta.
- Deduplicación de webhook y mensajes externos.
- AES-256-GCM con IV aleatorio para secretos reversibles; hashes para verify/activation/session tokens.
- Adjuntos en Storage privado con MIME allowlist, límite de 20 MiB y URLs firmadas breves. Los únicos objetos públicos son imágenes de marca del widget en el bucket `widget-assets`, limitado a JPG/PNG/WebP de 5 MiB y escrito sólo por el servidor.
- Logs redactados; errores devuelven `requestId` y no stack/secretos.
- Outbox/inbox/workers con bloqueo `skip locked`, idempotencia, backoff y cola muerta.
- Invitaciones y recuperación mediante Supabase Auth; no hay contraseñas en `public.users`.
- Matriz única de capacidades compartida por frontend y API; ocultar un enlace nunca sustituye la autorización del servidor.
- El navegador autenticado no tiene permisos SQL directos sobre tablas, secuencias ni funciones de negocio.

## Rotación obligatoria

El origen permite secretos en bruto o cifrado débil. Aunque el export los elimina, se debe asumir que access tokens, app secrets, verify tokens, JWT secrets, claves Data Protection y API keys IA estuvieron expuestos al árbol de código/respaldo. Rotarlos antes de producción.

## Pruebas de seguridad mínimas

- JWT ausente, expirado, issuer/audience incorrectos.
- Agente A intenta leer/escribir empresa B.
- Agente intenta ruta Admin; Admin intenta empresa ajena; Admin intenta ruta SuperAdmin.
- Cabeceras `X-Company-Id` no cambian el tenant.
- Firma Meta ausente/alterada y mensaje duplicado.
- Dominio webchat no permitido, token/sesión inventados y rate limiting.
- Archivo con MIME/tamaño no permitido.
- Secretos ausentes en bundle, logs, errores, exports y vistas SQL.
- Reintento concurrente de outbox/worker sin doble envío lógico.

La función `pnpm db:verify` ya prueba dos empresas distintas y confirma que el cliente autenticado no puede consultar tablas directamente y que RLS bloquea una inserción cruzada cuando se evalúa con un rol de aplicación.
