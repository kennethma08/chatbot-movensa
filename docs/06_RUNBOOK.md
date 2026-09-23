# Runbook de desarrollo y operación

## Requisitos

- Node.js 22 o superior y pnpm 10 o superior.
- Docker Desktop, Rancher Desktop, Podman o Docker Engine dentro de WSL2 para el stack Supabase completo.
- SQL Server/ODBC únicamente durante la migración.

Supabase documenta que el desarrollo local requiere CLI y un runtime compatible con Docker: <https://supabase.com/docs/guides/local-development>.

## Desarrollo local completo

```powershell
Copy-Item .env.example .env
pnpm install
pnpm supabase:start
pnpm supabase:reset
pnpm dev
```

Copiar a `.env` los valores que imprime `supabase start`. Generar `SECRET_ENCRYPTION_KEY` una sola vez:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

En Windows también se validó el stack con Docker Engine y Supabase CLI instalados dentro de Ubuntu WSL2. Si el reenvío de `localhost` de WSL no está disponible, obtener la IP con `wsl -d Ubuntu -- hostname -I` y usarla en `VITE_SUPABASE_URL`, `SUPABASE_URL` y `DATABASE_URL`. El emisor JWT local puede seguir siendo `http://127.0.0.1:54321/auth/v1`; en ese caso definirlo explícitamente en `SUPABASE_JWT_ISSUER`.

Servicios por defecto:

- Web: <http://127.0.0.1:5173>
- Widget embebible: <http://127.0.0.1:4174/movensa-widget.js>
- API: <http://127.0.0.1:3100>
- Supabase API: <http://127.0.0.1:54321>
- PostgreSQL: `127.0.0.1:54322`
- Studio: <http://127.0.0.1:54323>

## Verificación

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm db:verify
pnpm migration:verify
```

`db:verify` usa PGlite y no necesita Docker. `migration:verify` concilia el export con PostgreSQL real; los eventos de sesión importados se identifican por ID para no confundir actividad legítima posterior al corte. Auth, Storage y Realtime requieren Supabase local o staging. Correos SMTP, Meta e IA requieren credenciales externas.

## Variables críticas

- `VITE_SUPABASE_PUBLISHABLE_KEY`: puede estar en el navegador; RLS debe seguir activo.
- `VITE_WIDGET_URL`: URL pública del archivo `movensa-widget.js` (en la imagen web se publica bajo `/widget/`).
- `SUPABASE_SECRET_KEY`: solo API/worker.
- `DATABASE_URL`: solo API/migración; usar TLS y pooler en producción.
- `SECRET_ENCRYPTION_KEY`: secreto de 32 bytes Base64; respaldar en el gestor de secretos.
- `ALLOWED_ORIGINS`: lista explícita; nunca `*` en producción.
- `PUBLIC_API_URL` y `PUBLIC_WIDGET_URL`: URLs públicas que se incrustan en el plugin WordPress generado.
- `LEGACY_WEBCHAT_ASSETS_DIR`: carpeta `_shared/webchatbot-assets` usada únicamente al preparar el export de migración.

## Publicación del widget

Desde **Webchat > Instalaciones** se crea una clave con dominios permitidos. La clave sólo se muestra una vez. Para una instalación `script`, copiar el fragmento generado; para `wordpress`, descargar el ZIP en ese mismo momento e instalarlo desde **Plugins > Añadir plugin > Subir plugin**. El ZIP se genera en memoria después de comprobar el hash de la clave y no persiste una copia en el servidor.

Los iconos del lanzador y del estado vacío se cargan desde **Webchat > Widget**. El API valida tipo y tamaño antes de publicarlos en `widget-assets`. En **Webchat > Contenido** también se configuran el formato y los textos del lanzador, los estados vacío/cerrado, accesos rápidos, preguntas y artículos. El cliente embebible incluye búsqueda en FAQ/artículos y permite iniciar una sesión nueva cuando la anterior queda cerrada.

## Salud y observabilidad

- `/health/live`: proceso vivo, sin tocar DB.
- `/health/ready`: comprueba PostgreSQL.
- Cada error contiene `requestId`.
- Operación muestra las alertas originales por empresa, fallos recientes, sesiones activas, presencias obsoletas y actividad paginada.
- SuperAdmin puede exportar empresas, eventos y sesiones. Los endpoints internos de cola y mantenimiento no se presentan como módulos nuevos en la interfaz heredada.
- Alertar por cola muerta, firma inválida sostenida, tasa de 5xx, latencia de workers, límites IA y uso de Storage.

## Despliegue

1. Ejecutar `pnpm check` y `pnpm db:verify` en CI.
2. Aplicar migraciones antes del API compatible.
3. Desplegar API y workers con una sola imagen Node; múltiples réplicas son seguras por `skip locked`.
4. Desplegar `apps/web/dist` en CDN con fallback a `index.html` y `apps/widget/dist/movensa-widget.js` como recurso público con caché corta.
5. Inyectar secretos desde un gestor; nunca copiarlos a archivos de imagen.
6. Probar liveness/readiness, login, tenant, envío webchat, firma Meta y un mensaje saliente.

### Publicación solicitada en Vercel

El frontend y el API deben ser dos proyectos Vercel del mismo monorepo:

- `chatbot.grupomovensa.com`: aplicación Vite y archivo `/widget/movensa-widget.js`.
- `apichatbot.grupomovensa.com`: aplicación Fastify.

Vercel soporta Fastify como una sola Function con Fluid compute, pero una Function escala a cero y no sustituye por sí sola los tres workers con temporizadores permanentes de esta aplicación. Antes del corte se debe elegir y probar una de estas dos opciones:

1. API en Vercel y workers en un proceso Node persistente con las mismas variables privadas; o
2. adaptar el despacho a una cola/`waitUntil` duradera y configurar el reproceso periódico compatible con el plan Vercel.

No publicar el entorno local: las URLs actuales de Supabase, CORS, API y widget apuntan a localhost/red privada. El corte requiere un proyecto Supabase de producción, migraciones aplicadas, datos conciliados, secretos nuevos y una sesión/token válido de Vercel. Después se agregan ambos subdominios y se usan exactamente los registros DNS que devuelva `vercel domains inspect`.

Referencias oficiales: <https://vercel.com/docs/frameworks/backend/fastify>, <https://vercel.com/docs/functions>, <https://vercel.com/docs/monorepos> y <https://vercel.com/docs/domains/set-up-custom-domain>.
