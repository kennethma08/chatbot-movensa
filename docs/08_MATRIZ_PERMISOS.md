# Matriz de permisos efectiva

Esta matriz reproduce el comportamiento efectivo del sistema original y aplica mínimo privilegio. La misma definición de capacidades se usa en las rutas React y en la API; el backend vuelve a validar rol, empresa, asignación y estado en cada operación sensible.

| Área o acción | SuperAdmin | Admin de empresa | Agente |
|---|---:|---:|---:|
| Dashboard correspondiente a su rol | Sí | Sí | Sí |
| Empresas, configuración e integraciones globales | Sí | No | No |
| Operación y mantenimiento global | Sí | No | No |
| Entrar al espacio de una empresa seleccionada explícitamente | Sí | No aplica | No aplica |
| Constructores WhatsApp y webchat de la empresa seleccionada | Sí | No | No |
| Ver conversaciones | Solo con empresa seleccionada | Todas las de su empresa | Sin asignar o asignadas al propio agente |
| Tomar conversación sin asignar | Solo con empresa seleccionada | Sí | Sí |
| Responder, adjuntar, liberar o cerrar | Solo con empresa seleccionada | Cualquier conversación de su empresa | Solo las propias |
| Asignar una conversación a otro agente | Solo con empresa seleccionada | Sí | No |
| Consultar contactos | No desde la navegación global | Sí | Sí |
| Crear, editar completamente o exportar contactos | No desde la navegación global | Sí | No |
| Renombrar un contacto | No desde la navegación global | Sí | Sí |
| Gestionar agentes/equipo | Solo con empresa seleccionada | Sí | No |
| Ver reportes | Solo con empresa seleccionada | Sí | No |
| Ver y editar el perfil propio | Sí | Sí | Sí |

## Reglas de contexto

- Admin y Agente obtienen `company_id` únicamente de su perfil habilitado en base de datos. Un parámetro enviado por el navegador no puede cambiar su empresa.
- SuperAdmin no recibe automáticamente el menú operativo de una empresa. Debe seleccionar una empresa y las rutas envían un `companyId` explícito y validado.
- Un usuario deshabilitado, una empresa deshabilitada o un perfil ordinario sin empresa no pueden iniciar una sesión de aplicación.
- Las pantallas de constructores se mantuvieron en SuperAdmin porque así están protegidos los controladores MVC entregados, aunque existían endpoints heredados con una autorización más amplia. La migración adopta el permiso efectivo más restrictivo.

## Fuentes de verdad revisadas

- Menú y condiciones de rol del layout MVC original.
- Controladores de SuperAdmin, conversaciones, contactos, agentes, reportes y constructores.
- Flujo `OpenCompanyWorkspace` para el acceso de SuperAdmin a una empresa.
- Manual técnico y operativo original, usado como respaldo cuando no contradice el comportamiento ejecutable.
