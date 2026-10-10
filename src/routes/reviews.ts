import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client.js';
import {
  ReviewServiceError, submitReview, submitReviewBatch, undoReview, type SubmitReviewInput,
} from '../services/review-service.js';

function asPayload(body: unknown): Record<string, any> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, any> : {};
}
function respondError(error: unknown, app: FastifyInstance) {
  if (error instanceof ReviewServiceError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  app.log.error({ err: error }, 'Review transaction failed');
  return { status: 500, body: { error: 'Internal Server Error' } };
}

export function registerReviewRoutes(app: FastifyInstance, db: Database | undefined) {
  app.post('/api/v1/reviews', async (request, reply) => {
    if (!db) return reply.code(503).send({ error: 'staging_database_not_configured' });
    const body = asPayload(request.body);
    if (typeof body.cardId !== 'string' || (body.rating ?? body.grade) === undefined) {
      return reply.code(400).send({ error: 'cardId and rating (or grade) are required' });
    }
    try {
      const result = await submitReview(db, {
        eventId: body.eventId ?? body.id,
        cardId: body.cardId,
        rating: body.rating ?? body.grade,
        reviewedAt: body.reviewedAt ?? body.reviewTime,
        responseTimeMs: body.responseTimeMs,
      });
      return reply.send({
        success: true, status: result.status, eventId: result.eventId,
        message: result.status === 'duplicate'
          ? 'Review already applied; no state mutation performed'
          : 'Review logged and DSR parameters updated',
        data: {
          cardId: result.cardId, rating: result.rating, state: result.state,
          stability: result.stability, difficulty: result.difficulty,
          scheduledDays: result.scheduledDays, nextReviewDate: result.nextReviewDate,
        },
      });
    } catch (error) {
      const e = respondError(error, app);
      return reply.code(e.status).send(e.body);
    }
  });

  app.post<{Params:{eventId:string}}>('/api/v1/reviews/:eventId/undo', async(request,reply)=>{
    if(!db)return reply.code(503).send({error:'staging_database_not_configured'});
    try{
      const result=await undoReview(db,request.params.eventId);
      return reply.send({success:true,...result});
    }catch(err){
      const e=respondError(err,app);
      return reply.code(e.status).send(e.body);
    }
  });

  app.post('/api/v1/reviews/batch', async (request, reply) => {
    if (!db) return reply.code(503).send({ error: 'staging_database_not_configured' });
    const body = asPayload(request.body);
    if (!Array.isArray(body.reviews) || !body.reviews.length) {
      return reply.code(400).send({ error: 'Body must contain non-empty reviews array' });
    }
    const inputs: SubmitReviewInput[] = body.reviews.map((raw: unknown) => {
      const i = asPayload(raw);
      return {
        eventId: i.eventId ?? i.id, cardId: i.cardId,
        rating: i.rating ?? i.grade,
        reviewedAt: i.reviewedAt ?? i.reviewTime, responseTimeMs: i.responseTimeMs,
      };
    });
    try {
      const results = await submitReviewBatch(db, inputs);
      const processedCount = results.filter(x => x.status === 'applied' || x.status === 'duplicate').length;
      const rejectedCount = results.filter(x => x.status === 'rejected').length;
      return reply.send({
        success: rejectedCount === 0,
        message: `Batch acknowledged ${processedCount} reviews; ${rejectedCount} rejected`,
        processedCount, rejectedCount, results, data: results,
      });
    } catch (error) {
      const e = respondError(error, app);
      return reply.code(e.status).send(e.body);
    }
  });
}
