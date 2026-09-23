# Diagnóstico del sistema heredado

Fecha de auditoría: 2026-09-17. Fuentes: código API/MVC, scripts y respaldo SQL Server, manuales técnico/usuario/base de datos, checklist de entrega y documentos de Meta.

## Estado comprobado

- La solución original usa .NET 9, ASP.NET MVC/Razor, EF Core y SQL Server/SQLite.
- El frontend original compila sin advertencias. El API compila con 20 advertencias de nulabilidad y uso de APIs obsoletas.
- El respaldo `BASE DE DATOS/BD` fue restaurado a una copia aislada de SQL Server LocalDB y validado con `DBCC CHECKDB`: 25 tablas de aplicación, sin errores de integridad física.
- La base contiene 2 empresas, 2 usuarios, 5 contactos, 8 conversaciones y 68 mensajes, además de datos de webchat.
- El respaldo tiene cinco migraciones; el código contiene dos adicionales: despedida de agente y módulo IA. Por tanto, el respaldo no representa el modelo más reciente.
- No se detectaron referencias huérfanas en conversaciones/contactos/mensajes de la muestra, pero la mayoría de relaciones lógicas carece de claves foráneas.
- El preflight exhaustivo detectó 135 eventos administrativos de webchat con `session_id = 0`. Son eventos de guardado/publicación/borrado de flujos, widgets y claves, no sesiones perdidas. La transformación los conserva con `session_id = NULL`; los demás eventos mantienen FK obligatoria cuando hay sesión.
- `dev-chatbot.db` es un SQLite antiguo e incompleto y no es fuente de verdad.

## Riesgos críticos confirmados

1. El tenant puede resolverse desde `X-Company-Id` antes que desde el JWT. Un usuario autenticado puede intentar suplantar otra empresa.
2. Controladores de compañías, contactos, conversaciones, mensajes, integraciones, plantillas, perfiles, adjuntos y migración de tenant exponen acciones sin autorización suficiente. La creación/actualización de usuario permite acceso anónimo.
3. No hay filtros globales por tenant ni RLS. La seguridad depende de filtros manuales inconsistentes.
4. Las contraseñas usan SHA-256 sin salt y conservan compatibilidad con texto plano.
5. Tokens y secretos se almacenan como bytes UTF-8 o con cifrado AES de IV fijo, sin autenticación. Hay claves de Data Protection dentro del árbol del proyecto.
6. El webhook de Meta no valida `X-Hub-Signature-256`, registra payloads completos con PII y no usa la tabla de deduplicación. Puede procesar el mismo mensaje varias veces.
7. El envío externo no usa de forma efectiva outbox, reintentos con backoff ni claves de idempotencia.
8. Hay acceso cruzado potencial a plantillas por falta de filtro de empresa.
9. Swagger y CORS amplio están habilitados globalmente; `RequireHttpsMetadata` está desactivado.
10. Fechas mezclan UTC con desplazamientos manuales. Los horarios de IA dependen de identificadores Windows y pueden fallar en Linux.

## Calidad y brechas funcionales

- Se encontraron nombres heredados erróneos (`recepient`, `idProfile`) y JSON almacenado como texto sin validación.
- Tablas `received_messages`, `outbox_messages` y `bot_settings` están prácticamente sin uso.
- Falta política de retención para mensajes, adjuntos, sesiones, auditorías y trazas IA.
- El manual técnico indica administración IA por empresa, pero el endpoint actual exige SuperAdmin.
- El libro Excel de incidencias entregado contiene cuatro casos de RR. HH./posnet, no incidencias del chatbot; se conserva como evidencia documental, no como backlog del producto.
- Una celda del manual de base de datos está corrompida, por lo que el modelo fue contrastado con el esquema real y las migraciones.

## Decisiones

- Preservar IDs enteros para una migración determinista; vincular usuarios con `auth.users` mediante UUID.
- Adoptar UTC (`timestamptz`) y zona IANA por empresa.
- Hacer que PostgreSQL aplique el aislamiento con FKs, restricciones y RLS, además del API.
- Mantener secretos exclusivamente en el servidor con AES-256-GCM y rotarlos durante el corte.
- No migrar hashes heredados a Supabase Auth: crear/invitar usuarios y exigir restablecimiento seguro.
- Usar funciones `security definer` estrictas para el webchat público; no abrir tablas al rol anónimo.
- Activar inbox/outbox, firma de Meta, idempotencia, rate limiting y auditoría sin payloads sensibles.
