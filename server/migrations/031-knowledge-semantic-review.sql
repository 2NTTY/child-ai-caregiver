-- Semantic review records are append-only; legacy reviewed editions are not relabelled.
CREATE TABLE knowledge_version_reviews (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES knowledge_versions(id),
  version_hash text NOT NULL CHECK (version_hash ~ '^[a-f0-9]{64}$'),
  assessment jsonb NOT NULL,
  assessment_hash text NOT NULL CHECK (assessment_hash ~ '^[a-f0-9]{64}$'),
  operator_alias text NOT NULL,
  watch_revision uuid,
  observation_hash text CHECK (observation_hash IS NULL OR observation_hash ~ '^[a-f0-9]{64}$'),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((assessment->>'decision') IN ('approve','hold'))
);
CREATE INDEX knowledge_version_reviews_version ON knowledge_version_reviews(version_id, reviewed_at DESC, id DESC);
