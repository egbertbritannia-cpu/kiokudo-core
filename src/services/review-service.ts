import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { FSRS, Rating, State, createEmptyCard, generatorParameters } from 'ts-fsrs';
import { cards, reviewLogs } from '../db/schema.js';
import type { Database } from '../db/client.js';

export type ReviewRating = 'Again' | 'Hard' | 'Good' | 'Easy';
export type ReviewStatus = 'applied' | 'duplicate';

export interface SubmitReviewInput {
  eventId?: string;
  cardId: string;
  rating: unknown;
  reviewedAt?: Date | number | string;
  responseTimeMs?: number;
}

export interface ReviewResult {
  eventId: string;
  status: ReviewStatus;
  cardId: string;
  rating: ReviewRating;
  state: string;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  nextReviewDate: string;
}

export interface RejectedReviewResult {
  eventId: string;
  status: 'rejected';
  cardId: string;
  error: string;
}

export type BatchReviewResult = ReviewResult | RejectedReviewResult;
type CardRow = typeof cards.$inferSelect;
type NewReviewLog = typeof reviewLogs.$inferInsert;

interface NormalizedReviewInput {
  eventId: string;
  cardId: string;
  rating: ReviewRating;
  ratingEnum: Rating;
  reviewedAt: Date;
  explicitReviewedAt: boolean;
  responseTimeMs?: number;
}
interface ReviewTransition {
  rating: ReviewRating;
  state: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  lastElapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  due: Date;
}
export class ReviewServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number = 400) {
    super(message);
    this.name = 'ReviewServiceError';
  }
}

// Same FSRS algorithm / parameters and same minimum one-day Review scheduling
// as the legacy canonical ReviewService. No client-supplied scheduling accepted.
const fsrs = new FSRS(generatorParameters());
const stateEnumMap: Record<string, State> = {
  New: State.New, Learning: State.Learning, Review: State.Review, Relearning: State.Relearning,
};
const stateStringMap: Record<number, string> = {
  [State.New]: 'New', [State.Learning]: 'Learning',
  [State.Review]: 'Review', [State.Relearning]: 'Relearning',
};

export function parseReviewRating(raw: unknown): { rating: ReviewRating; ratingEnum: Rating } {
  const value = typeof raw === 'string' ? raw.trim() : raw;
  if (value === 'Again' || value === 1 || value === '1') return { rating: 'Again', ratingEnum: Rating.Again };
  if (value === 'Hard' || value === 2 || value === '2') return { rating: 'Hard', ratingEnum: Rating.Hard };
  if (value === 'Good' || value === 3 || value === '3') return { rating: 'Good', ratingEnum: Rating.Good };
  if (value === 'Easy' || value === 4 || value === '4') return { rating: 'Easy', ratingEnum: Rating.Easy };
  throw new ReviewServiceError('INVALID_RATING', 'Rating must be Again, Hard, Good, Easy or 1-4.');
}

function toDate(raw: Date | number | string): Date {
  return raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
}

function normalizeInput(input: SubmitReviewInput, requireEventId = false): NormalizedReviewInput {
  if (!input || typeof input !== 'object') {
    throw new ReviewServiceError('INVALID_REVIEW', 'Review must be an object.');
  }
  if (typeof input.cardId !== 'string' || !input.cardId.trim() || input.cardId.length > 256) {
    throw new ReviewServiceError('INVALID_CARD_ID', 'Valid cardId is required.');
  }
  if (requireEventId && (!input.eventId || typeof input.eventId !== 'string')) {
    throw new ReviewServiceError('INVALID_EVENT_ID', 'Offline replay requires a stable eventId.');
  }
  if (input.eventId !== undefined && (typeof input.eventId !== 'string' || !input.eventId.trim() || input.eventId.length > 256)) {
    throw new ReviewServiceError('INVALID_EVENT_ID', 'Invalid eventId.');
  }
  const eventId = input.eventId ?? randomUUID();
  const reviewedAt = input.reviewedAt === undefined ? new Date() : toDate(input.reviewedAt);
  if (Number.isNaN(reviewedAt.getTime())) {
    throw new ReviewServiceError('INVALID_REVIEW_TIME', 'Invalid reviewedAt/reviewTime.');
  }
  const { rating, ratingEnum } = parseReviewRating(input.rating);
  return {
    eventId, cardId: input.cardId, rating, ratingEnum, reviewedAt,
    explicitReviewedAt: input.reviewedAt !== undefined,
    responseTimeMs: input.responseTimeMs,
  };
}

