import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { grammarExercises, grammarAttemptLogs } from '../db/schema.js';

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
