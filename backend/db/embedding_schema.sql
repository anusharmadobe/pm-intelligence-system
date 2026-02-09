-- Embedding schema for semantic search using pgvector
-- Requires: CREATE EXTENSION IF NOT EXISTS vector; (done in migrate.ts)

-- Signal embeddings for semantic search
CREATE TABLE IF NOT EXISTS signal_embeddings (
  signal_id UUID PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
  embedding vector(1536),  -- OpenAI text-embedding-3-large dimension (configurable)
  contextual_summary TEXT,  -- LLM-generated summary used for embedding
  model TEXT NOT NULL DEFAULT 'text-embedding-3-large',
  dimensions INT NOT NULL DEFAULT 1536,
  created_at TIMESTAMP DEFAULT NOW()
);

-- HNSW index for fast approximate nearest neighbor search
-- Using cosine distance (vector_cosine_ops) for semantic similarity
CREATE INDEX IF NOT EXISTS idx_signal_embeddings_hnsw 
ON signal_embeddings USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Index for model-based filtering
CREATE INDEX IF NOT EXISTS idx_signal_embeddings_model ON signal_embeddings(model);

-- Index for temporal queries on embeddings
CREATE INDEX IF NOT EXISTS idx_signal_embeddings_created ON signal_embeddings(created_at);

-- Theme embeddings for theme similarity search
CREATE TABLE IF NOT EXISTS theme_embeddings (
  theme_id UUID PRIMARY KEY,
  theme_name TEXT NOT NULL,
  embedding vector(1536),
  model TEXT NOT NULL DEFAULT 'text-embedding-3-large',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_theme_embeddings_hnsw 
ON theme_embeddings USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Customer embeddings for customer-based semantic search
CREATE TABLE IF NOT EXISTS customer_embeddings (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  embedding vector(1536),
  description_used TEXT,  -- Description text used to generate embedding
  model TEXT NOT NULL DEFAULT 'text-embedding-3-large',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_embeddings_hnsw 
ON customer_embeddings USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Embedding generation queue for async processing
CREATE TABLE IF NOT EXISTS embedding_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,  -- 'signal', 'theme', 'customer'
  entity_id UUID NOT NULL,
  priority INT NOT NULL DEFAULT 5,  -- 1 = highest, 10 = lowest
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, completed, failed
  attempts INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_embedding_queue_status ON embedding_queue(status);
CREATE INDEX IF NOT EXISTS idx_embedding_queue_priority ON embedding_queue(priority, created_at);
CREATE INDEX IF NOT EXISTS idx_embedding_queue_entity ON embedding_queue(entity_type, entity_id);

-- Function to get similar signals using vector similarity
CREATE OR REPLACE FUNCTION find_similar_signals(
  query_embedding vector(1536),
  limit_count INT DEFAULT 10,
  min_similarity FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  signal_id UUID,
  similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT 
    se.signal_id,
    (1 - (se.embedding <=> query_embedding))::FLOAT as similarity
  FROM signal_embeddings se
  WHERE (1 - (se.embedding <=> query_embedding)) >= min_similarity
  ORDER BY se.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$;

-- Function to find semantically similar signals to a given signal
CREATE OR REPLACE FUNCTION find_signals_similar_to(
  source_signal_id UUID,
  limit_count INT DEFAULT 10,
  min_similarity FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  signal_id UUID,
  similarity FLOAT
)
LANGUAGE plpgsql AS $$
DECLARE
  source_embedding vector(1536);
BEGIN
  -- Get the embedding of the source signal
  SELECT embedding INTO source_embedding
  FROM signal_embeddings
  WHERE signal_embeddings.signal_id = source_signal_id;
  
  IF source_embedding IS NULL THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    se.signal_id,
    (1 - (se.embedding <=> source_embedding))::FLOAT as similarity
  FROM signal_embeddings se
  WHERE se.signal_id != source_signal_id
    AND (1 - (se.embedding <=> source_embedding)) >= min_similarity
  ORDER BY se.embedding <=> source_embedding
  LIMIT limit_count;
END;
$$;
