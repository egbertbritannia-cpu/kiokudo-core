import type { FastifyInstance } from 'fastify';
import { eq, desc, like, or, and } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { cards, decks } from '../db/schema.js';

interface CardsQuery {
  deck?: string;
  search?: string;
  limit?: string;
}

export function registerCardsRoutes(app: FastifyInstance, db: Database | undefined) {
  app.get<{ Querystring: CardsQuery }>('/api/v1/cards', async (request, reply) => {
    if (!db) return reply.code(503).send({ error: 'staging_database_not_configured' });
    const raw = request.query.limit;
    const parsed = raw === undefined ? 1000 : Number(raw);
    const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(2000, Math.trunc(parsed))) : 1000;
    const search = request.query.search?.trim();
    const deck = request.query.deck;
    const conditions = [];
    if (deck && deck !== 'all') conditions.push(eq(cards.deckId, deck));
    if (search) {
      conditions.push(or(like(cards.front, `%${search}%`),like(cards.reading,`%${search}%`),like(cards.meaning,`%${search}%`)));
    }
    try {
      const base = db.select({
        id: cards.id, kanji: cards.front, reading: cards.reading,
        meaning: cards.meaning, pitch: cards.pitch, sentence: cards.sentence,
        type: cards.type, deckId: cards.deckId, deckName: decks.name,
        state: cards.state, stability: cards.stability, difficulty: cards.difficulty,
        due: cards.due,
      }).from(cards).leftJoin(decks,eq(cards.deckId,decks.id));
      const filtered = conditions.length ? base.where(and(...conditions)) : base;
      const [cardList, allDecks, basicStates] = await Promise.all([
        filtered.orderBy(desc(cards.createdAt)).limit(limit),
        db.select().from(decks),
        db.select({deckId: cards.deckId, state: cards.state, due: cards.due}).from(cards),
      ]);
      const now=Date.now();
      const deckSummaries=allDecks.map(d=>{
        const related=basicStates.filter(x=>x.deckId===d.id);
        return {
          id:d.id, name:d.name, description:d.description || '',
          totalCards:related.length,
          dueCards:related.filter(x=>x.state!=='New' && x.due.getTime()<=now).length,
          newCards:related.filter(x=>x.state==='New').length,
          learnedCards:related.filter(x=>x.state!=='New').length,
        };
      });
      return reply.header('Cache-Control','private, no-store').send({
        success:true,
        data:cardList.map(c=>({...c,deck:c.deckName||'Mặc định'})),
        decks:allDecks,deckSummaries,
      });
    } catch (error) {
      app.log.error({err:error},'Cards query failed');
      return reply.code(500).send({error:'Internal Server Error'});
    }
  });
  // User-facing card creation was decommissioned. No POST route.
}
