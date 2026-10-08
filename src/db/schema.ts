import { sqliteTable, text, integer, real, blob, index } from 'drizzle-orm/sqlite-core';

/**
 * Định nghĩa schema cơ sở dữ liệu SQLite (Drizzle ORM)
 */

// Bảng Decks (Bộ thẻ)
export const decks = sqliteTable('decks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Bảng Cards (Thẻ học)
export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id),
    type: text('type').notNull(), // 'Kanji' | 'Vocab' | 'Cloze' | 'Pitch'
    front: text('front').notNull(),
    reading: text('reading'),
    meaning: text('meaning').notNull(),
    pitch: text('pitch'),
    sentence: text('sentence'),
    audioUrl: text('audio_url'),
    tags: text('tags'), // JSON string array

    // Trạng thái FSRS (DSR)
    stability: real('stability').default(0).notNull(),
    difficulty: real('difficulty').default(0).notNull(),
    elapsedDays: integer('elapsed_days').default(0).notNull(),
    scheduledDays: integer('scheduled_days').default(0).notNull(),
    reps: integer('reps').default(0).notNull(),
    lapses: integer('lapses').default(0).notNull(),
    state: text('state').default('New').notNull(), // 'New' | 'Learning' | 'Review' | 'Relearning'
    due: integer('due', { mode: 'timestamp' }).notNull(),
    lastReview: integer('last_review', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    deckIdIdx: index('idx_cards_deck_id').on(table.deckId),
    dueStateIdx: index('idx_cards_due_state').on(table.due, table.state),
    createdAtIdx: index('idx_cards_created_at').on(table.createdAt),
  })
);

// Bảng ReviewLogs (Lịch sử ôn tập để phục vụ huấn luyện lại tham số FSRS)
export const reviewLogs = sqliteTable(
  'review_logs',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    rating: text('rating').notNull(), // 'Again' | 'Hard' | 'Good' | 'Easy'
    state: text('state').notNull(),
    due: integer('due', { mode: 'timestamp' }).notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    elapsedDays: integer('elapsed_days').notNull(),
    lastElapsedDays: integer('last_elapsed_days').notNull(),
    scheduledDays: integer('scheduled_days').notNull(),
    reviewTime: integer('review_time', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    cardIdIdx: index('idx_review_logs_card_id').on(table.cardId),
  })
);

// ============================================================================
// CÁC BẢNG NÂNG CẤP KHOA HỌC NHẬN THỨC (COGNITIVE ENHANCEMENT TABLES)
// ============================================================================

// 1. Bảng lưu trữ 21 tham số FSRS cá nhân hóa
export const userFsrsParameters = sqliteTable('user_fsrs_parameters', {
  id: text('id').primaryKey(),
  userId: text('user_id').default('default_user').notNull(),
  wParameters: text('w_parameters').notNull(), // JSON string mảng 21 số thực
  sampleSize: integer('sample_size').notNull(),
  rmse: real('rmse').notNull(),
  logLoss: real('log_loss').notNull(),
  optimizedAt: integer('optimized_at', { mode: 'timestamp' }).notNull(),
  isActive: integer('is_active').default(1).notNull(),
});

// 2. Bảng nhúng vector ngữ nghĩa (Semantic Embeddings) cho LECTOR Interleaving
export const cardEmbeddings = sqliteTable('card_embeddings', {
  cardId: text('card_id')
    .primaryKey()
    .references(() => cards.id, { onDelete: 'cascade' }),
  embeddingVector: text('embedding_vector').notNull(), // JSON String hoặc base64 encoded Float32Array
  vectorDimension: integer('vector_dimension').default(384).notNull(),
  modelVersion: text('model_version').default('text-embedding-3-small').notNull(),
  generatedAt: integer('generated_at', { mode: 'timestamp' }).notNull(),
});

