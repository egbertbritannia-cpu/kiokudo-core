import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseConnection {
  client: Client;
  db: Database;
}

export function createDatabaseConnection(url: string, authToken?: string): DatabaseConnection {
  const client = createClient({ url, authToken });
  return { client, db: drizzle(client, { schema }) };
}

/** Only explicit staging configuration is permitted during the migration phase. */
export function createStagingDatabaseFromEnv(): DatabaseConnection | undefined {
  const url = process.env.KIOKUDO_DATABASE_URL;
  if (!url) return undefined;
  if (process.env.KIOKUDO_DATABASE_SCOPE !== 'staging') {
    throw new Error('Refusing database connection: KIOKUDO_DATABASE_SCOPE must be staging');
  }
  if (!/^(file:|libsql:|https:)/.test(url)) {
    throw new Error('Unsupported database URL protocol');
  }
  const token = process.env.KIOKUDO_DATABASE_AUTH_TOKEN;
  if (!url.startsWith('file:') && !token) {
    throw new Error('Staging remote database requires KIOKUDO_DATABASE_AUTH_TOKEN');
  }
  return createDatabaseConnection(url, token);
}
