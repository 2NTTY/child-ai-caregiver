-- Public knowledge is separate from private encrypted business records.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
DO $$ BEGIN
  IF (SELECT extversion FROM pg_extension WHERE extname = 'vector') <> '0.8.6' THEN
    RAISE EXCEPTION 'Unsupported vector extension version';
  END IF;
END $$;
CREATE TABLE knowledge_sources (
  id text PRIMARY KEY,
  url text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  active_version_id uuid,
  disabled_reason text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE knowledge_versions (
  id uuid PRIMARY KEY,
  source_id text NOT NULL REFERENCES knowledge_sources(id),
  version_hash text NOT NULL CHECK (length(version_hash) = 64),
  document jsonb NOT NULL,
  review_state text NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft','reviewed','withdrawn')),
  reviewed_by text,
  checked_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, version_hash),
  UNIQUE (source_id, id),
  CHECK ((review_state <> 'draft') = (reviewed_by IS NOT NULL AND checked_at IS NOT NULL))
);
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_active_version
  FOREIGN KEY (id, active_version_id) REFERENCES knowledge_versions(source_id, id);
CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES knowledge_versions(id),
  section_key text NOT NULL,
  document jsonb NOT NULL,
  content_hash text NOT NULL CHECK (length(content_hash) = 64),
  embedding_hash text NOT NULL CHECK (length(embedding_hash) = 64),
  UNIQUE (version_id, section_key)
);
CREATE INDEX knowledge_chunks_version ON knowledge_chunks(version_id);
CREATE TABLE knowledge_vectors (
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  model text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions = 1024),
  pipeline text NOT NULL,
  embedding vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (input_hash, model, dimensions, pipeline),
  CHECK (vector_norm(embedding) > 0)
);
CREATE TABLE embedding_attempts (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('query_embedding','corpus_maintenance')),
  actor_id text NOT NULL,
  operation_id uuid NOT NULL,
  document_hash text CHECK (document_hash IS NULL OR length(document_hash) = 64),
  model text NOT NULL,
  dimensions integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','unavailable','timeout','invalid_response','invalid_input','unauthorized','cancelled')),
  input_tokens integer CHECK (input_tokens >= 0),
  billable_characters integer CHECK (billable_characters >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