function duplicateToResult(log: typeof reviewLogs.$inferSelect): ReviewResult {
  return {
    eventId: log.id, status: 'duplicate', cardId: log.cardId,
    rating: log.rating as ReviewRating, state: log.state,
    stability: log.stability, difficulty: log.difficulty,
    scheduledDays: log.scheduledDays, nextReviewDate: toDate(log.due).toISOString(),
  };
}

/** No synthetic JPD133 IDs or user-facing Add Card. Grammar synthetic-card parity
 * remains a migration blocker; this staging API accepts real existing card IDs only. */
async function requireCard(tx: any, cardId: string): Promise<CardRow> {
  const rows = await tx.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (rows.length === 0) {
    throw new ReviewServiceError('CARD_NOT_FOUND', `Card with id ${cardId} not found.`, 404);
  }
  return rows[0] as CardRow;
}

export function calculateReviewTransition(
  currentCard: CardRow, rating: ReviewRating, ratingEnum: Rating, reviewedAt: Date
): ReviewTransition {
  const empty = createEmptyCard();
  const parsedState = stateEnumMap[currentCard.state] ?? State.New;
  const fsrsCard = {
    ...empty,
    due: currentCard.due ? toDate(currentCard.due) : empty.due,
    stability: typeof currentCard.stability === 'number' ? currentCard.stability : empty.stability,
    difficulty: typeof currentCard.difficulty === 'number' ? currentCard.difficulty : empty.difficulty,
    elapsed_days: currentCard.elapsedDays ?? 0,
    scheduled_days: currentCard.scheduledDays ?? 0,
    reps: currentCard.reps ?? 0,
    lapses: currentCard.lapses ?? 0,
    state: parsedState,
    last_review: currentCard.lastReview ? toDate(currentCard.lastReview) : undefined,
  };
  const recordLog = fsrs.repeat(fsrsCard, reviewedAt);
  const item = (recordLog as any)[ratingEnum];
  if (!item?.card || !item?.log) {
    throw new ReviewServiceError('FSRS_TRANSITION_FAILED', 'FSRS failed to calculate review.', 500);
  }
  const nextCard = item.card;
  const log = item.log;
  let scheduledDays: number = nextCard.scheduled_days;
  let due: Date = nextCard.due;
  if (nextCard.state === State.Review && scheduledDays < 1.0) {
    scheduledDays = 1;
    due = new Date(reviewedAt.getTime() + 86_400_000);
  }
  return {
    rating, state: stateStringMap[nextCard.state] || 'Learning',
    stability: nextCard.stability, difficulty: nextCard.difficulty,
    elapsedDays: log.elapsed_days ?? 0, lastElapsedDays: log.last_elapsed_days ?? 0,
    scheduledDays: Math.round(scheduledDays), reps: nextCard.reps, lapses: nextCard.lapses, due,
  };
}

function logRow(input: NormalizedReviewInput, t: ReviewTransition): NewReviewLog {
  return {
    id: input.eventId, cardId: input.cardId, rating: t.rating, state: t.state,
    due: t.due, stability: t.stability, difficulty: t.difficulty, elapsedDays: t.elapsedDays,
    lastElapsedDays: t.lastElapsedDays, scheduledDays: t.scheduledDays, reviewTime: input.reviewedAt,
  };
}
function resultRow(input: NormalizedReviewInput, t: ReviewTransition): ReviewResult {
  return {
    eventId: input.eventId, status: 'applied', cardId: input.cardId, rating: t.rating,
    state: t.state, stability: t.stability, difficulty: t.difficulty,
    scheduledDays: t.scheduledDays, nextReviewDate: t.due.toISOString(),
  };
}

