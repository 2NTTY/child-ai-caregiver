CREATE TABLE agent_work_followups (
  work_id uuid PRIMARY KEY REFERENCES agent_work(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  work_version integer NOT NULL CHECK(work_version>0),
  authorization_version bigint NOT NULL, storage_epoch uuid NOT NULL,
  enabled boolean NOT NULL, watch_resources boolean NOT NULL,
  knowledge_source_ids text[] NOT NULL CHECK(cardinality(knowledge_source_ids)<=4),
  due_at timestamptz, due_consumed boolean NOT NULL DEFAULT false, next_check_at timestamptz,
  baseline_encrypted text NOT NULL CHECK(baseline_encrypted LIKE 'yb1.%'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_work_followups_due ON agent_work_followups(next_check_at,work_id) WHERE enabled;
CREATE INDEX agent_work_followups_child ON agent_work_followups(child_id,owner_user_id) WHERE enabled;
CREATE INDEX agent_work_followups_sources ON agent_work_followups USING gin(knowledge_source_ids) WHERE enabled;

-- The daily ledger survives framework job retention and includes cancelled/unknown claims.
CREATE TABLE agent_work_continuations (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  local_day date NOT NULL, authorization_version bigint NOT NULL, storage_epoch uuid NOT NULL,
  worker_generation uuid NOT NULL, job_id uuid NOT NULL UNIQUE,
  state text NOT NULL CHECK(state IN ('queued','completed','stopped','unknown','cancelled')),
  run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id,child_id,local_day)
);
CREATE INDEX agent_work_continuations_queued ON agent_work_continuations(created_at,id) WHERE state='queued';
CREATE TABLE agent_work_continuation_works (
  event_id uuid NOT NULL REFERENCES agent_work_continuations(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES agent_work(id) ON DELETE CASCADE,
  work_version integer NOT NULL CHECK(work_version>0),
  PRIMARY KEY(event_id,work_id)
);
CREATE INDEX agent_work_continuation_works_work ON agent_work_continuation_works(work_id,event_id);
