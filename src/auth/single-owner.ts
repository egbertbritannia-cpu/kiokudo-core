import { createHmac, timingSafeEqual } from 'node:crypto';

const OWNER_FORMAT = /^[A-Za-z0-9_-]{3,64}$/;

function configuredSecret(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= 32 &&
    !secret.startsWith('replace-') && !secret.startsWith('change-');
}

export type OwnerAuthResult = 'ok' | 'unauthorized' | 'not_configured' | 'writes_disabled';

/**
 * The current migration is a ONE-OWNER database. All private records are
 * assigned to the explicitly acknowledged subject, never inferred from a
 * browser header, request body, or the shared service bearer.
 *
 * Replacing this with multi-owner storage requires per-row owner columns
 * and owner-scoped SQL queries, not merely a change to this assertion.
 */
export function verifySingleOwnerRequest(
  assertion: string | string[] | undefined,
  method: string,
  path: string,
  env: NodeJS.ProcessEnv = process.env,
  nowSeconds = Math.floor(Date.now() / 1000),
): OwnerAuthResult {
  const owner = env.KIOKUDO_OWNER_SUBJECT;
  const key = env.KIOKUDO_INTERNAL_ASSERTION_KEY;
  if (!owner || !OWNER_FORMAT.test(owner) || !configuredSecret(key) ||
      env.KIOKUDO_SINGLE_OWNER_DATASET_ACK !== 'true') {
    return 'not_configured';
  }

  if (typeof assertion !== 'string' || assertion.length > 2048) return 'unauthorized';
  const pieces = assertion.split('.');
  if (pieces.length !== 2 ||
      !/^[A-Za-z0-9_-]+$/.test(pieces[0]) ||
      !/^[A-Za-z0-9_-]{43}$/.test(pieces[1])) return 'unauthorized';
  const expected = Buffer.from(
    createHmac('sha256', key).update(pieces[0], 'utf8').digest('base64url'), 'utf8',
  );
  const supplied = Buffer.from(pieces[1], 'utf8');
  if (expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)) return 'unauthorized';

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(pieces[0], 'base64url').toString('utf8'),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'unauthorized';
    }
    const p = parsed as Record<string, unknown>;
    const isRead = method === 'GET' || method === 'HEAD';
    if (p.v !== 1 || p.sub !== owner || p.iss !== 'kiokudo-web' ||
        p.aud !== 'kiokudo-core' || p.method !== method || p.path !== path ||
        p.scope !== (isRead ? 'read' : 'write') ||
        typeof p.exp !== 'number' || !Number.isInteger(p.exp) ||
        p.exp <= nowSeconds || p.exp > nowSeconds + 30) {
      return 'unauthorized';
    }
    if (!isRead && env.KIOKUDO_STAGING_WRITE_ENABLED !== 'true') {
      return 'writes_disabled';
    }
    return 'ok';
  } catch {
    return 'unauthorized';
  }
}
