import type { FastifyInstance } from 'fastify';
import { asc, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  engMaterials, engVocab, ieltsMistakes, ieltsPracticeLogs, ieltsSessions, ieltsMutationState,
} from '../db/schema.js';

const unavailable={error:'staging_database_not_configured'};
const skills=[
  {skill:'Listening',target:8.5,color:'#002147'},
  {skill:'Reading',target:8.5,color:'#1B4268'},
  {skill:'Writing',target:7.5,color:'#D97706'},
  {skill:'Speaking',target:7.5,color:'#059669'},
];
const descriptions:Record<string,string>={
  Distraction:'Bẫy đề thi, thông tin đối lập giữa bài nghe và phương án',
  Vocabulary:'Không nhận ra từ đồng nghĩa (paraphrase) trong câu hỏi',
  'Time Management':'Tốn quá nhiều thời gian cho đoạn đầu dẫn tới cuống ở phần sau',
  Comprehension:'Mạch văn phức tạp chứa nhiều mệnh đề quan hệ hoặc từ nối',
  Careless:'Vượt quá giới hạn số từ quy định hoặc sai chính tả',
  Grammar:'Nhầm lẫn thì, dạng động từ hoặc trật tự từ',
};

export function registerIeltsReadRoutes(app:FastifyInstance,db?:Database){
  app.get('/api/v1/ielts/dashboard',async(_req,reply)=>{
    if(!db)return reply.code(503).send(unavailable);
    try{
      // Unlike the legacy repository, never write default seed data during GET,
      // and never claim that mock score/history is real learner progress.
      const [sessions,mistakes,vocab]=await Promise.all([
        db.select().from(ieltsSessions).orderBy(desc(ieltsSessions.startTime)).limit(20),
        db.select().from(ieltsMistakes),
        db.select({id:engVocab.id}).from(engVocab),
      ]);
      const completed=sessions.filter(s=>s.currentScoreBand!==null && s.currentScoreBand>0);
      const recent=completed.slice(0,3);
      const currentBand=recent.length
        ? Math.round(recent.reduce((n,s)=>n+(s.currentScoreBand??0),0)/recent.length*10)/10
        : 0;
      const skillBands=skills.map(s=>{
        const matched=completed.filter(c=>c.section.toLowerCase()===s.skill.toLowerCase());
        return {...s,current:matched.length
          ?Math.round(matched.reduce((n,c)=>n+(c.currentScoreBand??0),0)/matched.length*10)/10:0};
      });
      const cats=new Map<string,number>();
      for(const m of mistakes){const key=m.mistakeCategory||'Distraction';cats.set(key,(cats.get(key)||0)+1);}
      const breakdown=[...cats.entries()].map(([category,count])=>({
        category,count,percent:mistakes.length?Math.round(count/mistakes.length*100):0,
        desc:descriptions[category]||'Lỗi sai cần phân tích nguyên nhân gốc rễ',
      }));
      const result={
        targetBand:8,currentBand,totalMistakes:mistakes.length,totalVocab:vocab.length,skillBands,
        recentSessions:sessions.slice(0,5).map(s=>({
          id:s.id,title:s.testNumber||'Cambridge Practice Test',section:s.section,
          type:s.testType==='academic'?'Academic':'General',
          score:s.rawScore!==null?`${s.rawScore}/${s.maxScore||40}`:'—',
          band:s.currentScoreBand||0,date:new Date(s.startTime).toLocaleDateString('vi-VN'),
        })),
        mistakeBreakdown:breakdown,
        hasRecordedProgress:sessions.length>0||mistakes.length>0||vocab.length>0,
      };
      return reply.header('Cache-Control','private, no-store').send({success:true,data:result});
    }catch(err){app.log.error({err},'IELTS dashboard failed');return reply.code(503).send({error:'ielts_staging_schema_unavailable'});}
  });

  app.get('/api/v1/ielts/materials',async(_req,reply)=>{
    if(!db)return reply.code(503).send(unavailable);
    try{
      const result=await db.select().from(engMaterials).orderBy(desc(engMaterials.createdAt));
      return reply.header('Cache-Control','private, no-store').send({success:true,data:result});
    }catch(err){app.log.error({err},'IELTS materials failed');return reply.code(503).send({error:'ielts_staging_schema_unavailable'});}
  });
  app.get<{Querystring:{limit?:string}}>('/api/v1/ielts/sessions',async(req,reply)=>{
    if(!db)return reply.code(503).send(unavailable);
    const n=Number(req.query.limit??20);
    if(!Number.isInteger(n)||n<1||n>100)return reply.code(400).send({error:'invalid_limit'});
    try{
      const result=await db.select().from(ieltsSessions).orderBy(desc(ieltsSessions.startTime)).limit(n);
      return reply.header('Cache-Control','private, no-store').send({success:true,data:result});
    }catch(err){app.log.error({err},'IELTS sessions failed');return reply.code(503).send({error:'ielts_staging_schema_unavailable'});}
  });
  app.get<{Params:{id:string}}>('/api/v1/ielts/sessions/:id',async(req,reply)=>{
    if(!db)return reply.code(503).send(unavailable);
    try{
      const [session]=await db.select().from(ieltsSessions).where(eq(ieltsSessions.id,req.params.id)).limit(1);
      if(!session)return reply.code(404).send({success:false,error:'session_not_found'});
      const [logs,mistakes]=await Promise.all([
        db.select().from(ieltsPracticeLogs).where(eq(ieltsPracticeLogs.sessionId,session.id))
          .orderBy(asc(ieltsPracticeLogs.questionNumber)),
        db.select().from(ieltsMistakes).where(eq(ieltsMistakes.sessionId,session.id)),
      ]);
      let revision: number | null = null;
      // Historic imported sessions may predate the additive mutation table.
      // Reads keep working; writes require a provisioned revision state.
      try {
        const [row]=await db.select({revision:ieltsMutationState.revision})
          .from(ieltsMutationState).where(eq(ieltsMutationState.sessionId,session.id)).limit(1);
        revision=row?.revision??null;
      } catch { /* unprovisioned migration stays read-only */ }
      return reply.header('Cache-Control','private, no-store').send({success:true,data:{...session,logs,mistakes,revision}});
    }catch(err){app.log.error({err},'IELTS session detail failed');return reply.code(503).send({error:'ielts_staging_schema_unavailable'});}
  });
  app.get('/api/v1/ielts/vocab',async(_req,reply)=>{
    if(!db)return reply.code(503).send(unavailable);
    try{
      const result=await db.select().from(engVocab);
      return reply.header('Cache-Control','private, no-store').send({success:true,data:result});
    }catch(err){app.log.error({err},'IELTS vocab failed');return reply.code(503).send({error:'ielts_staging_schema_unavailable'});}
  });
  app.get('/api/v1/ielts/mistakes',async(_req,reply)=>{
    if(!db)return reply.code(503).send(unavailable);
    try{
      const result=await db.select().from(ieltsMistakes).orderBy(desc(ieltsMistakes.createdAt));
      return reply.header('Cache-Control','private, no-store').send({success:true,data:result});
    }catch(err){app.log.error({err},'IELTS mistakes failed');return reply.code(503).send({error:'ielts_staging_schema_unavailable'});}
  });
}
