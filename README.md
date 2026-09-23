# Plataforma Grupo Movensa

Migración completa de la plataforma operativa de Grupo Movensa a React, Fastify y Supabase. El código .NET, la copia SQL Server y la documentación de origen permanecen intactos como material de trazabilidad.

## Qué contiene

- `apps/web`: interfaz React + TypeScript, responsive y accesible.
- `apps/widget`: cliente webchat embebible, aislado con Shadow DOM.
- `apps/api`: API TypeScript para reglas de negocio, Meta Webhooks, IA y operaciones privilegiadas.
- `packages/shared`: contratos y validaciones compartidas.
- `supabase`: esquema PostgreSQL, RLS, funciones públicas seguras y datos de demostración.
- `scripts/migration`: exportación SQL Server, importación PostgreSQL y conciliación.
- `docs`: diagnóstico, arquitectura, ejecución, despliegue, seguridad y migración.

## Inicio rápido

Requisitos: Node.js 22+, pnpm 10+ y un proyecto Supabase. Para el stack local completo se requiere además un runtime compatible con Docker.

```powershell
Copy-Item .env.example .env
pnpm install
pnpm check
pnpm dev
```

La guía completa está en [`docs/06_RUNBOOK.md`](docs/06_RUNBOOK.md).

## Estado de verificación

`pnpm check` ejecuta tipos, pruebas, builds y verificación del esquema. La verificación PostgreSQL puede ejecutarse sin Docker mediante PGlite; además, la entrega fue conciliada y recorrida de extremo a extremo contra el stack Supabase local completo (Auth, Storage, REST y Realtime incluidos).

El panel incluye operaciones completas de empresas, usuarios, contactos, plantillas, IA, reportes, flujos WhatsApp/webchat, contenido del widget, recursos visuales, claves script/WordPress, exportaciones y housekeeping. Las credenciales externas no se incluyen: deben rotarse y verificarse en staging siguiendo el runbook.
