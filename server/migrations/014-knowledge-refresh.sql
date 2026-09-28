CREATE TABLE knowledge_watches (
  id text PRIMARY KEY,
  definition jsonb NOT NULL,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  registered_by text NOT NULL,
  terms_checked_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_successful_check_at timestamptz,
  last_status text CHECK (last_status IN ('changed','unchanged','unavailable','failed')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Public source observations are candidates, never published knowledge or family facts.
CREATE TABLE knowledge_observations (
  source_id text PRIMARY KEY,
  watch_id text NOT NULL REFERENCES knowledge_watches(id),
  url text NOT NULL UNIQUE,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  document jsonb NOT NULL,
  fetched_at timestamptz NOT NULL,
  last_successful_check_at timestamptz NOT NULL,
  unavailable boolean NOT NULL DEFAULT false,
  approved_hash text,
  approved_version_id uuid,
  approved_by text,
  approved_at timestamptz,
  FOREIGN KEY (source_id, approved_version_id) REFERENCES knowledge_versions(source_id,id),
  CHECK ((approved_hash IS NULL AND approved_version_id IS NULL AND approved_by IS NULL AND approved_at IS NULL)
    OR (approved_hash IS NOT NULL AND approved_hash ~ '^[a-f0-9]{64}$' AND approved_version_id IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX knowledge_observations_watch ON knowledge_observations(watch_id);

CREATE TABLE knowledge_source_checks (
  job_id uuid PRIMARY KEY,
  watch_id text NOT NULL REFERENCES knowledge_watches(id),
  watch_revision uuid NOT NULL,
  worker_generation uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('changed','unchanged','unavailable','failed','superseded')),
  item_count integer NOT NULL CHECK (item_count BETWEEN 0 AND 50),
  changed_count integer NOT NULL CHECK (changed_count BETWEEN 0 AND item_count),
  failure_code text CHECK (failure_code IN ('network','timeout','response','parse')),
  http_status integer CHECK (http_status IN (404,410)),
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_source_checks_watch ON knowledge_source_checks(watch_id,checked_at DESC);