async function applyWithinTransaction(tx: any, input: NormalizedReviewInput): Promise<ReviewResult> {
  const previous = await tx.select().from(reviewLogs).where(eq(reviewLogs.id, input.eventId)).limit(1);
  if (previous.length) {
    const log = previous[0] as typeof reviewLogs.$inferSelect;
    if (log.cardId !== input.cardId || log.rating !== input.rating || (input.explicitReviewedAt && toDate(log.reviewTime).getTime() !== input.reviewedAt.getTime())) {
      throw new ReviewServiceError('EVENT_ID_CONFLICT', 'eventId already belongs to a different review.', 409);
    }
    return duplicateToResult(log);
  }
  const card = await requireCard(tx, input.cardId);
  const t = calculateReviewTransition(card, input.rating, input.ratingEnum, input.reviewedAt);

  // The immutable review event and card state must succeed/fail together.
  await tx.update(cards).set({
    stability: t.stability, difficulty: t.difficulty,
    elapsedDays: t.elapsedDays, scheduledDays: t.scheduledDays,
    reps: t.reps, lapses: t.lapses, state: t.state,
    due: t.due, lastReview: input.reviewedAt, updatedAt: new Date(),
  }).where(eq(cards.id, input.cardId));
  await tx.insert(reviewLogs).values(logRow(input, t));
  return resultRow(input, t);
}

export async function submitReview(db: Database, input: SubmitReviewInput): Promise<ReviewResult> {
  const normalized = normalizeInput(input);
  // NEVER retry outside the transaction on arbitrary DB exceptions.
  return db.transaction(async tx => applyWithinTransaction(tx, normalized));
}

export async function submitReviewBatch(db: Database, inputs: SubmitReviewInput[]): Promise<BatchReviewResult[]> {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 200) {
    throw new ReviewServiceError('INVALID_BATCH', 'Batch must contain 1-200 reviews.');
  }
  const prepared = inputs.map((input, index) => {
    try { return { index, normalized: normalizeInput(input, true), rejected: null as RejectedReviewResult | null }; }
    catch (err) {
      if (!(err instanceof ReviewServiceError)) throw err;
      const maybe = (input && typeof input === 'object') ? input : ({} as SubmitReviewInput);
      return {
        index, normalized: null,
        rejected: {
          eventId: typeof maybe.eventId === 'string' ? maybe.eventId : `invalid_${index}`,
          status: 'rejected' as const,
          cardId: typeof maybe.cardId === 'string' ? maybe.cardId : '',
          error: err.code,
        },
      };
    }
  });
  const valid = prepared.filter(p => p.normalized !== null).sort((a, b) => {
    const d = a.normalized!.reviewedAt.getTime() - b.normalized!.reviewedAt.getTime();
    return d || a.index - b.index;
  });
  const results = new Map<number, BatchReviewResult>();
  for (const p of prepared) if (p.rejected) results.set(p.index, p.rejected);

  if (valid.length) {
    await db.transaction(async tx => {
      for (const item of valid) {
        const input = item.normalized!;
        try {
          results.set(item.index, await applyWithinTransaction(tx, input));
        } catch (err) {
          if (err instanceof ReviewServiceError && err.status < 500) {
            results.set(item.index, { eventId: input.eventId, status: 'rejected', cardId: input.cardId, error: err.code });
            continue;
          }
          throw err; // whole batch must rollback on unexpected DB failure
        }
      }
    });
  }
  return inputs.map((_, i) => results.get(i)!);
}
