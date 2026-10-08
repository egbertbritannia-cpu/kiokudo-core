import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { validateStagingConfiguration } from './staging-identity.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseConnection {
  client: Client;
  db: Database;
}

export function createDatabaseConnection(url: string, authToken?: string): DatabaseConnection {
  const client = createClient({ url, authToken });
  return { client, db: drizzle(client, { schema }) };
}

/** Config validates before opening; app.onReady verifies DB-resident identity BEFORE serving any request. */
export function createStagingDatabaseFromEnv(): DatabaseConnection | undefined {
  const config = validateStagingConfiguration(process.env);
  if (!config) return undefined;
  return createDatabaseConnection(config.url, config.token);
}
