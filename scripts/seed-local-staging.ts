import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { seedLocalStaging, auditLocalStaging, normalizeDestination, type SeedManifest } from '../src/db/staging-seed.js';

const action=process.argv[2], output=process.argv[3];
if(!output || (action!=='seed' && action!=='audit')) {
  console.error('Usage: npm run staging:local -- seed|audit ./path/to/new-staging.db');
  process.exit(2);
}
const dbPath=normalizeDestination(output);
if(action==='seed') {
  const manifest=await seedLocalStaging(dbPath,resolve('fixtures/legacy-json'));
  const report=await auditLocalStaging(dbPath,manifest);
  console.log(JSON.stringify({manifest,report},null,2));
  if(!report.passed)process.exitCode=1;
}else{
  const manifest=JSON.parse(await readFile(dbPath+'.manifest.json','utf8')) as SeedManifest;
  const report=await auditLocalStaging(dbPath,manifest);
  console.log(JSON.stringify(report,null,2));
  if(!report.passed)process.exitCode=1;
}
