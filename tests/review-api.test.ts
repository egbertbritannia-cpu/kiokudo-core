import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { setupReviewDb } from './fixtures.js';

const token='test-only-service-token-minimum-length';
const at='2026-10-08T10:00:00.000Z';
const auth={authorization:`Bearer ${token}`};

test('without a staging database, business API fails closed', async()=>{
  const app=buildApp({serviceToken:token});
  try {
    const res=await app.inject({method:'GET',url:'/api/v1/cards',headers:auth});
    assert.equal(res.statusCode,503);
    const stat=await app.inject({method:'GET',url:'/api/v1/status',headers:auth});
    assert.equal(stat.json().reviewApiStagingReady,false);
    const denied=await app.inject({method:'POST',url:'/api/v1/reviews',payload:{},headers:{}});
    assert.equal(denied.statusCode,401);
  } finally {await app.close();}
});

test('cards GET exposes database data; no public Add Card POST', async()=>{
  const cx=await setupReviewDb(),app=buildApp({serviceToken:token,database:cx});
  try {
    const r=await app.inject({method:'GET',url:'/api/v1/cards?deck=jpd&limit=10',headers:auth});
    assert.equal(r.statusCode,200);
    const data=r.json();
    assert.equal(data.data.length,1);
    assert.equal(data.data[0].id,'card-a');
    assert.equal(data.decks.length,1);
    assert.equal(data.deckSummaries[0].newCards,1);
    const denied=await app.inject({method:'POST',url:'/api/v1/cards',headers:auth,payload:{}});
    assert.equal(denied.statusCode,404);
  } finally {await app.close();await cx.close();}
});

test('review: writes FSRS state/log atomically, preserves legacy-shaped response, rejects collision', async()=>{
  const cx=await setupReviewDb(),app=buildApp({serviceToken:token,database:cx});
  const payload={eventId:'session-1-event-1',cardId:'card-a',rating:'Good',reviewedAt:at,scheduledDays:9999};
  try {
    const first=await app.inject({method:'POST',url:'/api/v1/reviews',headers:auth,payload});
    assert.equal(first.statusCode,200,first.body);
    assert.equal(first.json().status,'applied');
    assert.equal(first.json().data.cardId,'card-a');
    assert.notEqual(first.json().data.scheduledDays,9999);
    const log=await cx.client.execute('SELECT * FROM review_logs');
    assert.equal(log.rows.length,1);
    const card=await cx.client.execute('SELECT state,reps,stability,scheduled_days FROM cards WHERE id = "card-a"');
    assert.ok(Number(card.rows[0].reps)>0);
    assert.equal(Number(card.rows[0].scheduled_days),first.json().data.scheduledDays);
    const second=await app.inject({method:'POST',url:'/api/v1/reviews',headers:auth,payload});
    assert.equal(second.statusCode,200,second.body);
    assert.equal(second.json().status,'duplicate');
    const unchanged=await cx.client.execute('SELECT reps FROM cards WHERE id = "card-a"');
    assert.equal(unchanged.rows[0].reps,card.rows[0].reps);
    const conflict=await app.inject({method:'POST',url:'/api/v1/reviews',headers:auth,payload:{...payload,rating:'Hard'}});
    assert.equal(conflict.statusCode,409,conflict.body);
    const noCard=await app.inject({method:'POST',url:'/api/v1/reviews',headers:auth,payload:{eventId:'other',cardId:'missing',rating:'Good',reviewedAt:at}});
    assert.equal(noCard.statusCode,404);
    const notCreated=await cx.client.execute('SELECT COUNT(*) as n FROM cards');
    assert.equal(Number(notCreated.rows[0].n),1);
  } finally {await app.close();await cx.close();}
});

test('batch: sorted replay, duplicate retry and rejected invalid events',async()=>{
  const cx=await setupReviewDb(),app=buildApp({serviceToken:token,database:cx});
  const earlier={eventId:'evt-early',cardId:'card-a',rating:'Good',reviewedAt:'2026-10-08T10:00:00.000Z'};
  const later={eventId:'evt-late',cardId:'card-a',rating:'Hard',reviewedAt:'2026-10-09T10:00:00.000Z'};
  try {
    const b=await app.inject({method:'POST',url:'/api/v1/reviews/batch',headers:auth,payload:{
      reviews:[later,earlier,{eventId:'bad-rating',cardId:'card-a',rating:7,reviewedAt:at}],
    }});
    assert.equal(b.statusCode,200,b.body);
    assert.deepEqual(b.json().results.map((x:any)=>x.status),['applied','applied','rejected']);
    assert.equal(b.json().processedCount,2);
    assert.equal(b.json().rejectedCount,1);
    const replay=await app.inject({method:'POST',url:'/api/v1/reviews/batch',headers:auth,payload:{reviews:[later,earlier]}});
    assert.equal(replay.statusCode,200,replay.body);
    assert.deepEqual(replay.json().results.map((x:any)=>x.status),['duplicate','duplicate']);
    const log=await cx.client.execute('SELECT COUNT(*) n FROM review_logs');
    assert.equal(Number(log.rows[0].n),2);
    const card=await cx.client.execute('SELECT reps FROM cards WHERE id = "card-a"');
    assert.equal(Number(card.rows[0].reps),2);
  } finally {await app.close();await cx.close();}
});

test('unexpected log insert failure rolls back card update (no non-transaction fallback)',async()=>{
  const cx=await setupReviewDb(),app=buildApp({serviceToken:token,database:cx});
  try{
    await cx.client.execute(`CREATE TRIGGER reject_review BEFORE INSERT ON review_logs
      BEGIN SELECT RAISE(ABORT, 'deliberate test fault'); END;`);
    const response=await app.inject({method:'POST',url:'/api/v1/reviews',headers:auth,payload:{
      eventId:'fail-evt',cardId:'card-a',rating:'Good',reviewedAt:at,
    }});
    assert.equal(response.statusCode,500,response.body);
    const row=await cx.client.execute('SELECT reps,state FROM cards WHERE id = "card-a"');
    assert.equal(Number(row.rows[0].reps),0);
    assert.equal(row.rows[0].state,'New');
    const log=await cx.client.execute('SELECT COUNT(*) n FROM review_logs');
    assert.equal(Number(log.rows[0].n),0);
  }finally{await app.close();await cx.close();}
});
