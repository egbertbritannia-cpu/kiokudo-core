import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const SERVICE_TOKEN = 'test-only-service-token-minimum-length';

describe('Kiokudo Core access boundary', () => {
  it('fails closed if no usable secret is supplied', () => {
    assert.throws(() => buildApp({serviceToken:'replace-this-with-a-long-random-value'}), /required/);
    assert.throws(() => buildApp({serviceToken:'short'}), /required/);
  });
  it('exposes minimal liveness without authentication', async () => {
    const app = buildApp({serviceToken:SERVICE_TOKEN});
    try {
      const r = await app.inject({method:'GET',url:'/api/v1/health'});
      assert.equal(r.statusCode,200);
      assert.equal(r.json().service,'kiokudo-core');
    } finally {await app.close();}
  });
  it('denies unauthenticated API access', async () => {
    const app = buildApp({serviceToken:SERVICE_TOKEN});
    try {
      const r = await app.inject({method:'GET',url:'/api/v1/status'});
      assert.equal(r.statusCode,401);
    } finally {await app.close();}
  });
  it('exposes an authenticated bootstrap status without falsely claiming business API readiness', async () => {
    const app = buildApp({serviceToken:SERVICE_TOKEN});
    try {
      const r = await app.inject({method:'GET',url:'/api/v1/status',headers:{authorization:`Bearer ${SERVICE_TOKEN}`}});
      assert.equal(r.statusCode,200);
      assert.equal(r.json().businessApisReady,false);
    } finally {await app.close();}
  });
});
