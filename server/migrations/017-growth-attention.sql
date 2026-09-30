CREATE TABLE growth_attention (
  id uuid PRIMARY KEY, child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  topic_id text NOT NULL, version integer NOT NULL CHECK(version>0),
  state text NOT NULL CHECK(state IN ('proposed','snoozed','accepted','dismissed','inapplicable')),
  payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX growth_attention_child ON growth_attention(child_id,created_at,id);
CREATE UNIQUE INDEX growth_one_active_topic ON growth_attention(child_id,topic_id) WHERE state IN ('proposed','snoozed');
CREATE TABLE growth_revisions (
  attention_id uuid NOT NULL REFERENCES growth_attention(id) ON DELETE CASCADE,
  version integer NOT NULL, payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  PRIMARY KEY(attention_id,version)
);
CREATE TABLE growth_topics (
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE, topic_id text NOT NULL,
  version integer NOT NULL CHECK(version>0), disabled boolean NOT NULL,
  payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  PRIMARY KEY(child_id,topic_id)
);
CREATE TABLE growth_topic_revisions (
  child_id uuid NOT NULL, topic_id text NOT NULL, version integer NOT NULL,
  payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  PRIMARY KEY(child_id,topic_id,version),
  FOREIGN KEY(child_id,topic_id) REFERENCES growth_topics(child_id,topic_id) ON DELETE CASCADE
);
CREATE TABLE growth_checks (
  child_id uuid PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  next_check_at timestamptz, catalog_revision text NOT NULL DEFAULT '',
  last_checked_at timestamptz, failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 3), last_failure_code text
);
INSERT INTO growth_checks(child_id,next_check_at) SELECT id,now() FROM children;
ALTER TABLE online_changes DROP CONSTRAINT online_changes_kind_check;
ALTER TABLE online_changes ADD CONSTRAINT online_changes_kind_check
  CHECK(kind IN ('children','care','profile','chat','family','preferences','memory','tasks','growth'));
-- No private conversation, private memory or background run marks a family check due.
CREATE FUNCTION mark_growth_child_due() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.child_id IS NOT NULL AND NEW.private_user_id IS NULL
     AND NEW.kind IN ('children','care','profile','memory','tasks') THEN
    INSERT INTO growth_checks(child_id,next_check_at)
      SELECT id,now() FROM children WHERE id=NEW.child_id
    ON CONFLICT(child_id) DO UPDATE SET next_check_at=now(),failures=0,last_failure_code=NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER growth_child_due AFTER INSERT ON online_changes FOR EACH ROW EXECUTE FUNCTION mark_growth_child_due();
CREATE FUNCTION mark_growth_sources_due() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE growth_checks SET next_check_at=now(),failures=0,last_failure_code=NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER growth_source_due AFTER UPDATE OF enabled,active_version_id ON knowledge_sources
  FOR EACH ROW WHEN (OLD.enabled IS DISTINCT FROM NEW.enabled OR OLD.active_version_id IS DISTINCT FROM NEW.active_version_id)
  EXECUTE FUNCTION mark_growth_sources_due();
CREATE TRIGGER growth_observation_due AFTER UPDATE OF content_hash,unavailable,approved_version_id ON knowledge_observations
  FOR EACH ROW WHEN (OLD.content_hash IS DISTINCT FROM NEW.content_hash OR OLD.unavailable IS DISTINCT FROM NEW.unavailable OR OLD.approved_version_id IS DISTINCT FROM NEW.approved_version_id)
  EXECUTE FUNCTION mark_growth_sources_due();
CREATE TRIGGER growth_watch_due AFTER UPDATE OF enabled,definition ON knowledge_watches
  FOR EACH ROW WHEN (OLD.enabled IS DISTINCT FROM NEW.enabled OR OLD.definition IS DISTINCT FROM NEW.definition)
  EXECUTE FUNCTION mark_growth_sources_due();

CREATE TRIGGER growth_observation_added AFTER INSERT ON knowledge_observations FOR EACH ROW EXECUTE FUNCTION mark_growth_sources_due();
CREATE TRIGGER growth_watch_added AFTER INSERT ON knowledge_watches FOR EACH ROW EXECUTE FUNCTION mark_growth_sources_due();
