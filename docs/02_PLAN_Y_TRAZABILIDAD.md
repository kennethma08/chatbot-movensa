# Plan y trazabilidad

## Etapas

1. **Congelar e inventariar**: conservar el origen, registrar módulos, datos y riesgos.
2. **Fundación de datos**: crear esquema PostgreSQL, restricciones, índices, RLS, funciones y buckets.
3. **Migración repetible**: exportar SQL Server a NDJSON, transformar, importar en orden y conciliar conteos/relaciones.
4. **API segura**: autenticar con Supabase, resolver tenant solo desde membresía, encapsular operaciones y validar Meta/IA.
5. **Experiencia React**: migración con paridad funcional y visual de las vistas heredadas, manteniendo permisos por rol, responsive y accesibilidad.
6. **Validación**: pruebas unitarias, integración, seguridad de tenant, builds y ensayo de migración.
7. **Corte**: ensayo en staging, congelamiento corto, delta final, rotación de credenciales, smoke tests y rollback documentado.

## Matriz funcional

| Heredado | Nuevo destino | Estado previsto |
| --- | --- | --- |
| Login/sesión/perfil | Supabase Auth + perfil público | Implementado |
| Dashboard | `/inicio` | Implementado |
| Bandeja, asignación y cierre | `/conversaciones` | Implementado |
| Contactos e historial | `/contactos` | Implementado |
| Agentes/presencia | `/equipo` | Implementado |
| Reportes generales | `/reportes/generales` | Implementado |
| Reportes por agente | `/reportes/agentes` | Implementado |
| Empresas y salud | `/administracion/empresas` | Implementado |
| Usuarios, integración, plantillas, IA | detalle de empresa | Implementado |
| Resumen, flujos, widget, accesos, preguntas, artículos e instalaciones Webchat | `/automatizacion/webchat/*` | Implementado |
| Flujo visual WhatsApp | `/automatizacion/whatsapp` | Implementado |
| Auditorías/operaciones | `/administracion/operaciones` | Implementado |
| Webhook Meta y envío | API `/v1/meta/*` | Implementado, credenciales externas requeridas para E2E |
| Respuestas IA | API `/v1/ai/*` | Implementado, proveedor externo requerido para E2E |

## Criterios de aceptación

- Ninguna fila de otra empresa es visible o mutable con el JWT de un usuario ordinario.
- Todas las rutas privilegiadas rechazan sesión ausente, rol incorrecto o empresa ajena.
- Un `message_meta_id` repetido no crea dos mensajes.
- La firma inválida de Meta se rechaza antes de procesar el cuerpo.
- Cierre y asignación son transaccionales y auditados.
- La conciliación iguala conteos fuente/destino y reporta huérfanos o diferencias.
- El frontend funciona de 360 px en adelante, mantiene foco visible y navegación por teclado.
- No se registran tokens, secretos, contraseñas ni payloads completos de clientes.

## Entorno de auditoría

Supabase CLI quedó instalado como dependencia reproducible del proyecto. El stack local completo se ejecutó sobre Docker Engine en WSL2 y se validaron PostgreSQL, Auth, Storage, REST, Realtime, RLS, importación, API, frontend y widget. Las integraciones que dependen de credenciales externas continúan reservadas para staging/producción según el runbook.
