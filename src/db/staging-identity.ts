import type { Client } from '@libsql/client';

// Marker is an operational safety fence, NOT a replacement for database access control.
// Provision only after independently confirming the destination is an isolated STAGING clone.
export const LOCAL_REHEARSAL_MARKER = 'kiokudo-local-json-fixture-not-production-v1';

export function isRemoteDatabaseUrl(url: string): boolean {
  return url.startsWith('libsql:') || url.startsWith('https:');
}

export function validateStagingConfiguration(env: NodeJS.ProcessEnv): {url: string; token?: string; expectedMarker: string} | undefined {
  const url = env.KIOKUDO_DATABASE_URL;
  if (!url) return undefined;
  if (env.KIOKUDO_DATABASE_SCOPE !== 'staging') {
    throw new Error('STAGING_GUARD: KIOKUDO_DATABASE_SCOPE must be staging');
  }
  if (!/^(file:|libsql:|https:)/.test(url)) {
    throw new Error('STAGING_GUARD: unsupported database protocol');
  }
  // Detect accidental reuse of legacy production URL even if a staging label was set.
  const legacyUrl = env.TURSO_DATABASE_URL;
  if (legacyUrl && canonicalUrl(url) === canonicalUrl(legacyUrl)) {
    throw new Error('STAGING_GUARD: destination matches legacy TURSO_DATABASE_URL');
  }
  const expectedMarker = env.KIOKUDO_EXPECTED_STAGING_MARKER;
  if (!expectedMarker || expectedMarker.trim().length < 24) {
    throw new Error('STAGING_GUARD: KIOKUDO_EXPECTED_STAGING_MARKER is required (24+ characters)');
  }
  const token = env.KIOKUDO_DATABASE_AUTH_TOKEN;
  if (isRemoteDatabaseUrl(url) && !token) {
    throw new Error('STAGING_GUARD: remote staging DB requires token');
  }
  if (isRemoteDatabaseUrl(url) && expectedMarker === LOCAL_REHEARSAL_MARKER) {
    throw new Error('STAGING_GUARD: fixture marker must never authorize remote database');
  }
  return {url,token,expectedMarker};
}

function canonicalUrl(value: string): string {
  try {
    const u = new URL(value);
    u.hash = ''; u.search = '';
    return u.toString().replace(/\/$/,'').toLowerCase();
  } catch {
    return value.trim().replace(/\/$/,'');
  }
}

/** Read-only preflight; never creates/updates a marker on the target database. */
export async function verifyStagingDatabaseIdentity(client: Pick<Client,'execute'>, expectedMarker: string): Promise<void> {
  let actual: unknown;
  try {
    const response = await client.execute({
      sql: "SELECT marker FROM kiokudo_deployment_identity WHERE environment = ?",
      args: ['staging'],
    });
    if (response.rows.length !== 1) throw new Error('missing or duplicate staging identity');
    actual = response.rows[0].marker;
  } catch {
    throw new Error('STAGING_GUARD: staging identity row is missing/unreadable; refusing startup');
  }
  if (actual !== expectedMarker) {
    throw new Error('STAGING_GUARD: database identity mismatch; refusing startup');
  }
}
