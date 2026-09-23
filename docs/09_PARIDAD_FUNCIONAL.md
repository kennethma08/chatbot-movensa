# Matriz de paridad funcional y visual

Esta matriz contrasta las vistas activas del cliente MVC original con la aplicación React migrada. No se inventan módulos para sustituir vistas heredadas: cada destino conserva el objetivo, los datos y los permisos de su origen.

## Vistas

| Vista original | Destino React | Verificación |
| --- | --- | --- |
| `Account/Login` | `/acceso` | Formulario de acceso, validación, redirección estable por sesión y marca/enlaces de Grupo Movensa |
| `Account/Profile` | `/perfil` | Datos personales, empresa, cargo, teléfono, avatar y correo editable solo para administrador/superadministrador |
| `Dashboard/Index` | `/inicio` | KPI, barras de mensajes por mes, distribución por canal y actividad reciente con Chart.js |
| `Chat/Index` | `/conversaciones` | Bandeja, búsqueda, filtros, historial, envío, media, asignación y cierre según permiso |
| `Contact/Index` | `/contactos` | Tabla, búsqueda, filtros, ficha e historial |
| `Agent/Index` | `/equipo` | KPI, presencia, carga, edición y ficha de agente |
| `Reports/Index` | `/reportes/generales` | Filtros, KPI, gráficos Chart.js, tablas y plantilla PDF completa con portada, métricas, gráficos, encabezado y pie |
| `Reports/Agents` | `/reportes/agentes` | Productividad por agente, conversaciones, mensajes y plantilla PDF por agente |
| `SuperAdmin/Index` | `/inicio` con rol `super` | KPI globales y salud de plataforma |
| `SuperAdmin/Companies` | `/administracion/empresas` | Búsqueda, filtros, estado, apertura y nueva empresa |
| formulario de alta de empresa | `/administracion/empresas/nueva` | Datos generales, flujo, notificaciones, horario y despedida |
| `SuperAdmin/Edit` y parciales | `/administracion/empresas/:id` | Vista larga con información, canales, IA, usuarios, plantillas, salud, eventos y auditoría |
| `SuperAdmin/Users` | sección Usuarios del detalle | Alta, edición, rol, contraseña y estado |
| `SuperAdmin/Settings` | `/administracion/configuracion` | KPI globales, exportaciones, cobertura, alertas y actividad |
| `SuperAdmin/Operations` | `/administracion/operaciones` | KPI operativos, alertas, actividad paginada y exportaciones |
| `SuperAdmin/AiAnalytics` | sección Analítica IA del detalle | Consumo, proveedor y resultados por empresa |
| `WebChatbot/Index` | `/automatizacion/webchat` | KPI y resumen de flujos, widget e instalaciones |
| `WebChatbot/Flows` y `Builder` | `/automatizacion/webchat/flujos` | Lista, lienzo visual, bloques, conexiones, arrastre, zoom, minimapa, JSON, publicación y activación |
| `WebChatbot/Widget` | `/automatizacion/webchat/widget` | Apariencia, Poppins, recursos, textos, instalación y vista previa |
| `WebChatbot/QuickLinks` | `/automatizacion/webchat/accesos` | Accesos, tipo, destino interno, URL y estado |
| `WebChatbot/Faqs` | `/automatizacion/webchat/preguntas` | Categorías, preguntas, respuestas y estado individual |
| `WebChatbot/Articles` | `/automatizacion/webchat/articulos` | Categorías, HTML, estado individual y vista previa aislada |
| `WebChatbot/Installations` | `/automatizacion/webchat/instalaciones` | Claves, dominios, estado, script y paquete WordPress |
| `WhatsAppBot/Builder` | `/automatizacion/whatsapp` | Lienzo visual, bloques, rutas, JSON, publicación y activación |

`Home/Index` y `Home/Privacy` eran páginas de plantilla sin función operativa. `SuperAdmin/Modules` y la acción global de usuarios redirigían al detalle de empresa; sus funciones viven en esa misma vista, igual que en el flujo original.

## Permisos conservados

| Función | Superadministrador | Administrador | Agente |
| --- | --- | --- | --- |
| Panel global y empresas | Sí | No | No |
| Configuración y operaciones globales | Sí | No | No |
| Inicio de empresa | No | Sí | Sí |
| Conversaciones y contactos | No | Sí | Sí |
| Asignar, administrar equipo y reportes | No | Sí | No |
| Perfil propio | Sí | Sí | Sí, sin editar correo |
| Configuración, IA, plantillas y automatización de empresa | Sí, desde la empresa | Sí, para su empresa | No |

Además de ocultar enlaces, cada ruta y endpoint vuelve a comprobar rol y pertenencia de empresa; un acceso directo sin permiso regresa a `/inicio` o responde `403`.

## Evidencia automatizada

- `pnpm check`: TypeScript estricto, 43 pruebas y builds de web, API, contratos, migración y widget.
- Esquema: 29 tablas, 62 claves foráneas y RLS activo en 29/29 tablas públicas.
- Datos importados y reconciliados: empresas, usuarios, contactos, conversaciones, mensajes, adjuntos, flujos, widgets, instalaciones, sesiones y eventos.
- La conciliación compara los IDs heredados exactos y permite actividad nueva posterior al corte sin confundirla con duplicados o pérdida de datos.
- El modo IA conserva el valor original `unassigned_only` en contrato, base de datos, importador y worker; la migración correctiva transforma cualquier valor provisional `unassigned`.
- Validación visual: escritorio para los tres roles y móvil 390 × 844 px.
- Revisión adicional: login de superadministrador sin bucle, correo editable por rol, dashboard con Chart.js y PDF A4 renderizado página por página con Poppins.

## Límites externos

La paridad local no declara como aprobadas las operaciones que requieren cuentas de terceros: envío real por Meta, proveedores IA, SMTP, DNS/TLS y despliegue productivo. Esas pruebas están definidas en el runbook de staging.
