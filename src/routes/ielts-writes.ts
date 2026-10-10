import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  ieltsSessions, ieltsPracticeLogs, ieltsMutationState, ieltsMistakes, engVocab,
} from '../db/schema.js';

type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj|null => v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:null;
const id=(v:unknown):v is string => typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const validSections=['Reading','Listening','Writing','Speaking'];
const validTypes=['academic','general'];
const error=(code:string)=>({success:false,error:code});
function parseEntries(value:unknown):{number:number;answer:string}[]|null {
  if(!Array.isArray(value)||value.length>42)return null;
  const seen=new Set<number>();
  const entries:{number:number;answer:string}[]=[];
  for(const row of value){
    const v=obj(row);
    if(!v||typeof v.number!=='number'||!Number.isInteger(v.number)||v.number<1||v.number>42||
      typeof v.answer!=='string'||v.answer.length>20_000||seen.has(v.number))return null;
    seen.add(v.number);entries.push({number:v.number,answer:v.answer});
  }
  return entries;
}
const parseLastResponse=(raw:string):unknown=>{try{return JSON.parse(raw)}catch{return null}};
export function registerIeltsWriteRoutes(app:FastifyInstance,db?:Database) {
  app.post('/api/v1/ielts/sessions', async(req,reply)=>{
    if(!db)return reply.code(503).send(error('staging_database_not_configured'));
    const p=obj(req.body);
    if(!p||!id(p.sessionId)||!validSections.includes(String(p.section))||
       !validTypes.includes(String(p.testType))||
       (p.materialId!==undefined&&p.materialId!==null&&!id(p.materialId))||
       (p.testNumber!==undefined&&(typeof p.testNumber!=='string'||p.testNumber.length>120))){
      return reply.code(400).send(error('invalid_session_payload'));
    }
    const sessionId=p.sessionId as string,section=p.section as string,testType=p.testType as string;
    try {
      const outcome=await db.transaction(async tx=>{
        const [prev]=await tx.select().from(ieltsSessions).where(eq(ieltsSessions.id,sessionId)).limit(1);
        if(prev){
          if(prev.section!==section||prev.testType!==testType||
            prev.materialId!==(p.materialId??null)||prev.testNumber!==(p.testNumber??null))
            return {code:409,body:error('session_id_conflict')};
          const [previousMutation]=await tx.select().from(ieltsMutationState)
            .where(eq(ieltsMutationState.sessionId,sessionId)).limit(1);
          return {code:200,body:{success:true,status:'duplicate',data:{
            id:prev.id,revision:previousMutation?.revision??0,sessionStatus:prev.sessionStatus,
          }}};
        }
        const now=new Date();
        await tx.insert(ieltsSessions).values({
          id:sessionId,section,testType,materialId:(p.materialId as string|undefined)??null,
          testNumber:(p.testNumber as string|undefined)??null,
          startTime:now.getTime(),sessionStatus:'in_progress',createdAt:now,
        });
        const response={success:true,status:'created',data:{id:sessionId,revision:0,sessionStatus:'in_progress'}};
        await tx.insert(ieltsMutationState).values({
          sessionId,revision:0,lastRequestId:'initial',lastResponse:JSON.stringify(response),updatedAt:now,
        });
        return {code:201,body:response};
      });
      return reply.code(outcome.code).send(outcome.body);
    }catch(err){app.log.error({err},'IELTS session create failed');return reply.code(503).send(error('ielts_write_storage_unavailable'))}
  });

  async function mutate(
    sessionId:string, action:'draft'|'submit', input:unknown,
  ):Promise<{code:number;body:unknown}>{
    if(!db)return {code:503,body:error('staging_database_not_configured')};
    const p=obj(input);
    if(!id(sessionId)||!p||!id(p.requestId)||typeof p.expectedRevision!=='number'||
       !Number.isInteger(p.expectedRevision)||p.expectedRevision<0||
       (action==='draft'&&!Array.isArray(p.answers))){
      return {code:400,body:error('invalid_mutation_payload')};
    }
    const entries=p.answers===undefined?[]:parseEntries(p.answers);
    if(entries===null)return {code:400,body:error('invalid_answers')};
    if(action==='submit'&&entries.length) return {code:400,body:error('submit_requires_saved_draft')};
    try {
      return await db.transaction(async tx=>{
        const [session]=await tx.select().from(ieltsSessions).where(eq(ieltsSessions.id,sessionId)).limit(1);
        if(!session)return {code:404,body:error('session_not_found')};
        const [state]=await tx.select().from(ieltsMutationState).where(eq(ieltsMutationState.sessionId,sessionId)).limit(1);
        if(!state)return {code:503,body:error('migration_state_missing')};
        if(state.lastRequestId===p.requestId) {
          const previous=parseLastResponse(state.lastResponse);
          return previous?{code:200,body:previous}:{code:503,body:error('invalid_stored_ack')};
        }
        if(session.sessionStatus!=='in_progress')return {code:409,body:error('session_already_submitted')};
        if(action==='submit'&&state.revision===0)return {code:409,body:error('draft_required_before_submit')};
        if(state.revision!==p.expectedRevision)return {code:409,body:{...error('revision_conflict'),currentRevision:state.revision}};
        const now=new Date(), next=state.revision+1;
        if(action==='draft'){
          // Full draft replacement with STABLE question-log IDs: preserving rows
          // avoids breaking mistake.log_id foreign keys on later revisions.
          const existing=await tx.select().from(ieltsPracticeLogs)
            .where(eq(ieltsPracticeLogs.sessionId,sessionId));
          const byNumber=new Map(existing.map(row=>[row.questionNumber,row]));
          const wanted=new Set(entries.map(row=>row.number));
          for(const previous of existing){
            if(!wanted.has(previous.questionNumber)){
              const [linked]=await tx.select({id:ieltsMistakes.id})
                .from(ieltsMistakes).where(eq(ieltsMistakes.logId,previous.id)).limit(1);
              if(linked)return {code:409,body:error('draft_question_has_saved_analysis')};
              await tx.delete(ieltsPracticeLogs).where(eq(ieltsPracticeLogs.id,previous.id));
            }
          }
          for(const answer of entries){
            const current=byNumber.get(answer.number);
            if(current){
              await tx.update(ieltsPracticeLogs).set({
                userAnswer:answer.answer,
                submissionText:answer.number>=41?answer.answer:null,
              }).where(eq(ieltsPracticeLogs.id,current.id));
            }else{
              await tx.insert(ieltsPracticeLogs).values({
                id:sessionId+'_q_'+answer.number,sessionId,questionNumber:answer.number,
                userAnswer:answer.answer,submissionText:answer.number>=41?answer.answer:null,
                createdAt:now,
              });
            }
          }
        }else{
          await tx.update(ieltsSessions).set({
            sessionStatus:'completed',endTime:now.getTime(),
            totalDurationSeconds:Math.max(0,Math.floor((now.getTime()-session.startTime)/1000)),
          }).where(eq(ieltsSessions.id,sessionId));
        }
        // Never invent an IELTS band score. Scoring must be explicit later.
        const body={success:true,status:action==='draft'?'draft_saved':'submitted',requestId:p.requestId,
          data:{sessionId,revision:next,sessionStatus:action==='draft'?'in_progress':'completed'}};
        await tx.update(ieltsMutationState).set({
          revision:next,lastRequestId:p.requestId as string,lastResponse:JSON.stringify(body),updatedAt:now,
        }).where(eq(ieltsMutationState.sessionId,sessionId));
        return {code:200,body};
      });
    }catch(err){app.log.error({err},'IELTS mutation failed');return {code:503,body:error('ielts_write_storage_unavailable')}}
  }
  app.put<{Params:{id:string}}>('/api/v1/ielts/sessions/:id/draft',async(req,reply)=>{
    const result=await mutate(req.params.id,'draft',req.body);
    return reply.code(result.code).send(result.body);
  });
  app.post<{Params:{id:string}}>('/api/v1/ielts/sessions/:id/submit',async(req,reply)=>{
    const result=await mutate(req.params.id,'submit',req.body);
    return reply.code(result.code).send(result.body);
  });

  // Recorded mistakes / vocabulary are explicit learner data, not automatic grades.
  app.post('/api/v1/ielts/mistakes',async(req,reply)=>{
    if(!db)return reply.code(503).send(error('staging_database_not_configured'));
    const p=obj(req.body);
    if(!p||!id(p.id)||!id(p.sessionId)||
       (p.logId!==undefined&&p.logId!==null&&!id(p.logId))||
       (p.category!==undefined&&(typeof p.category!=='string'||p.category.length>80))||
       (p.rootCause!==undefined&&(typeof p.rootCause!=='string'||p.rootCause.length>4000))){
      return reply.code(400).send(error('invalid_mistake'));
    }
    try{
      const [prior]=await db.select().from(ieltsMistakes).where(eq(ieltsMistakes.id,p.id as string)).limit(1);
      if(prior){
        if(prior.sessionId===p.sessionId &&
           (prior.logId??null)===(p.logId??null) &&
           (prior.mistakeCategory??'')===(p.category??'') &&
           (prior.rootCauseAnalysis??'')===(p.rootCause??'') &&
           (prior.actionPlanForImprovement??'')===(p.actionPlan??'')){
          return reply.send({success:true,status:'duplicate',data:{id:p.id}});
        }
        return reply.code(409).send(error('duplicate_mistake_id'));
      }
      const [session]=await db.select().from(ieltsSessions).where(eq(ieltsSessions.id,p.sessionId as string)).limit(1);
      if(!session)return reply.code(404).send(error('session_not_found'));
      if(p.logId){
        const [log]=await db.select().from(ieltsPracticeLogs)
          .where(eq(ieltsPracticeLogs.id,p.logId as string)).limit(1);
        if(!log||log.sessionId!==p.sessionId)return reply.code(404).send(error('question_log_not_found'));
      }
      await db.insert(ieltsMistakes).values({id:p.id as string,sessionId:p.sessionId as string,
        logId:(p.logId as string|undefined)??null,
        mistakeCategory:(p.category as string|undefined)??null,
        rootCauseAnalysis:(p.rootCause as string|undefined)??null,
        actionPlanForImprovement:(p.actionPlan as string|undefined)??null,
        isResolved:false,createdAt:new Date(),
      });
      return reply.code(201).send({success:true,data:{id:p.id}});
    }catch{return reply.code(503).send(error('ielts_write_storage_unavailable'))}
  });
  app.post('/api/v1/ielts/vocab',async(req,reply)=>{
    if(!db)return reply.code(503).send(error('staging_database_not_configured'));
    const p=obj(req.body);
    if(!p||!id(p.id)||typeof p.word!=='string'||!p.word.trim()||p.word.length>160||
       (p.sessionId!==undefined&&p.sessionId!==null&&!id(p.sessionId))){
      return reply.code(400).send(error('invalid_vocab'));
    }
    try{
      const [existing]=await db.select().from(engVocab).where(eq(engVocab.id,p.id as string)).limit(1);
      if(existing){
        if(existing.word===(p.word as string).trim() &&
           (existing.sessionId??null)===(p.sessionId??null) &&
           (existing.primaryMeaning??'')===(p.meaning??'') &&
           (existing.partOfSpeech??'')===(p.partOfSpeech??'')){
          return reply.send({success:true,status:'duplicate',data:{id:p.id}});
        }
        return reply.code(409).send(error('duplicate_vocab_id'));
      }
      if(p.sessionId){
        const [session]=await db.select().from(ieltsSessions).where(eq(ieltsSessions.id,p.sessionId as string)).limit(1);
        if(!session)return reply.code(404).send(error('session_not_found'));
      }
      await db.insert(engVocab).values({
        id:p.id as string,word:(p.word as string).trim(),sessionId:(p.sessionId as string|undefined)??null,
        primaryMeaning:typeof p.meaning==='string'?p.meaning.slice(0,4000):null,
        partOfSpeech:typeof p.partOfSpeech==='string'?p.partOfSpeech.slice(0,50):null,
        phonetic:typeof p.phonetic==='string'?p.phonetic.slice(0,160):null,
        contextSentence:typeof p.contextSentence==='string'?p.contextSentence.slice(0,1000):null,
        createdAt:new Date(),updatedAt:new Date(),
      });
      return reply.code(201).send({success:true,data:{id:p.id}});
    }catch{return reply.code(503).send(error('ielts_write_storage_unavailable'))}
  });

  // A score is user-entered / teacher-entered; no mock estimate is generated.
  // Core stores its provenance as explicit manual scoring, not an AI prediction.
  app.put<{Params:{id:string}}>('/api/v1/ielts/sessions/:id/score',async(req,reply)=>{
    if(!db)return reply.code(503).send(error('staging_database_not_configured'));
    const p=obj(req.body);
    if(!id(req.params.id)||!p||!id(p.requestId)||
      typeof p.expectedRevision!=='number'||!Number.isInteger(p.expectedRevision)||p.expectedRevision<0||
      typeof p.rawScore!=='number'||!Number.isInteger(p.rawScore)||p.rawScore<0||p.rawScore>40||
      typeof p.band!=='number'||!Number.isFinite(p.band)||p.band<0||p.band>9||
      p.source!=='manual'){
      return reply.code(400).send(error('invalid_manual_score'));
    }
    try{
      const result=await db.transaction(async tx=>{
        const [session]=await tx.select().from(ieltsSessions).where(eq(ieltsSessions.id,req.params.id)).limit(1);
        const [state]=await tx.select().from(ieltsMutationState).where(eq(ieltsMutationState.sessionId,req.params.id)).limit(1);
        if(!session||!state)return {code:404,body:error('session_not_found')};
        if(state.lastRequestId===p.requestId){
          const previous=parseLastResponse(state.lastResponse);
          return {code:200,body:previous??error('invalid_stored_ack')};
        }
        if(session.sessionStatus==='in_progress')return {code:409,body:error('score_requires_submission')};
        if(session.section!=='Reading'&&session.section!=='Listening')
          return {code:409,body:error('raw_score_not_supported_for_section')};
        if(state.revision!==p.expectedRevision)
          return {code:409,body:{...error('revision_conflict'),currentRevision:state.revision}};
        const revision=state.revision+1;
        await tx.update(ieltsSessions).set({
          rawScore:p.rawScore as number,maxScore:40,currentScoreBand:p.band as number,
          sessionStatus:'reviewed',
        }).where(eq(ieltsSessions.id,session.id));
        const body={success:true,status:'manual_score_saved',requestId:p.requestId,
          data:{sessionId:session.id,revision,rawScore:p.rawScore,band:p.band,source:'manual',sessionStatus:'reviewed'}};
        await tx.update(ieltsMutationState).set({
          revision,lastRequestId:p.requestId as string,scoreSource:'manual',lastResponse:JSON.stringify(body),updatedAt:new Date(),
        }).where(eq(ieltsMutationState.sessionId,session.id));
        return {code:200,body};
      });
      return reply.code(result.code).send(result.body);
    }catch(err){app.log.error({err},'Manual IELTS score failed');return reply.code(503).send(error('ielts_write_storage_unavailable'))}
  });

  app.put<{Params:{id:string}}>('/api/v1/ielts/mistakes/:id',async(req,reply)=>{
    if(!db)return reply.code(503).send(error('staging_database_not_configured'));
    const p=obj(req.body);
    if(!id(req.params.id)||!p||!id(p.sessionId)||typeof p.category!=='string'||p.category.length>80||
      typeof p.rootCause!=='string'||p.rootCause.length>4000||
      typeof p.actionPlan!=='string'||p.actionPlan.length>4000){
      return reply.code(400).send(error('invalid_mistake'));
    }
    try{
      const result=await db.transaction(async tx=>{
        const [prior]=await tx.select().from(ieltsMistakes).where(eq(ieltsMistakes.id,req.params.id)).limit(1);
        if(!prior||prior.sessionId!==p.sessionId)return {code:404,body:error('mistake_not_found')};
        await tx.update(ieltsMistakes).set({
          mistakeCategory:p.category as string,rootCauseAnalysis:p.rootCause as string,
          actionPlanForImprovement:p.actionPlan as string,
        }).where(eq(ieltsMistakes.id,req.params.id));
        return {code:200,body:{success:true,status:'updated',data:{id:req.params.id}}};
      });
      return reply.code(result.code).send(result.body);
    }catch{return reply.code(503).send(error('ielts_write_storage_unavailable'))}
  });

}
