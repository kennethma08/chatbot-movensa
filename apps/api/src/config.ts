import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_JWKS_URL: z.url(),
  SUPABASE_JWT_ISSUER: z.url().optional(),
  SUPABASE_SECRET_KEY: z.string().min(20),
  SECRET_ENCRYPTION_KEY: z.string().min(40),
  ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:5173'),
  PUBLIC_API_URL: z.url().optional(),
  PUBLIC_WIDGET_URL: z.url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuración inválida o incompleta: ${fields}`);
  }

  const encryptionKey = Buffer.from(parsed.data.SECRET_ENCRYPTION_KEY, 'base64');
  if (encryptionKey.length !== 32) {
    throw new Error('SECRET_ENCRYPTION_KEY debe representar exactamente 32 bytes en Base64.');
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    databaseUrl: parsed.data.DATABASE_URL,
    supabaseUrl: parsed.data.SUPABASE_URL,
    supabaseJwksUrl: parsed.data.SUPABASE_JWKS_URL,
    supabaseJwtIssuer: parsed.data.SUPABASE_JWT_ISSUER ?? `${parsed.data.SUPABASE_URL}/auth/v1`,
    supabaseSecretKey: parsed.data.SUPABASE_SECRET_KEY,
    encryptionKey,
    allowedOrigins: new Set(parsed.data.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)),
    publicApiUrl: (parsed.data.PUBLIC_API_URL ?? `http://${parsed.data.HOST}:${parsed.data.PORT}`).replace(/\/$/, ''),
    publicWidgetUrl: parsed.data.PUBLIC_WIDGET_URL ?? 'http://127.0.0.1:4174/movensa-widget.js',
    logLevel: parsed.data.LOG_LEVEL,
  } as const;
}
