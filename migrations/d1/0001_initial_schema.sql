CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  nickname TEXT,
  role TEXT DEFAULT 'user',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT,
  file_url TEXT,
  file_hash TEXT,
  version TEXT,
  authority_level TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER,
  title TEXT,
  text TEXT,
  subject TEXT,
  chapter TEXT,
  knowledge_point_id TEXT,
  source_type TEXT,
  page_start INTEGER,
  page_end INTEGER,
  section_path TEXT,
  vector_id TEXT,
  created_at TEXT,
  FOREIGN KEY(document_id) REFERENCES documents(id)
);

CREATE TABLE exam_subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER
);

CREATE TABLE exam_chapters (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER,
  FOREIGN KEY(subject_id) REFERENCES exam_subjects(id)
);

CREATE TABLE knowledge_points (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  chapter_id TEXT,
  name TEXT NOT NULL,
  aliases TEXT,
  description TEXT,
  importance TEXT,
  difficulty TEXT,
  exam_frequency TEXT,
  sort_order INTEGER,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  year INTEGER,
  subject_id TEXT,
  chapter_id TEXT,
  question_type TEXT,
  stem TEXT NOT NULL,
  answer TEXT,
  difficulty TEXT,
  source TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE question_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  option_key TEXT,
  option_text TEXT,
  is_correct INTEGER,
  FOREIGN KEY(question_id) REFERENCES questions(id)
);

CREATE TABLE question_explanations (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  explanation TEXT,
  legal_basis TEXT,
  guideline_basis TEXT,
  common_mistakes TEXT,
  created_by TEXT,
  created_at TEXT,
  FOREIGN KEY(question_id) REFERENCES questions(id)
);

CREATE TABLE user_answers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  user_answer TEXT,
  is_correct INTEGER,
  time_spent INTEGER,
  answered_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(question_id) REFERENCES questions(id)
);

CREATE TABLE wrong_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  wrong_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  mastered INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
