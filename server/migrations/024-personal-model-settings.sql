CREATE TABLE model_settings (
  user_id text PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  mode text NOT NULL DEFAULT 'platform' CHECK (mode IN ('platform','personal','disabled')),
  background_enabled boolean NOT NULL DEFAULT false,
  personal_daily_limit integer NOT NULL DEFAULT 100 CHECK (personal_daily_limit BETWEEN 1 AND 1000),
  max_model_calls integer NOT NULL DEFAULT 4 CHECK (max_model_calls BETWEEN 1 AND 12),
  max_query_embeddings integer NOT NULL DEFAULT 2 CHECK (max_query_embeddings BETWEEN 1 AND 6),
  api_key_encrypted text CHECK (api_key_encrypted IS NULL OR api_key_encrypted LIKE 'yb1.%'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (mode <> 'personal' OR api_key_encrypted IS NOT NULL),
  CHECK (NOT background_enabled OR mode = 'personal')
);

ALTER TABLE ai_attempts ADD COLUMN billing_source text NOT NULL DEFAULT 'platform'
  CHECK (billing_source IN ('platform','personal'));
ALTER TABLE embedding_attempts ADD COLUMN billing_source text NOT NULL DEFAULT 'platform'
  CHECK (billing_source IN ('platform','personal'));
ALTER TABLE embedding_attempts ADD CONSTRAINT embedding_attempts_corpus_platform
  CHECK (kind <> 'corpus_maintenance' OR billing_source = 'platform');
