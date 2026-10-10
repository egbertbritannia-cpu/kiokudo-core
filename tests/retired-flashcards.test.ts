import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { fixtureHeaders, setFixtureOwnerEnv } from './owner-auth-fixture.js';

const token = 'test-only-service-token-minimum-length';

test('retired cards and flashcard review endpoints do not serve reads or writes', async () => {
  setFixtureOwnerEnv();
  process.env.KIOKUDO_STAGING_WRITE_ENABLED = 'true'; // isolated test environment, never production
  const app = buildApp({serviceToken: token});
  try {
    for(const [method,url] of [
      ['GET','/api/v1/cards'],
      ['POST','/api/v1/cards'],
      ['POST','/api/v1/reviews'],
      ['POST','/api/v1/reviews/batch'],
      ['POST','/api/v1/reviews/test-event/undo'],
    ] as const){
      const result = await app.inject({ method, url,
        headers: fixtureHeaders(method,url,token), payload: method === 'POST' ? {} : undefined });
      assert.equal(result.statusCode,404,method+' '+url+': '+result.body);
    }
    const health=await app.inject({method:'GET',url:'/api/v1/health'});
    assert.equal(health.statusCode,200);
  }finally{
    process.env.KIOKUDO_STAGING_WRITE_ENABLED='false';
    await app.close();
  }
});
