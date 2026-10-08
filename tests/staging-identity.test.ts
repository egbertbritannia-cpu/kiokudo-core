import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseConnection } from '../src/db/client.js';
import { validateStagingConfiguration, verifyStagingDatabaseIdentity, LOCAL_REHEARSAL_MARKER } from '../src/db/staging-identity.js';

const secret='0123456789abcdef-staging-only-random-marker';
const base:NodeJS.ProcessEnv={
  KIOKUDO_DATABASE_SCOPE:'staging',
  KIOKUDO_DATABASE_URL:'libsql://isolated-stage.turso.io',
  KIOKUDO_DATABASE_AUTH_TOKEN:'staging-token',
  KIOKUDO_EXPECTED_STAGING_MARKER:secret,
};

test('staging config refuses mislabelled production, missing marker/token and fixture marker for remote',()=>{
  assert.equal(validateStagingConfiguration({}),undefined);
  assert.throws(()=>validateStagingConfiguration({...base,KIOKUDO_DATABASE_SCOPE:'production'}),/SCOPE/);
  assert.throws(()=>validateStagingConfiguration({...base,TURSO_DATABASE_URL:'libsql://isolated-stage.turso.io/'}),/matches legacy/);
  assert.throws(()=>validateStagingConfiguration({...base,KIOKUDO_DATABASE_AUTH_TOKEN:undefined}),/requires token/);
  assert.throws(()=>validateStagingConfiguration({...base,KIOKUDO_EXPECTED_STAGING_MARKER:undefined}),/STAGING_MARKER/);
  assert.throws(()=>validateStagingConfiguration({...base,KIOKUDO_EXPECTED_STAGING_MARKER:LOCAL_REHEARSAL_MARKER}),/fixture marker/);
  assert.deepEqual(validateStagingConfiguration(base),{url:base.KIOKUDO_DATABASE_URL,token:'staging-token',expectedMarker:secret});
});

test('read-only DB marker query rejects wrong, absent or duplicate identity',async()=>{
  const client=createDatabaseConnection('file::memory:').client;
  try {
    await assert.rejects(()=>verifyStagingDatabaseIdentity(client,secret),/identity row/);
    await client.execute('CREATE TABLE kiokudo_deployment_identity (environment TEXT PRIMARY KEY, marker TEXT NOT NULL)');
    await assert.rejects(()=>verifyStagingDatabaseIdentity(client,secret),/identity row/);
    await client.execute({sql:'INSERT INTO kiokudo_deployment_identity VALUES (?,?)',args:['staging','wrong-marker']});
    await assert.rejects(()=>verifyStagingDatabaseIdentity(client,secret),/identity mismatch/);
    await client.execute({sql:'UPDATE kiokudo_deployment_identity SET marker = ?',args:[secret]});
    await assert.doesNotReject(()=>verifyStagingDatabaseIdentity(client,secret));
    const count=await client.execute('SELECT COUNT(*) AS n FROM kiokudo_deployment_identity');
    assert.equal(count.rows[0].n,1,'verification does not write');
  }finally{client.close();}
});

test('actual Core startup fails before request serving when local staging marker is wrong',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'kiokudo-identity-'));
  const file=join(dir,'test.db');
  const client=createDatabaseConnection('file:'+file).client;
  await client.execute('CREATE TABLE kiokudo_deployment_identity (environment TEXT PRIMARY KEY, marker TEXT NOT NULL)');
  await client.execute({sql:'INSERT INTO kiokudo_deployment_identity VALUES (?,?)',args:['staging','definitely-wrong']});
  client.close();
  const keys=['KIOKUDO_DATABASE_URL','KIOKUDO_DATABASE_SCOPE','KIOKUDO_EXPECTED_STAGING_MARKER','KIOKUDO_DATABASE_AUTH_TOKEN'] as const;
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    process.env.KIOKUDO_DATABASE_URL='file:'+file;
    process.env.KIOKUDO_DATABASE_SCOPE='staging';
    process.env.KIOKUDO_EXPECTED_STAGING_MARKER=secret;
    delete process.env.KIOKUDO_DATABASE_AUTH_TOKEN;
    const {buildApp}=await import('../src/app.js');
    const app=buildApp({serviceToken:'test-only-service-token-minimum-length'});
    try {
      await assert.rejects(()=>app.ready(),/identity mismatch/);
    } finally {await app.close();}
  }finally{
    for(const key of keys){const old=saved[key];if(old===undefined)delete process.env[key];else process.env[key]=old;}
    await rm(dir,{recursive:true,force:true});
  }
});
