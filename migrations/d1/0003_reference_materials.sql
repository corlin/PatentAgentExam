-- Create reference_materials table for storing chunked textbook content
CREATE TABLE reference_materials (
    id TEXT PRIMARY KEY,
    source_file TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for querying chunks by file
CREATE INDEX idx_ref_source ON reference_materials(source_file);
