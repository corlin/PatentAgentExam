-- Migration: Create Question Bank Tables
-- Description: Creates questions, question_options, question_explanations, user_answers, and wrong_questions tables.

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  year INTEGER,
  subject_id TEXT,
  chapter_id TEXT,
  question_type TEXT,
  stem TEXT NOT NULL,
  answer TEXT,
  difficulty TEXT,
  source TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  option_key TEXT,
  option_text TEXT,
  is_correct INTEGER,
  FOREIGN KEY(question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS question_explanations (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  explanation TEXT,
  legal_basis TEXT,
  guideline_basis TEXT,
  common_mistakes TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS user_answers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  user_answer TEXT,
  is_correct INTEGER,
  time_spent INTEGER,
  answered_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS wrong_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  wrong_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  mastered INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(question_id) REFERENCES questions(id)
);
