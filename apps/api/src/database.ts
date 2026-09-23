import postgres from 'postgres';

export type Database = ReturnType<typeof postgres>;

export function asJson(value: unknown): never {
  return value as never;
}

export function createDatabase(databaseUrl: string): Database {
  return postgres(databaseUrl, {
    max: 12,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    transform: {
      undefined: null,
    },
    onnotice: () => undefined,
  });
}
