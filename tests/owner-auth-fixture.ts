import { createHmac } from 'node:crypto';

export const FIXTURE_OWNER = 'test_owner_alpha';
export const FIXTURE_ASSERTION_KEY = 'fixture-owner-assertion-key-for-tests-only-2026';
const DEFAULT_TOKEN = 'test-only-service-token-minimum-length';

export function setFixtureOwnerEnv(): void {
  process.env.KIOKUDO_OWNER_SUBJECT = FIXTURE_OWNER;
  process.env.KIOKUDO_INTERNAL_ASSERTION_KEY = FIXTURE_ASSERTION_KEY;
  process.env.KIOKUDO_SINGLE_OWNER_DATASET_ACK = 'true';
  // Legacy FSRS tests deliberately mutate ONLY their temporary SQLite fixture.
  process.env.KIOKUDO_STAGING_WRITE_ENABLED = 'true';
}

export function createFixtureAssertion(
  method: string, path: string, fields: Record<string, unknown> = {},
): string {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    sub: FIXTURE_OWNER,
    iss: 'kiokudo-web',
    aud: 'kiokudo-core',
    scope: method === 'GET' || method === 'HEAD' ? 'read' : 'write',
    method,
    path,
    exp: Math.floor(Date.now() / 1000) + 20,
    ...fields,
  }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', FIXTURE_ASSERTION_KEY)
    .update(payload, 'utf8').digest('base64url');
  return payload + '.' + signature;
}

export function fixtureHeaders(
  method: string, path: string, serviceToken = DEFAULT_TOKEN,
): Record<string, string> {
  return {
    authorization: 'Bearer ' + serviceToken,
    'x-kiokudo-owner-assertion': createFixtureAssertion(method, path),
  };
}
