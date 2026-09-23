CREATE TABLE ai_daily_usage (
  day date NOT NULL,
  scope_key text NOT NULL,
  attempts integer NOT NULL CHECK (attempts >= 0),
  PRIMARY KEY (day, scope_key)
);

CREATE TABLE ai_attempts (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  model text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','rate_limited','timeout','unavailable','invalid_response','unauthorized')),
  input_tokens bigint CHECK (input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens >= 0),
  cached_tokens bigint CHECK (cached_tokens >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_attempts_user_recent_idx ON ai_attempts (user_id, created_at DESC);