// 3. Bảng ghi nhận độ trễ phản xạ truy xuất (Bjork Latency Dynamics)
export const retrievalLatencyLogs = sqliteTable('retrieval_latency_logs', {
  id: text('id').primaryKey(),
  cardId: text('card_id')
    .notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  reviewLogId: text('review_log_id').notNull(),
  durationMs: integer('duration_ms').notNull(),
  userGrade: text('user_grade').notNull(), // 'Again' | 'Hard' | 'Good' | 'Easy'
  adjustedGrade: text('adjusted_grade').notNull(),
  penaltyApplied: integer('penalty_applied').default(0).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// 4. Bảng đỉnh đồ thị chữ Hán ngữ nguyên học (KanjiCompass Graph Nodes)
export const kanjiGraphNodes = sqliteTable('kanji_graph_nodes', {
  id: text('id').primaryKey(),
  nodeType: text('node_type').notNull(), // 'target_kanji' | 'phonetic_grapheme' | 'semantic_radical' | 'ideographic_compound'
  character: text('character').notNull(),
  strokeCount: integer('stroke_count').notNull(),
  onyomi: text('onyomi'), // JSON array: '["sai"]'
  kunyomi: text('kunyomi'), // JSON array: '["kiwa"]'
  primaryMeaning: text('primary_meaning').notNull(),
  jlptLevel: text('jlpt_level'), // 'N5' | 'N4' | 'N3' | 'N2' | 'N1' | 'Non-JLPT'
  newspaperFrequencyRank: integer('newspaper_frequency_rank'),
  etymologyExplanation: text('etymology_explanation'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// 5. Bảng cạnh đồ thị liên kết chữ Hán (KanjiCompass Graph Edges)
export const kanjiGraphEdges = sqliteTable('kanji_graph_edges', {
  id: text('id').primaryKey(),
  sourceNodeId: text('source_node_id')
    .notNull()
    .references(() => kanjiGraphNodes.id, { onDelete: 'cascade' }),
  targetNodeId: text('target_node_id')
    .notNull()
    .references(() => kanjiGraphNodes.id, { onDelete: 'cascade' }),
  relationshipType: text('relationship_type').notNull(), // 'HAS_PHONETIC' | 'HAS_RADICAL' | 'SAME_PHONETIC_FAMILY' | 'COMPOSED_OF_SEMANTIC_PARTS'
  weight: real('weight').default(1.0).notNull(),
});

// 6. Bảng tương tác nhận thức bậc cao (Desirable Difficulty Logs)
export const cognitiveInteractionLogs = sqliteTable('cognitive_interaction_logs', {
  id: text('id').primaryKey(),
  cardId: text('card_id')
    .notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  interactionType: text('interaction_type').notNull(), // 'generative_cloze' | 'elaborative_interrogation' | 'pitch_discrimination' | 'free_production'
  promptPresented: text('prompt_presented').notNull(),
  learnerResponse: text('learner_response').notNull(),
  isCorrect: integer('is_correct').notNull(),
  evaluatorFeedback: text('evaluator_feedback'),
  latencyMs: integer('latency_ms').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// 7. Bảng cơ chế thưởng nỗ lực nhận thức (Effort-Based Gamification Ledger)
export const gamificationEffortLedger = sqliteTable('gamification_effort_ledger', {
  id: text('id').primaryKey(),
  userId: text('user_id').default('default_user').notNull(),
  sessionId: text('session_id').notNull(),
  focusDurationSeconds: integer('focus_duration_seconds').notNull(),
  isMedAchieved: integer('is_med_achieved').default(0).notNull(),
  highOrderTasksCount: integer('high_order_tasks_count').default(0).notNull(),
  creditsEarned: integer('credits_earned').default(0).notNull(),
  sessionTimestamp: integer('session_timestamp', { mode: 'timestamp' }).notNull(),
});

// ============================================================================
// HỆ THỐNG HỌC NGỮ PHÁP (GRAMMAR ENGINE TABLES — ZERO REGRESSION)
// ============================================================================

// 8. Bảng Bài học Ngữ pháp (Grammar Lessons — Bài 8 đến Bài 11 JPD133)
export const grammarLessons = sqliteTable('grammar_lessons', {
  id: text('id').primaryKey(),
  lessonNumber: integer('lesson_number').notNull(),
  titleJa: text('title_ja').notNull(),
  titleVi: text('title_vi').notNull(),
  themeJa: text('theme_ja'),
  themeVi: text('theme_vi'),
  patternRange: text('pattern_range').notNull(),
  patternCount: integer('pattern_count').notNull(),
  accentColor: text('accent_color').notNull(),
  wagara: text('wagara'),
  inkanChar: text('inkan_char'),
  description: text('description').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// 9. Bảng Mẫu Cấu trúc Ngữ pháp (Grammar Patterns — 32 Patterns 72 đến 103)
export const grammarPatterns = sqliteTable(
  'grammar_patterns',
  {
    id: text('id').primaryKey(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => grammarLessons.id),
    patternNumber: integer('pattern_number').notNull(),
    jlptLevel: text('jlpt_level').notNull(),
    difficultyScore: integer('difficulty_score').default(3).notNull(),
    patternTemplate: text('pattern_template').notNull(),
    structureSlots: text('structure_slots').notNull(), // JSON string: GrammarStructureSlot[]
    meaningVi: text('meaning_vi').notNull(),
    meaningJa: text('meaning_ja'),
    usageNote: text('usage_note'),
    examples: text('examples').notNull(), // JSON string: GrammarExampleSentence[]
    verbTypes: text('verb_types'), // JSON string array
    relatedPatternIds: text('related_pattern_ids'), // JSON string array
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    lessonIdIdx: index('idx_grammar_patterns_lesson_id').on(table.lessonId),
    jlptIdx: index('idx_grammar_patterns_jlpt').on(table.jlptLevel),
    patternNumIdx: index('idx_grammar_patterns_num').on(table.patternNumber),
  })
);

// 10. Bảng Ngân hàng Bài tập Ngữ pháp (Grammar Exercises — 204 bài tập SBT)
export const grammarExercises = sqliteTable(
  'grammar_exercises',
  {
    id: text('id').primaryKey(),
    patternId: text('pattern_id')
      .notNull()
      .references(() => grammarPatterns.id, { onDelete: 'cascade' }),
    exerciseType: text('exercise_type').notNull(), // 'cloze' | 'multiple_choice' | 'fill_blank' | 'translation_vi_to_ja' | 'jumble'
    difficulty: integer('difficulty').default(2).notNull(),
    sentenceWithCloze: text('sentence_with_cloze'),
    question: text('question'),
    optionA: text('option_a'),
    optionB: text('option_b'),
    optionC: text('option_c'),
    optionD: text('option_d'),
    correctOption: text('correct_option'),
    promptText: text('prompt_text'),
    answerText: text('answer_text').notNull(),
    alternateAnswers: text('alternate_answers'), // JSON string array
    explanationVi: text('explanation_vi'),
    explanationJa: text('explanation_ja'),
    sourceRef: text('source_ref'),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    patternIdIdx: index('idx_grammar_exercises_pattern_id').on(table.patternId),
    exerciseTypeIdx: index('idx_grammar_exercises_type').on(table.exerciseType),
  })
);

// ============================================================================
// ENGLISH IELTS TRACKING ENGINE (PHASE 8)
// ============================================================================

export const engMaterials = sqliteTable('eng_materials', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // "book | course | web"
  title: text('title').notNull(),
  publisher: text('publisher'),
  yearPublished: integer('year_published'),
  totalTests: integer('total_tests'),
  testType: text('test_type').default('academic').notNull(), // "academic | general"
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const ieltsSessions = sqliteTable('ielts_sessions', {
  id: text('id').primaryKey(),
  materialId: text('material_id').references(() => engMaterials.id),
  testNumber: text('test_number'), // e.g., "Test 1"
  testType: text('test_type').default('academic').notNull(), // "academic | general"
  section: text('section').notNull(), // "Listening | Reading | Writing | Speaking"
  startTime: integer('start_time').notNull(),
  endTime: integer('end_time'),
  totalDurationSeconds: integer('total_duration_seconds'),
  rawScore: integer('raw_score'), // e.g. 32
  maxScore: integer('max_score').default(40), // e.g. 40
  currentScoreBand: real('current_score_band'), // e.g. 6.5, 7.0, 7.5, 8.0 (real float)
  targetScoreBand: real('target_score_band'), // e.g. 7.5, 8.0 (real float)
  sessionStatus: text('session_status').notNull(), // "in_progress | completed | reviewed"
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const ieltsPracticeLogs = sqliteTable('ielts_practice_logs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => ieltsSessions.id),
  questionNumber: integer('question_number').notNull(), // 1..40 or task 1, 2
  questionType: text('question_type'), // "Multiple Choice | T/F/NG | Matching | Essay | Cue Card"
  userAnswer: text('user_answer'),
  correctAnswer: text('correct_answer'),
  isCorrect: integer('is_correct', { mode: 'boolean' }),
  timeSpentSeconds: integer('time_spent_seconds'),
  submissionText: text('submission_text'), // For Writing essay / Speaking transcription
  audioUrl: text('audio_url'), // For Speaking audio recordings
  criteriaScores: text('criteria_scores'), // JSON: {"TR": 7.0, "CC": 7.5, "LR": 7.0, "GRA": 7.0}
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const ieltsMistakes = sqliteTable('ielts_mistakes', {
  id: text('id').primaryKey(),
  logId: text('log_id').references(() => ieltsPracticeLogs.id),
  sessionId: text('session_id').references(() => ieltsSessions.id), // Support macro-level session mistakes
  mistakeCategory: text('mistake_category'), // "Comprehension | Vocabulary | Grammar | Distraction | Time Management | Careless"
  rootCauseAnalysis: text('root_cause_analysis'),
  actionPlanForImprovement: text('action_plan_for_improvement'),
  isResolved: integer('is_resolved', { mode: 'boolean' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const engVocab = sqliteTable('eng_vocab', {
  id: text('id').primaryKey(),
  materialId: text('material_id').references(() => engMaterials.id),
  sessionId: text('session_id').references(() => ieltsSessions.id),
  logId: text('log_id').references(() => ieltsPracticeLogs.id), // Optional specific question reference
  word: text('word').notNull(),
  partOfSpeech: text('part_of_speech'),
  phonetic: text('phonetic'),
  primaryMeaning: text('primary_meaning'),
  contextSentence: text('context_sentence'),
  synonyms: text('synonyms'), // JSON array
  tags: text('tags'), // JSON array: ['ielts', 'academic']

  // Complete Forward Compatibility with FSRS Engine
  fsrsStability: real('fsrs_stability').default(0).notNull(),
  fsrsDifficulty: real('fsrs_difficulty').default(0).notNull(),
  fsrsDue: integer('fsrs_due', { mode: 'timestamp' }), // Timestamp or null for unactivated SRS
  fsrsState: text('fsrs_state').default('New').notNull(), // 'New' | 'Learning' | 'Review' | 'Relearning'
  reps: integer('reps').default(0).notNull(),
  lapses: integer('lapses').default(0).notNull(),
  elapsedDays: integer('elapsed_days').default(0).notNull(),
  scheduledDays: integer('scheduled_days').default(0).notNull(),
  lastReview: integer('last_review', { mode: 'timestamp' }),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});
