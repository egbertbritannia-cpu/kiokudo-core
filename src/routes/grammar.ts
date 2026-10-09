import type { FastifyInstance } from 'fastify';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { cards, grammarExercises, grammarLessons, grammarPatterns } from '../db/schema.js';

function parseJsonField(input: string | null | undefined): unknown {
  if (!input) return null;
  try { return JSON.parse(input); }
  catch { return null; }
}
function normalizePattern(p: typeof grammarPatterns.$inferSelect) {
  return {
    ...p,
    structureSlots: parseJsonField(p.structureSlots) ?? [],
    examples: parseJsonField(p.examples) ?? [],
    verbTypes: parseJsonField(p.verbTypes),
    relatedPatternIds: parseJsonField(p.relatedPatternIds),
  };
}
function normalizeExercise(e: typeof grammarExercises.$inferSelect) {
  return {...e, alternateAnswers: parseJsonField(e.alternateAnswers)};
}
const unavailable = {error:'staging_database_not_configured'};

export function registerGrammarRoutes(app: FastifyInstance, db?: Database) {
  app.get('/api/v1/grammar', async (_req, reply) => {
    if (!db) return reply.code(503).send(unavailable);
    try {
      const [lessons, patterns, grammarCards] = await Promise.all([
        db.select().from(grammarLessons).orderBy(asc(grammarLessons.lessonNumber)),
        db.select().from(grammarPatterns).orderBy(asc(grammarPatterns.lessonId),asc(grammarPatterns.patternNumber)),
        db.select().from(cards).where(eq(cards.deckId,'grammar_jpd133')),
      ]);
      const now=Date.now();
      const enriched=lessons.map(l=>{
        const list=grammarCards.filter(c=>typeof c.tags==='string' && c.tags.includes(`lesson-${l.id}`));
        return {...l,stats:{
          totalCards:list.length,
          dueCards:list.filter(c=>c.due.getTime()<=now).length,
          newCards:list.filter(c=>c.state==='New').length,
          masteryRate:list.length ? Math.round(list.filter(c=>c.stability>10).length/list.length*100):0,
        }};
      });
      const patternSummary=patterns.map(p=>({
        id:p.id,lessonId:p.lessonId,patternNumber:p.patternNumber,
        titleJa:p.patternTemplate,titleVi:p.meaningVi,romaji:'',
        jlptLevel:p.jlptLevel,meaning:p.meaningVi,
      }));
      return reply.header('Cache-Control','private, no-store').send({
        lessons:enriched,
        stats:{
          totalLessons:lessons.length,
          totalPatterns:lessons.reduce((n,l)=>n+l.patternCount,0),
          totalCards:grammarCards.length,
          dueCards:grammarCards.filter(c=>c.due.getTime()<=now).length,
          newCards:grammarCards.filter(c=>c.state==='New').length,
          reviewCards:grammarCards.filter(c=>c.state==='Review').length,
        },
        patterns:patternSummary,
      });
    }catch(err){app.log.error({err},'Grammar catalog failed');return reply.code(503).send({error:'grammar_staging_schema_unavailable'});}
  });

  // Register explicit /practice before /:lessonId to prevent routing collision.
  app.get<{Querystring:{lessonId?:string;limit?:string}}>('/api/v1/grammar/practice',async(req,reply)=>{
    if (!db) return reply.code(503).send(unavailable);
    const lessonId=req.query.lessonId || 'all';
    const raw=Number(req.query.limit ?? 15);
    if(!Number.isInteger(raw)||raw<1||raw>200) return reply.code(400).send({error:'invalid_limit'});
    try {
      let exercises: typeof grammarExercises.$inferSelect[]=[];
      if(lessonId==='all'){
        exercises=await db.select().from(grammarExercises).orderBy(asc(grammarExercises.sortOrder)).limit(raw);
      }else{
        const patterns=await db.select({id:grammarPatterns.id}).from(grammarPatterns).where(eq(grammarPatterns.lessonId,lessonId));
        if(patterns.length) exercises=await db.select().from(grammarExercises)
          .where(inArray(grammarExercises.patternId,patterns.map(p=>p.id)))
          .orderBy(asc(grammarExercises.sortOrder)).limit(raw);
      }
      return reply.header('Cache-Control','private, no-store').send({
        total:exercises.length,lessonId,exercises:exercises.map(normalizeExercise),
      });
    }catch(err){app.log.error({err},'Grammar exercise read failed');return reply.code(503).send({error:'grammar_staging_schema_unavailable'});}
  });

  app.get<{Params:{lessonId:string}}>('/api/v1/grammar/:lessonId',async(req,reply)=>{
    if (!db) return reply.code(503).send(unavailable);
    if(!req.params.lessonId||req.params.lessonId.length>128) return reply.code(400).send({error:'invalid_lesson_id'});
    try {
      const [lesson]=await db.select().from(grammarLessons).where(eq(grammarLessons.id,req.params.lessonId)).limit(1);
      if(!lesson) return reply.code(404).send({error:'lesson_not_found'});
      const patterns=await db.select().from(grammarPatterns).where(eq(grammarPatterns.lessonId,lesson.id))
        .orderBy(asc(grammarPatterns.patternNumber));
      return reply.header('Cache-Control','private, no-store')
        .send({...lesson,patterns:patterns.map(normalizePattern)});
    }catch(err){app.log.error({err},'Grammar lesson read failed');return reply.code(503).send({error:'grammar_staging_schema_unavailable'});}
  });
}
