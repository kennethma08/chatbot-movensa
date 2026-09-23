# Informe de pruebas y pendientes

## Ejecutado en esta entrega

- Restauración aislada del respaldo SQL Server y `DBCC CHECKDB`: aprobado.
- Builds originales: MVC aprobado sin advertencias; API aprobado con 20 advertencias heredadas.
- Export real SQL Server: 2 empresas, 2 usuarios, 5 contactos, 8 conversaciones, 68 mensajes, 4 adjuntos, 17 sesiones, 122 mensajes webchat, 214 eventos y 88 eventos de sesión.
- Preflight real: hashes/conteos, JSON, relaciones, tenant y conversión de los tres flujos webchat aprobados; reparación controlada de 135 eventos administrativos.
- Recursos de widget: dos imágenes referenciadas y existentes fueron copiadas con SHA-256; dos referencias apuntan a archivos que ya no existen en el origen y se reportan como advertencia esperada.
- Stack Supabase local completo ejecutado sobre Docker Engine en WSL2: PostgreSQL, Auth, Storage, REST, Realtime, Studio, Kong, Inbucket, Analytics, Vector y pg-meta; 11 contenedores activos y sanos.
- Migraciones ejecutadas tanto en PGlite como en PostgreSQL real: 29 tablas, 62 FKs, RLS 29/29.
- Importación real conciliada en PostgreSQL: 2 empresas, 2 usuarios, 5 contactos, 8 conversaciones, 68 mensajes, 4 adjuntos, 3 flujos webchat, 2 widgets, 4 instalaciones, 17 sesiones, 122 mensajes webchat, 214 eventos, 1 auditoría y los 88 eventos de sesión heredados.
- Prueba RLS con dos tenants: lectura e inserción cruzadas rechazadas.
- TypeScript estricto de web, API, contratos y migración: aprobado.
- 43 pruebas automatizadas aprobadas: contratos, modo IA heredado, permisos, fechas inválidas, conversión heredada, ramas del motor visual, menús, medios, dominios de webchat actuales y heredados, AES-GCM, firma Meta, frontend y smoke del API.
- Builds de producción React, API y widget: aprobados.
- Auditoría de dependencias de producción: sin vulnerabilidades conocidas (`pnpm audit --prod`).
- Auth local validado con superadministrador y administrador de empresa. El administrador recibe `403` en endpoints globales, conserva acceso a sus 5 contactos y el superadministrador lista las 2 empresas.
- API y panel validados con datos importados: empresas, operaciones, conversaciones e historial, contactos, equipo, reportes históricos, flujos, apariencia, contenido e instalaciones webchat.
- Storage validado de extremo a extremo: los 4 adjuntos migrados generan URL firmada y descargan con HTTP 200; el PDF histórico también responde 200.
- Bootstrap real del widget validado: dominio permitido responde 200 y dominio ajeno responde 403.
- Durante el recorrido se corrigieron defectos encontrados por ejecución real: contrato `snake_case`/`camelCase` de mensajes, resolución de rutas internas de Webchat, estado transitorio inválido del filtro de reportes, consulta de salud de empresas, modo IA `unassigned_only` y controles de contenido del widget.
- `pnpm check` completo aprobado: TypeScript estricto, 43 pruebas, builds de producción, widget `movensa-widget.js` y verificación de esquema (29 tablas, 62 FKs, RLS 29/29).
- `migration:verify` vuelve a aprobar después de la actividad de prueba: concilia los IDs heredados exactos en todas las tablas y distingue correctamente filas operativas posteriores al corte (usuarios, mensajes, adjuntos, webchat y sesiones).
- Recorrido visual en navegador aprobado para superadministrador, administrador y agente: navegación y bloqueos por rol, inicio con KPI, conversaciones, contactos, equipo, ambos reportes, perfil, gestión de empresas y automatización.
- Responsive validado en escritorio y viewport móvil de 390 × 844 px para inicio, listado de conversaciones y detalle.
- Acceso de superadministrador repetido desde una sesión limpia: entra a `/inicio` en el primer intento, sin pantalla blanca, recarga manual, bucle de redirecciones ni errores nuevos de consola.
- Dashboard de empresa revalidado con sus KPI originales y gráficos Chart.js para mensajes por mes y distribución por canal; el contenido usa casi todo el ancho disponible y conserva un margen lateral corto.
- Exportación PDF general ejecutada desde el navegador y revisada página por página: A4, portada Movensa, Poppins, rango y fecha, resumen ejecutivo, KPI, gráficos, tablas, encabezado, pie y numeración correctos.
- Correos verificados por rol: superadministrador y administrador pueden editar su correo de acceso; los agentes lo ven fijo. La API aplica la misma regla y mantiene sincronizados Auth y `public.users`.
- Login y navegación revalidados con marca Grupo Movensa, enlace de distribución `grupomovensa.com`, soporte `grupomovensa.com/soporte` y favicon existente.
- Gráficos de panel, reportes y PDF revalidados con Chart.js y paleta naranja de Movensa; desapareció la paleta morada heredada.
- Conversaciones revalidadas sin desbordamiento global: el panel conserva un margen corto, el historial mantiene su propio desplazamiento y los audios no muestran descarga.
- Apariencia del widget revalidada desde navegador: el selector enseña el hexadecimal completo, actualiza la vista previa en vivo y el guardado de superadministrador confirma `Guardado` sin error de auditoría ni consola.
- Instalación webchat revalidada para JavaScript y WordPress: elección visible, instrucciones, ZIP 1.1.0 con carga diferida y protección contra duplicados, y compatibilidad del backend con dominios normalizados y entradas URL heredadas.

## Pendiente únicamente por credenciales o infraestructura externa

- Importación final a un proyecto Supabase de staging/producción: no se entregaron URL/clave/DB destino.
- Entrega real de invitaciones/correos mediante proveedor SMTP externo.
- Webhook y envío real Meta.
- Llamadas reales OpenAI, DeepSeek o Gemini.
- Supabase/PostgreSQL de producción, autenticación válida de Vercel, DNS/TLS, correo, dominio de widget y observabilidad de producción.

Estos puntos no están simulados como aprobados. El runbook indica cómo verificarlos en staging.

## Pruebas de aceptación en staging

1. Importar una copia y aprobar `migration:verify`.
2. Invitar un usuario de cada rol y completar recuperación.
3. Ejecutar matriz de aislamiento multiempresa y permisos.
4. Subir/descargar imagen, PDF y audio; rechazar MIME/tamaño inválidos.
5. Completar WhatsApp texto, plantilla, media, firma inválida, duplicado y estado fallido.
6. Completar webchat en dominio permitido/no permitido, flujo, handoff y cierre sincronizado.
7. Probar IA dentro/fuera de horario, asignada, solicitud humana y límites.
8. Verificar PDF/CSV, auditoría, rate limiting, cola muerta y reintentos.
9. Ejecutar pruebas responsive en 360, 768, 1024 y 1440 px, teclado y lector de pantalla.
