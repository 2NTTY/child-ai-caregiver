CREATE TABLE memory_facts (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK (visibility IN ('private','family')),
  status text NOT NULL CHECK (status IN ('candidate','confirmed','inactive')),
  version integer NOT NULL CHECK (version > 0),
  source_message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
  source_record_id uuid REFERENCES text_records(id) ON DELETE CASCADE,
  source_record_version integer,
  payload_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'candidate' OR visibility='private'),
  CHECK (NOT (source_message_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CHECK ((source_record_id IS NULL) = (source_record_version IS NULL))
);
CREATE INDEX memory_facts_child ON memory_facts(child_id, created_at, id);
CREATE TABLE memory_fact_revisions (
  fact_id uuid NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  version integer NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private','family')),
  payload_encrypted text NOT NULL,
  PRIMARY KEY(fact_id, version)
);
CREATE TABLE memory_topics (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK (visibility IN ('private','family')),
  status text NOT NULL CHECK (status IN ('pending','answered','snoozed','resolved')),
  version integer NOT NULL CHECK (version > 0),
  reopened_from uuid REFERENCES memory_topics(id) ON DELETE SET NULL,
  payload_encrypted text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_topics_child ON memory_topics(child_id, updated_at, id);
CREATE UNIQUE INDEX memory_topics_reopened_once ON memory_topics(reopened_from) WHERE reopened_from IS NOT NULL;
CREATE TABLE memory_topic_revisions (
  topic_id uuid NOT NULL REFERENCES memory_topics(id) ON DELETE CASCADE,
  version integer NOT NULL,
  payload_encrypted text NOT NULL,
  PRIMARY KEY(topic_id, version)
);
CREATE TABLE conversation_summaries (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  previous_id uuid REFERENCES conversation_summaries(id) ON DELETE SET NULL,
  covered_count integer NOT NULL CHECK (covered_count BETWEEN 1 AND 50),
  invalidated boolean NOT NULL DEFAULT false,
  payload_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(child_id, owner_user_id, version)
);
CREATE TABLE summary_message_coverage (
  message_id uuid PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
  summary_id uuid NOT NULL REFERENCES conversation_summaries(id) ON DELETE CASCADE
);
CREATE INDEX summary_message_coverage_summary ON summary_message_coverage(summary_id);
CREATE TABLE deleted_memories (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('fact','topic')),
  version integer NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
