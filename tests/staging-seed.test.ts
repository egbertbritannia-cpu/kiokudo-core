import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { seedLocalStaging, auditLocalStaging, normalizeDestination } from '../src/db/staging-seed.js';
import { createDatabaseConnection } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import { fixtureHeaders, setFixtureOwnerEnv } from './owner-auth-fixture.js';

test('rejects remote and existing destinations for fixture import',async()=>{
  assert.throws(()=>normalizeDestination('libsql://production.turso.io'),/NEW local/);
  assert.throws(()=>normalizeDestination('file:prod.db'),/NEW local/);
  const dir=await mkdtemp(join(tmpdir(),'kiokudo-stage-'));
  try{
    const file=join(dir,'local.db');
    await seedLocalStaging(file,resolve('fixtures/legacy-json'));
    await assert.rejects(()=>seedLocalStaging(file,resolve('fixtures/legacy-json')),/overwrite/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('Git JSON rehearsal creates audited SQLite and cards API reads it',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'kiokudo-import-')),file=join(dir,'seed.db');
  try {
    const manifest=await seedLocalStaging(file,resolve('fixtures/legacy-json'));
    const report=await auditLocalStaging(file,manifest);
    assert.equal(manifest.kind,'git-json-rehearsal-not-production');
    assert.equal(manifest.source.length,2);
    assert.equal(manifest.source[0].records,256);
    assert.equal(manifest.source[1].records,60);
    assert.equal(report.actual.cards,316);
    assert.equal(manifest.expected.missingReadings,22);
    assert.equal(report.actual.missingReadings,22);
    assert.equal(report.passed,true);
    const saved=JSON.parse(await readFile(file+'.manifest.json','utf8'));
    assert.deepEqual(saved.expected,manifest.expected);
    const cx=createDatabaseConnection('file:'+file);
    setFixtureOwnerEnv();
    const app=buildApp({serviceToken:'long-testing-token-do-not-use-in-production',database:cx});
    try {
      const r=await app.inject({method:'GET',url:'/api/v1/cards?deck=fixture_jpd133&limit=500',
       headers:fixtureHeaders('GET','/api/v1/cards?deck=fixture_jpd133&limit=500','long-testing-token-do-not-use-in-production')});
      assert.equal(r.statusCode,200,r.body);
      const payload=r.json();
      assert.equal(payload.data.length,256);
      assert.equal(payload.deckSummaries.find((d:any)=>d.id==='fixture_jpd133').totalCards,256);
    }finally{await app.close();cx.client.close();}
  }finally{await rm(dir,{recursive:true,force:true});}
});
