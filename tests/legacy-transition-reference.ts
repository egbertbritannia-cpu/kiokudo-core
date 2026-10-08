/**
 * Reference fixture: exact calculation body extracted from
 * japanese-srs-system/src/services/review-service.ts @ 3348f4ee49c9539fb9ea60c96e42833811c325ca
 * Tests only the pure FSRS transition; deliberately excludes legacy database writes,
 * synthesized grammar cards and non-atomic transaction fallback.
 * Do not edit algorithm body below without upgrading the recorded source commit.
 */
import { FSRS, Rating, State, createEmptyCard, generatorParameters } from 'ts-fsrs';
import type { cards } from '../src/db/schema.js';
import type { calculateReviewTransition } from '../src/services/review-service.js';
type CardRow = typeof cards.$inferSelect;
type ReviewRating = 'Again'|'Hard'|'Good'|'Easy';
type ReviewTransition = ReturnType<typeof calculateReviewTransition>;
class ReviewServiceError extends Error {
  constructor(public code: string, message: string, public status: number = 400) {super(message);}
}
const fsrs = new FSRS(generatorParameters());
const stateEnumMap: Record<string, State> = {
  New: State.New, Learning: State.Learning, Review: State.Review, Relearning: State.Relearning,
};
const stateStringMap: Record<number, string> = {
  [State.New]: 'New', [State.Learning]: 'Learning', [State.Review]: 'Review',
  [State.Relearning]: 'Relearning',
};
function toDate(raw: Date|number|string): Date {return raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);}

export function legacyCalculateReviewTransition(
  currentCard: CardRow,
  rating: ReviewRating,
  ratingEnum: Rating,
  reviewedAt: Date
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
    throw new ReviewServiceError('FSRS_TRANSITION_FAILED', 'FSRS did not return a transition.', 500);
  }

  const nextCard = item.card;
  const logItem = item.log;
  const state = stateStringMap[nextCard.state] || 'Learning';

  // Keep the existing production behavior: Review cards are never scheduled below one day.
  let scheduledDays = nextCard.scheduled_days;
  let due = nextCard.due;
  if (nextCard.state === State.Review && scheduledDays < 1.0) {
    scheduledDays = 1;
    due = new Date(reviewedAt.getTime() + 86_400_000);
  }

  return {
    rating,
    state,
    stability: nextCard.stability,
    difficulty: nextCard.difficulty,
    elapsedDays: logItem.elapsed_days ?? 0,
    lastElapsedDays: logItem.last_elapsed_days ?? 0,
    scheduledDays: Math.round(scheduledDays),
    reps: nextCard.reps,
    lapses: nextCard.lapses,
    due,
  };
}
