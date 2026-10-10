import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { grammarExercises, grammarAttemptLogs, jpd133CardLinks, cards } from '../db/schema.js';

type Payload = Record<string, unknown>;
function object(body: unknown): Payload | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Payload : null;
}
function validId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(raw);
}
function normalized(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Never accept isCorrect from the browser. The Core exercise bank is authoritative. */
function correctness(row: typeof grammarExercises.$inferSelect, answer: string): boolean {
  const actual = normalized(answer);
  const expected = row.correctOption && row.exerciseType === 'multiple_choice'
    ? row.correctOption : row.answerText;
  if (actual === normalized(expected)) return true;
  try {
    const alternatives: unknown = row.alternateAnswers ? JSON.parse(row.alternateAnswers) : [];
    return Array.isArray(alternatives) && alternatives.some(
      alt => typeof alt === 'string' && normalized(alt) === actual,
    );
  } catch { return false; }
}

export function registerLearningRoutes(app: FastifyInstance, db?: Database) {
  app.get<{Querystring:{slot?:string}}>('/api/v1/curriculum/jpd133/mappings', async (req, reply) => {
    if (!db) return reply.code(503).send({error:'staging_database_not_configured'});
    const raw = req.query.slot;
    const slot = raw === undefined ? null : Number(raw);
    if (slot !== null && ![1,2,3,4,5,6,8,10].includes(slot)) {
      return reply.code(400).send({error:'invalid_jpd133_slot'});
    }
    try {
      const items = slot === null ? await db.select().from(jpd133CardLinks)
        : await db.select().from(jpd133CardLinks).where(eq(jpd133CardLinks.slotNumber,slot));
      return reply.header('Cache-Control','private, no-store').send({
        success:true, data:items.map(x=>({
          sourceKey:x.sourceKey, slotNumber:x.slotNumber, sourcePage:x.sourcePage, cardId:x.cardId,
        })),
      });
    } catch {
      return reply.code(503).send({error:'jpd133_mapping_migration_required'});
    }
  });

  // Operator-only mapping import. Source keys must originate from the reviewed
  // curriculum manifest; never fabricate FSRS cards or accept anonymous links.
  app.post('/api/v1/curriculum/jpd133/mappings', async(req,reply)=>{
    if(!db)return reply.code(503).send({error:'staging_database_not_configured'});
    if(process.env.KIOKUDO_MAPPING_IMPORT_ENABLED!=='true') {
      return reply.code(403).send({error:'mapping_import_disabled'});
    }
    const b=object(req.body);
    const sourceKey=b?.sourceKey,cardId=b?.cardId,slotNumber=b?.slotNumber,sourcePage=b?.sourcePage;
    if(!validId(sourceKey)||!validId(cardId)||typeof slotNumber!=='number'||
      ![1,2,3,4,5,6,8,10].includes(slotNumber)||
      typeof sourcePage!=='number'||!Number.isInteger(sourcePage)||sourcePage<1||
      !sourceKey.startsWith(`jpd133-p${sourcePage}-`)){
      return reply.code(400).send({error:'invalid_mapping'});
    }
    try{
      const outcome=await db.transaction(async tx=>{
        const [card]=await tx.select({id:cards.id}).from(cards).where(eq(cards.id,cardId)).limit(1);
        if(!card)return {code:404,body:{error:'card_not_found'}};
        const [current]=await tx.select().from(jpd133CardLinks).where(eq(jpd133CardLinks.sourceKey,sourceKey)).limit(1);
        if(current){
          if(current.cardId!==cardId||current.slotNumber!==slotNumber||current.sourcePage!==sourcePage){
            return {code:409,body:{error:'mapping_conflict'}};
          }
          return {code:200,body:{success:true,status:'duplicate',data:{sourceKey,cardId,slotNumber,sourcePage}}};
        }
        await tx.insert(jpd133CardLinks).values({
          sourceKey,cardId,slotNumber,sourcePage,createdAt:new Date(),
        });
        return {code:201,body:{success:true,status:'created',data:{sourceKey,cardId,slotNumber,sourcePage}}};
      });
      return reply.code(outcome.code).send(outcome.body);
    }catch(err){app.log.error({err},'Mapping import failed');return reply.code(503).send({error:'mapping_storage_unavailable'})}
  });

  app.post('/api/v1/grammar/practice/attempts', async (req,reply) => {
    if (!db) return reply.code(503).send({error:'staging_database_not_configured'});
    const b=object(req.body);
    if (!b || !validId(b.eventId) || !validId(b.exerciseId) ||
        typeof b.answer !== 'string' || b.answer.length > 4000 ||
        typeof b.answeredAt !== 'string' || !Number.isFinite(Date.parse(b.answeredAt))) {
      return reply.code(400).send({error:'invalid_grammar_attempt'});
    }
    const eventId=b.eventId,exerciseId=b.exerciseId,answer=b.answer,at=new Date(b.answeredAt);
    if (at.getTime() > Date.now()+300_000) return reply.code(400).send({error:'invalid_future_timestamp'});
    try {
      const outcome=await db.transaction(async tx=>{
        const [previous]=await tx.select().from(grammarAttemptLogs).where(eq(grammarAttemptLogs.id,eventId)).limit(1);
        if(previous){
          if(previous.exerciseId !== exerciseId || previous.answer !== answer ||
             previous.answeredAt.getTime() !== at.getTime()){
            return {code:409,body:{error:'event_id_conflict'}};
          }
          return {code:200,body:{success:true,eventId,status:'duplicate',data:{
            exerciseId,isCorrect:previous.isCorrect,answeredAt:previous.answeredAt.toISOString(),
          }}};
        }
        const [exercise]=await tx.select().from(grammarExercises).where(eq(grammarExercises.id,exerciseId)).limit(1);
        if(!exercise)return {code:404,body:{error:'exercise_not_found'}};
        const isCorrect=correctness(exercise,answer);
        await tx.insert(grammarAttemptLogs).values({id:eventId,exerciseId,answer,isCorrect,answeredAt:at});
        return {code:200,body:{success:true,eventId,status:'applied',data:{exerciseId,isCorrect,answeredAt:at.toISOString()}}};
      });
      return reply.code(outcome.code).send(outcome.body);
    }catch(err){
      app.log.error({err},'grammar attempt storage unavailable');
      return reply.code(503).send({error:'grammar_attempt_storage_unavailable'});
    }
  });
}
