CREATE TABLE concerns (
  id uuid PRIMARY KEY, child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0), status text NOT NULL CHECK(status IN ('following','closed')),
  payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  follow_up_id uuid, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE(id,child_id)
);
CREATE INDEX concerns_child ON concerns(child_id,created_at,id);
CREATE TABLE concern_revisions (
  concern_id uuid NOT NULL REFERENCES concerns(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0), payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  PRIMARY KEY(concern_id,version)
);
CREATE TABLE concern_events (
  id uuid PRIMARY KEY, concern_id uuid NOT NULL REFERENCES concerns(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 200), actor_user_id text NOT NULL,
  payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  UNIQUE(concern_id,sequence)
);
CREATE TABLE concern_followups (
  id uuid PRIMARY KEY, concern_id uuid NOT NULL, child_id uuid NOT NULL,
  actor_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  concern_version integer NOT NULL CHECK(concern_version>0),
  due_at timestamptz NOT NULL, state text NOT NULL CHECK(state IN ('pending','queued','completed','stopped','unknown','cancelled')),
  storage_epoch uuid NOT NULL, authorization_version bigint NOT NULL,
  worker_generation uuid, job_id uuid UNIQUE, run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(concern_id,child_id) REFERENCES concerns(id,child_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(id,concern_id)
);
CREATE INDEX concern_followups_due ON concern_followups(due_at,id) WHERE state='pending';
ALTER TABLE concerns ADD CONSTRAINT concerns_current_followup
  FOREIGN KEY(follow_up_id,id) REFERENCES concern_followups(id,concern_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE concern_operations (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, op_id uuid NOT NULL,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE, storage_epoch uuid NOT NULL,
  request_hash_encrypted text NOT NULL CHECK(request_hash_encrypted LIKE 'yb1.%'),
  result_encrypted text NOT NULL CHECK(result_encrypted LIKE 'yb1.%'),
  PRIMARY KEY(user_id,op_id)
);
