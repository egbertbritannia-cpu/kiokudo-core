import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { cards } from '../src/db/schema.js';
import { calculateReviewTransition, parseReviewRating } from '../src/services/review-service.js';
import { legacyCalculateReviewTransition } from './legacy-transition-reference.js';

type CardRow = typeof cards.$inferSelect;
const now=new Date('2026-10-08T09:00:00.000Z');
const states=['New','Learning','Review','Relearning'] as const;
const grades=['Again','Hard','Good','Easy'] as const;

function fixture(state:string,shiftDays=0):CardRow {
 const due=new Date(now.getTime() - shiftDays*86_400_000);
 return {
   id:'parity-card',deckId:'fixture',type:'Vocab',front:'父',reading:'ちち',
   meaning:'father',pitch:null,sentence:null,audioUrl:null,tags:null,
   stability:state==='New'?0:2.5,
   difficulty:state==='New'?0:5.1,
   elapsedDays:state==='New'?0:Math.max(1,shiftDays),
   scheduledDays:state==='New'?0:3,
   reps:state==='New'?0:6, lapses:state==='Relearning'?2:0,
   state, due, lastReview:state==='New'?null:new Date(now.getTime()-(shiftDays+3)*86_400_000),
   createdAt:new Date('2026-09-01T00:00:00.000Z'),updatedAt:now,
 } as CardRow;
}
function compare(oldValue: ReturnType<typeof legacyCalculateReviewTransition>,
 nextValue: ReturnType<typeof calculateReviewTransition>, label:string) {
 for(const key of ['rating','state','scheduledDays','elapsedDays','lastElapsedDays','reps','lapses'] as const){
   assert.equal(nextValue[key],oldValue[key],`${label}: ${key}`);
 }
 for(const key of ['difficulty','stability'] as const){
   assert.ok(Math.abs(nextValue[key]-oldValue[key])<1e-12,`${label}: ${key}`);
 }
 assert.equal(nextValue.due.toISOString(),oldValue.due.toISOString(),`${label}: due`);
}
test('FSRS outputs match exact legacy pure transition across card states, grades and lateness',()=>{
 let count=0;
 for(const state of states){
  for(const grade of grades){
   for(const daysLate of [0,1,7,31]){
    const card=fixture(state,daysLate);
    const normalized=parseReviewRating(grade);
    const before=legacyCalculateReviewTransition(card,normalized.rating,normalized.ratingEnum,now);
    const after=calculateReviewTransition(card,normalized.rating,normalized.ratingEnum,now);
    compare(before,after,`${state}/${grade}/late=${daysLate}`);
    count++;
   }
  }
 }
 assert.equal(count,64);
});
test('multi-review FSRS trajectories stay aligned with reference for fixed timestamps',()=>{
 for(const chain of [['Good','Good','Hard','Easy'],['Again','Hard','Good','Good'],['Easy','Again','Easy','Hard']] as const){
   let legacy=fixture('New'); let current=fixture('New');
   for(let i=0;i<chain.length;i++){
     const reviewedAt=new Date(now.getTime()+i*5*86_400_000);
     const n=parseReviewRating(chain[i]);
     const previous=legacyCalculateReviewTransition(legacy,n.rating,n.ratingEnum,reviewedAt);
     const candidate=calculateReviewTransition(current,n.rating,n.ratingEnum,reviewedAt);
     compare(previous,candidate,`trajectory=${chain.join(',')}/step=${i}`);
     legacy={...legacy,
       due:previous.due, stability:previous.stability,difficulty:previous.difficulty,
       elapsedDays:previous.elapsedDays, scheduledDays:previous.scheduledDays,
       reps:previous.reps,lapses:previous.lapses,state:previous.state,lastReview:reviewedAt,
     };
     current={...current,
       due:candidate.due, stability:candidate.stability,difficulty:candidate.difficulty,
       elapsedDays:candidate.elapsedDays, scheduledDays:candidate.scheduledDays,
       reps:candidate.reps,lapses:candidate.lapses,state:candidate.state,lastReview:reviewedAt,
     };
   }
 }
});
