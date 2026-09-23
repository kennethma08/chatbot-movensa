# Procedimiento de migración

## Principios

- El respaldo y la base SQL Server se leen; nunca se modifican.
- Cada export produce archivos NDJSON y un manifiesto con conteos y SHA-256.
- El export elimina `users.pass`, tokens de integración y claves IA. Esas credenciales deben rotarse.
- La importación es repetible sobre una base destino vacía y conserva IDs.
- Los hashes SHA-256/texto plano heredados no se copian a Supabase Auth.

## 1. Ensayo

Crear `.env` desde `.env.example`. Para SQL Server con autenticación integrada en Windows:

```powershell
$env:SQLSERVER_DRIVER='msnodesqlv8'
$env:SQLSERVER_ODBC_DRIVER='ODBC Driver 17 for SQL Server'
$env:SQLSERVER_SERVER='(localdb)\MSSQLLocalDB'
$env:SQLSERVER_DATABASE='chatbotapi_migration_audit'
$env:SQLSERVER_TRUSTED_CONNECTION='true'
$env:LEGACY_WEBCHAT_ASSETS_DIR='D:\ruta\al\proyecto\CODIGO\_shared\webchatbot-assets'
pnpm migration:export
pnpm migration:preflight
```

El preflight real de esta entrega confirmó todos los conteos y relaciones. Hallazgos esperados:

- respaldo con 5 migraciones, faltan despedida de agente e IA;
- 135 eventos administrativos con `session_id = 0`, convertidos a `NULL`;
- cero integraciones/plantillas/flows WhatsApp/IA en el respaldo;
- cuatro adjuntos binarios que se trasladarán a Storage.
- los flujos webchat heredados se convierten de `version: "1.0"`, `nextNodeId`, `message` y `transfer` al grafo v1 con aristas y ramas explícitas;
- `position=right/left` se convierte a `bottom-right/bottom-left` e instalación `code` a `script`;
- dos de cuatro recursos visuales referenciados por los widgets ya no existen en `_shared/webchatbot-assets`; el export lo registra como advertencia verificable y el import deja esas dos referencias vacías en vez de publicar enlaces rotos. Los dos archivos existentes sí se empaquetan y se suben a `widget-assets`.

Los artefactos bajo `scripts/migration/data` contienen PII, están en `.gitignore` y deben cifrarse en reposo o eliminarse de manera segura después de la aceptación.

## 2. Preparar Supabase

En local, instalar/iniciar Docker Desktop o equivalente y ejecutar:

```powershell
pnpm supabase:start
pnpm supabase:reset
```

Para staging/producción, enlazar el proyecto y aplicar las migraciones con Supabase CLI. Antes de importar, verificar que existen el bucket privado `chat-attachments` y el bucket público, limitado a imágenes, `widget-assets`; además, el API debe usar la cadena de conexión del pooler apropiado.

## 3. Importar y conciliar

```powershell
pnpm migration:import
pnpm migration:verify
pnpm --filter @movensa/migration onboard-users
```

`migration:verify` falla ante diferencia de conteos, huérfanos, mezcla de tenant, secretos importados, columnas de contraseña heredadas, cobertura RLS incompleta o menos de 40 FKs.

El onboarding invita usuarios activos y enlaza el UUID de Auth. Todos deben establecer una contraseña nueva; no se intenta convertir SHA-256 a bcrypt.

## 4. Credenciales nuevas

Para cada empresa:

1. Rotar access token, app secret y verify token de Meta.
2. Guardarlos desde Integración; nunca desde SQL.
3. Configurar el callback `/v1/meta/webhook/{phone-number-id}`.
4. Verificar desafío y una firma real.
5. Sincronizar plantillas y enviar a un número de prueba.
6. Configurar una API key IA nueva si se habilitará el módulo.

## 5. Corte

1. Congelar cambios administrativos en el sistema heredado.
2. Ejecutar export final y comparar manifiesto con el ensayo.
3. Restaurar/importar en un destino limpio o aplicar un delta aprobado.
4. Conciliar y completar smoke tests.
5. Cambiar DNS/webhook/frontend.
6. Mantener SQL Server en solo lectura durante la ventana acordada.

## Rollback

Si falla un criterio crítico, restaurar DNS/webhook al sistema heredado, reabrirlo para escritura y conservar el destino Supabase aislado para análisis. No mezclar escrituras de ambos sistemas sin un reconciliador. La vuelta no requiere modificar el respaldo original.
