CREATE TABLE agent_work (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('active','waiting','completed','cancelled')),
  payload_encrypted text NOT NULL CHECK (payload_encrypted LIKE 'yb1.%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_work_owner_child ON agent_work(owner_user_id,child_id,created_at DESC,id DESC);
CREATE TABLE agent_work_operations (
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  call_id text NOT NULL CHECK (length(call_id) BETWEEN 1 AND 200),
  work_id uuid NOT NULL REFERENCES agent_work(id) ON DELETE CASCADE,
  payload_encrypted text NOT NULL CHECK (payload_encrypted LIKE 'yb1.%'),
  PRIMARY KEY(owner_user_id,child_id,operation_id),
  UNIQUE(run_id,call_id)
);
CREATE TABLE agent_confirmations (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  asking_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  proposal_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES agent_proposals(id) ON DELETE CASCADE,
  proposal_version integer NOT NULL CHECK (proposal_version > 0),
  work_id uuid REFERENCES agent_work(id) ON DELETE CASCADE,
  work_version integer,
  authorization_version bigint NOT NULL,
  storage_epoch text NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version >= 0),
  state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','asked','accepted','invalidated')),
  ask_message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
  response_message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
  payload_encrypted text NOT NULL CHECK (payload_encrypted LIKE 'yb1.%'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asking_run_id,proposal_id,proposal_version),
  CHECK ((work_id IS NULL) = (work_version IS NULL))
);
CREATE INDEX agent_confirmations_pending ON agent_confirmations(owner_user_id,child_id,state);

ALTER TABLE memory_facts ADD COLUMN valid_until timestamptz;
ALTER TABLE memory_facts ADD COLUMN validity_indexed boolean NOT NULL DEFAULT false;
