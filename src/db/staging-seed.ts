import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDatabaseConnection } from './client.js';
import { createLocalFixtureSchema } from './local-fixture-schema.js';
import { cards, decks } from './schema.js';
import { LOCAL_REHEARSAL_MARKER } from './staging-identity.js';

export interface SeedManifest {
  kind: 'git-json-rehearsal-not-production';
  sourceCommit: string;
  source: { path: string; records: number; sha256: string }[];
  expected: { decks: number; cards: number; reviewLogs: 0; missingReadings: number };
  databaseFile: string;
}
type Vocab = { word: string; reading: string; meaning: string; topic?: string; page?: number; type?: string; pitch?: string; sentence?: string };
const sourceCommit='3348f4ee49c9539fb9ea60c96e42833811c325ca';
const seedAt = new Date('2026-10-08T00:00:00.000Z');

export function normalizeDestination(output: string): string {
  if (!output || output.includes('://') || output.startsWith('file:') || !output.endsWith('.db')) {
    throw new Error('Destination must be a NEW local .db file path, never Turso URL');
  }
  return resolve(output);
}

function safeItems(raw: unknown, path: string): Vocab[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`Invalid source: ${path}`);
  return raw.map((r,i) => {
    if (!r || typeof r !== 'object' ||
      typeof r.word !== 'string' || !r.word.trim() ||
      typeof r.reading !== 'string' ||
      typeof r.meaning !== 'string' || !r.meaning.trim()) {
      throw new Error(`Invalid vocabulary row ${i} in ${path}`);
    }
    return r as Vocab;
  });
}

export async function seedLocalStaging(output: string, fixtureDir: string): Promise<SeedManifest> {
  const file=normalizeDestination(output);
  if (existsSync(file) || existsSync(file+'-wal') || existsSync(file+'-shm')) {
    throw new Error('Refusing to overwrite existing staging database');
  }
  const sources=[
    {name:'jpd133_vocab.json',deckId:'fixture_jpd133',deckName:'JPD133 source preview'},
    {name:'n5_vocab.json',deckId:'fixture_n5',deckName:'N5 source preview'},
  ];
  const parsed: { name:string; deckId:string; deckName:string; list:Vocab[]; sha256:string }[]=[];
  for (const source of sources) {
    const contents=await readFile(resolve(fixtureDir,source.name),'utf8');
    const list=safeItems(JSON.parse(contents),source.name);
    parsed.push({...source,list,sha256:createHash('sha256').update(contents).digest('hex')});
  }

  const connection=createDatabaseConnection('file:'+file);
  try {
    await createLocalFixtureSchema(connection.client);
    await connection.client.execute({sql:'INSERT INTO kiokudo_deployment_identity (environment,marker) VALUES (?,?)',args:['staging',LOCAL_REHEARSAL_MARKER]});
    await connection.db.transaction(async(tx)=>{
      for(const dataset of parsed) {
        await tx.insert(decks).values({
          id:dataset.deckId,name:dataset.deckName,
          description:'Non-production Git JSON rehearsal data only',createdAt:seedAt,
        });
        for(let i=0;i<dataset.list.length;i++){
          const item=dataset.list[i];
          const id='fixture_'+createHash('sha256')
            .update(dataset.deckId+'\u0000'+String(i)+'\u0000'+item.word+'\u0000'+item.reading)
            .digest('hex').slice(0,24);
          await tx.insert(cards).values({
            id,deckId:dataset.deckId,type:item.type??'Vocab',
            front:item.word,reading:item.reading.trim() || null,meaning:item.meaning,
            pitch:item.pitch??null,sentence:item.sentence??null,
            tags:JSON.stringify([dataset.name,item.topic??'',item.page??''].filter(Boolean)),
            stability:0,difficulty:0,elapsedDays:0,scheduledDays:0,
            reps:0,lapses:0,state:'New',due:seedAt,
            createdAt:seedAt,updatedAt:seedAt,
          });
        }
      }
    });
    const count=parsed.reduce((sum,p)=>sum+p.list.length,0);
    const manifest:SeedManifest={
      kind:'git-json-rehearsal-not-production',sourceCommit,
      source:parsed.map(p=>({path:p.name,records:p.list.length,sha256:p.sha256})),
      expected:{decks:parsed.length,cards:count,reviewLogs:0,
        missingReadings:parsed.reduce((n,p)=>n+p.list.filter(x=>!x.reading.trim()).length,0)},
      databaseFile:file,
    };
    await writeFile(file+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    return manifest;
  } catch(err) {
    // New path only: delete partial rehearsal artifacts after failure.
    await rm(file,{force:true});
    await rm(file+'-wal',{force:true});
    await rm(file+'-shm',{force:true});
    await rm(file+'.manifest.json',{force:true});
    throw err;
  } finally {
    connection.client.close();
  }
}

export async function auditLocalStaging(output:string, manifest:SeedManifest) {
  const file=normalizeDestination(output);
  if (file !== manifest.databaseFile || manifest.kind!=='git-json-rehearsal-not-production') {
    throw new Error('Manifest does not match intended local rehearsal DB');
  }
  if (!existsSync(file)) throw new Error('Staging database file does not exist');
  const cx=createDatabaseConnection('file:'+file);
  try {
    const query=async(sql:string)=>Number((await cx.client.execute(sql)).rows[0].n);
    const actual={
      decks:await query('SELECT COUNT(*) n FROM decks'),
      cards:await query('SELECT COUNT(*) n FROM cards'),
      reviewLogs:await query('SELECT COUNT(*) n FROM review_logs'),
      nonNew:await query("SELECT COUNT(*) n FROM cards WHERE state <> 'New'"),
      orphanCards:await query('SELECT COUNT(*) n FROM cards c LEFT JOIN decks d ON c.deck_id=d.id WHERE d.id IS NULL'),
      missingReadings:await query("SELECT COUNT(*) n FROM cards WHERE reading IS NULL OR TRIM(reading) = ''"),
    };
    const passed=actual.decks===manifest.expected.decks &&
      actual.cards===manifest.expected.cards &&
      actual.reviewLogs===manifest.expected.reviewLogs &&
      actual.missingReadings===manifest.expected.missingReadings &&
      actual.nonNew===0 && actual.orphanCards===0;
    return {passed,kind:manifest.kind,expected:manifest.expected,actual};
  }finally{cx.client.close();}
}
