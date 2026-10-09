import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { setupReviewDb } from './fixtures.js';

const token='phase4b-local-service-token-at-least-24-chars';
const headers={authorization:`Bearer ${token}`};
const go=(app:ReturnType<typeof buildApp>,url:string)=>app.inject({method:'GET',url,headers});

async function setup(){
 const cx=await setupReviewDb();
 const ddl=[
  `CREATE TABLE grammar_lessons (
    id TEXT PRIMARY KEY, lesson_number INTEGER NOT NULL,title_ja TEXT NOT NULL,title_vi TEXT NOT NULL,
    theme_ja TEXT,theme_vi TEXT,pattern_range TEXT NOT NULL,pattern_count INTEGER NOT NULL,
    accent_color TEXT NOT NULL,wagara TEXT,inkan_char TEXT,description TEXT NOT NULL,
    sort_order INTEGER NOT NULL,created_at INTEGER NOT NULL)`,
  `CREATE TABLE grammar_patterns (
    id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL,pattern_number INTEGER NOT NULL,
    jlpt_level TEXT NOT NULL,difficulty_score INTEGER NOT NULL,pattern_template TEXT NOT NULL,
    structure_slots TEXT NOT NULL,meaning_vi TEXT NOT NULL,meaning_ja TEXT,usage_note TEXT,
    examples TEXT NOT NULL,verb_types TEXT,related_pattern_ids TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
  `CREATE TABLE grammar_exercises (
    id TEXT PRIMARY KEY,pattern_id TEXT NOT NULL,exercise_type TEXT NOT NULL,
    difficulty INTEGER NOT NULL,sentence_with_cloze TEXT,question TEXT,
    option_a TEXT,option_b TEXT,option_c TEXT,option_d TEXT,correct_option TEXT,
    prompt_text TEXT,answer_text TEXT NOT NULL,alternate_answers TEXT,
    explanation_vi TEXT,explanation_ja TEXT,source_ref TEXT,sort_order INTEGER NOT NULL,created_at INTEGER NOT NULL)`,
  `CREATE TABLE eng_materials (
    id TEXT PRIMARY KEY,type TEXT NOT NULL,title TEXT NOT NULL,publisher TEXT,
    year_published INTEGER,total_tests INTEGER,test_type TEXT NOT NULL,created_at INTEGER NOT NULL)`,
  `CREATE TABLE ielts_sessions (
    id TEXT PRIMARY KEY,material_id TEXT,test_number TEXT,test_type TEXT NOT NULL,
    section TEXT NOT NULL,start_time INTEGER NOT NULL,end_time INTEGER,total_duration_seconds INTEGER,
    raw_score INTEGER,max_score INTEGER,current_score_band REAL,target_score_band REAL,
    session_status TEXT NOT NULL,created_at INTEGER NOT NULL)`,
  `CREATE TABLE ielts_practice_logs (
    id TEXT PRIMARY KEY,session_id TEXT,question_number INTEGER NOT NULL,question_type TEXT,
    user_answer TEXT,correct_answer TEXT,is_correct INTEGER,time_spent_seconds INTEGER,
    submission_text TEXT,audio_url TEXT,criteria_scores TEXT,notes TEXT,created_at INTEGER NOT NULL)`,
  `CREATE TABLE ielts_mistakes (
    id TEXT PRIMARY KEY,log_id TEXT,session_id TEXT,mistake_category TEXT,
    root_cause_analysis TEXT,action_plan_for_improvement TEXT,is_resolved INTEGER,created_at INTEGER NOT NULL)`,
  `CREATE TABLE eng_vocab (
    id TEXT PRIMARY KEY,material_id TEXT,session_id TEXT,log_id TEXT,word TEXT NOT NULL,
    part_of_speech TEXT,phonetic TEXT,primary_meaning TEXT,context_sentence TEXT,
    synonyms TEXT,tags TEXT,fsrs_stability REAL NOT NULL,fsrs_difficulty REAL NOT NULL,
    fsrs_due INTEGER,fsrs_state TEXT NOT NULL,reps INTEGER NOT NULL,lapses INTEGER NOT NULL,
    elapsed_days INTEGER NOT NULL,scheduled_days INTEGER NOT NULL,last_review INTEGER,
    created_at INTEGER NOT NULL,updated_at INTEGER)`,
 ];
 for(const sql of ddl)await cx.client.execute(sql);
 return cx;
}

test('Grammar/IELTS read APIs fail closed without configured staging DB',async()=>{
 const app=buildApp({serviceToken:token});
 try{
  for(const p of ['/api/v1/grammar','/api/v1/grammar/practice',
    '/api/v1/ielts/dashboard','/api/v1/ielts/materials','/api/v1/ielts/sessions']){
   assert.equal((await go(app,p)).statusCode,503,p);
   assert.equal((await app.inject({method:'GET',url:p})).statusCode,401,p);
  }
 }finally{await app.close();}
});

test('Grammar endpoints preserve lesson, pattern and exercise response contracts',async()=>{
 const cx=await setup(),app=buildApp({serviceToken:token,database:cx});
 const timestamp=1800000000;
 try{
  await cx.client.execute({sql:`INSERT INTO grammar_lessons
   (id,lesson_number,title_ja,title_vi,pattern_range,pattern_count,accent_color,description,sort_order,created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,args:['lesson8',8,'第8課','Bài 8','72–80',1,'#1B4268','Learn grammar',0,timestamp]});
  await cx.client.execute({sql:`INSERT INTO grammar_patterns
   (id,lesson_id,pattern_number,jlpt_level,difficulty_score,pattern_template,
    structure_slots,meaning_vi,examples,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
   args:['pattern1','lesson8',72,'N5',2,'A は B です','[]','là B','[]',timestamp,timestamp]});
  await cx.client.execute({sql:`INSERT INTO grammar_exercises
   (id,pattern_id,exercise_type,difficulty,answer_text,alternate_answers,sort_order,created_at)
   VALUES (?,?,?,?,?,?,?,?)`,
   args:['ex1','pattern1','cloze',1,'です','["desu"]',1,timestamp]});
  const index=await go(app,'/api/v1/grammar');
  assert.equal(index.statusCode,200,index.body);
  assert.equal(index.json().lessons.length,1);
  assert.equal(index.json().stats.totalPatterns,1);
  assert.equal(index.json().patterns[0].titleJa,'A は B です');
  const detail=await go(app,'/api/v1/grammar/lesson8');
  assert.equal(detail.statusCode,200,detail.body);
  assert.deepEqual(detail.json().patterns[0].structureSlots,[]);
  const exercises=await go(app,'/api/v1/grammar/practice?lessonId=lesson8&limit=15');
  assert.equal(exercises.statusCode,200,exercises.body);
  assert.deepEqual(exercises.json().exercises[0].alternateAnswers,['desu']);
  assert.equal((await go(app,'/api/v1/grammar/not-found')).statusCode,404);
  assert.equal((await go(app,'/api/v1/grammar/practice?limit=999999')).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/grammar/practice',headers,payload:{}})).statusCode,404);
 }finally{await app.close();await cx.close();}
});

test('IELTS dashboard shows zero real progress instead of legacy invented demo scores',async()=>{
 const cx=await setup(),app=buildApp({serviceToken:token,database:cx});
 try{
  const response=await go(app,'/api/v1/ielts/dashboard');
  assert.equal(response.statusCode,200,response.body);
  const data=response.json().data;
  assert.equal(data.currentBand,0);
  assert.equal(data.totalMistakes,0);
  assert.equal(data.totalVocab,0);
  assert.equal(data.recentSessions.length,0);
  assert.equal(data.hasRecordedProgress,false);
  assert.deepEqual(data.mistakeBreakdown,[]);
  assert.equal((await go(app,'/api/v1/ielts/materials')).json().data.length,0);
  assert.equal((await go(app,'/api/v1/ielts/sessions')).json().data.length,0);
  const after=await cx.client.execute('SELECT COUNT(*) AS n FROM eng_materials');
  assert.equal(Number(after.rows[0].n),0,'read must NOT seed materials');
 }finally{await app.close();await cx.close();}
});

test('IELTS reads recorded sessions and rejects write operations',async()=>{
 const cx=await setup(),app=buildApp({serviceToken:token,database:cx});
 try{
  await cx.client.execute({sql:`INSERT INTO eng_materials
   (id,type,title,test_type,created_at) VALUES (?,?,?,?,?)`,
   args:['book1','book','Cambridge','academic',1800000000]});
  await cx.client.execute({sql:`INSERT INTO ielts_sessions
   (id,material_id,test_number,test_type,section,start_time,raw_score,max_score,
    current_score_band,session_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
   args:['session1','book1','Test 1','academic','Reading',1800000000000,32,40,7.5,'completed',1800000000]});
  const stats=(await go(app,'/api/v1/ielts/dashboard')).json().data;
  assert.equal(stats.currentBand,7.5);
  assert.equal(stats.recentSessions[0].id,'session1');
  const materials=await go(app,'/api/v1/ielts/materials');
  assert.equal(materials.json().data[0].id,'book1');
  const session=await go(app,'/api/v1/ielts/sessions/session1');
  assert.equal(session.statusCode,200,session.body);
  assert.equal(session.json().data.id,'session1');
  assert.equal((await go(app,'/api/v1/ielts/sessions/unknown')).statusCode,404);
  for(const path of ['/api/v1/ielts/sessions','/api/v1/ielts/materials','/api/v1/ielts/vocab']){
   assert.equal((await app.inject({method:'POST',url:path,headers,payload:{}})).statusCode,404);
  }
 }finally{await app.close();await cx.close();}
});
