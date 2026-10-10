import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { verifySingleOwnerRequest } from '../src/auth/single-owner.js';
import { setupReviewDb } from './fixtures.js';
import { createFixtureAssertion, fixtureHeaders, setFixtureOwnerEnv } from './owner-auth-fixture.js';

const token = 'test-only-service-token-minimum-length';
const path = '/api/v1/grammar/practice?limit=999999';

test('Core rejects private reads with no owner dataset acknowledgment', async () => {
  setFixtureOwnerEnv();
  const cx = await setupReviewDb();
  const app = buildApp({ serviceToken: token, database: cx });
  try {
    delete process.env.KIOKUDO_SINGLE_OWNER_DATASET_ACK;
    const response = await app.inject({ method: 'GET', url: path,
      headers: fixtureHeaders('GET', path) });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'owner_auth_not_configured');
  } finally {
    setFixtureOwnerEnv();
    await app.close();
    await cx.close();
  }
});

test('Core denies anonymous, shared-bearer-only and forged-owner requests', async () => {
  setFixtureOwnerEnv();
  const cx = await setupReviewDb();
  const app = buildApp({ serviceToken: token, database: cx });
  try {
    const cases = [
      {},
      { authorization: 'Bearer ' + token },
      { authorization: 'Bearer ' + token, 'x-user-id': 'test_owner_alpha' },
      { ...fixtureHeaders('GET', path),
        'x-kiokudo-owner-assertion': createFixtureAssertion('GET', path,
          { sub: 'test_owner_beta' }) },
      { ...fixtureHeaders('GET', path),
        'x-kiokudo-owner-assertion': 'not.a.valid.signature' },
      { ...fixtureHeaders('GET', path),
        'x-kiokudo-owner-assertion': createFixtureAssertion('GET', path,
          { exp: Math.floor(Date.now() / 1000) - 1 }) },
      { ...fixtureHeaders('GET', path),
        'x-kiokudo-owner-assertion': createFixtureAssertion('GET', path,
          { aud: 'another-service' }) },
      { ...fixtureHeaders('GET', path),
        'x-kiokudo-owner-assertion': createFixtureAssertion('GET', path,
          { iss: 'browser' }) },
      { ...fixtureHeaders('GET', path),
        'x-kiokudo-owner-assertion': createFixtureAssertion('GET', path,
          { scope: 'write' }) },
      fixtureHeaders('GET', '/api/v1/grammar/practice?limit=99'),
      fixtureHeaders('POST', path),
    ];
    for (const headers of cases) {
      const response = await app.inject({ method: 'GET', url: path, headers });
      assert.equal(response.statusCode, 401, response.body);
    }
    const allowed = await app.inject({ method: 'GET', url: path,
      headers: fixtureHeaders('GET', path) });
    assert.equal(allowed.statusCode, 400, allowed.body);
    assert.equal(allowed.json().error, 'invalid_limit');
  } finally {
    await app.close();
    await cx.close();
  }
});

test('write authorization remains disabled even with a valid owner assertion', async () => {
  setFixtureOwnerEnv();
  const cx = await setupReviewDb();
  const app = buildApp({ serviceToken: token, database: cx });
  const writePath = '/api/v1/grammar/practice/attempts';
  try {
    process.env.KIOKUDO_STAGING_WRITE_ENABLED = 'false';
    const response = await app.inject({
      method: 'POST', url: writePath,
      headers: fixtureHeaders('POST', writePath),
      payload: { eventId: 'denied-attempt', exerciseId: 'exercise1', answer: 'A', answeredAt: new Date().toISOString() },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'staging_writes_disabled');
    const count = await cx.client.execute('SELECT COUNT(*) AS n FROM review_logs');
    assert.equal(Number(count.rows[0].n), 0, 'rejected writes must not mutate historical learning records');
  } finally {
    setFixtureOwnerEnv();
    await app.close();
    await cx.close();
  }
});

test('owner assertion validator rejects signature tampering, expired/future tokens and cross-user identities', () => {
  setFixtureOwnerEnv();
  const good = createFixtureAssertion('GET', path);
  assert.equal(verifySingleOwnerRequest(good, 'GET', path), 'ok');
  const bad = good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A');
  assert.equal(verifySingleOwnerRequest(bad, 'GET', path), 'unauthorized');
  assert.equal(verifySingleOwnerRequest(createFixtureAssertion('GET', path,
    { exp: Math.floor(Date.now() / 1000) + 600 }), 'GET', path), 'unauthorized');
  assert.equal(verifySingleOwnerRequest(createFixtureAssertion('GET', path,
    { sub: 'test_owner_beta' }), 'GET', path), 'unauthorized');
  assert.equal(verifySingleOwnerRequest(good, 'GET', path + '&search=x'), 'unauthorized');
  assert.equal(verifySingleOwnerRequest(good, 'POST', path), 'unauthorized');
});
