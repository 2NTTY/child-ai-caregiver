-- 015 is independently owned by S13-W05; this migration does not require Web Push.
CREATE TABLE agent_runs (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('interactive','worker')),
  trigger_reference uuid NOT NULL,
  source_message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
  authorization_version bigint NOT NULL,
  data_version text NOT NULL,
  recipe_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('running','completed','stopped','unknown')),
  stop_reason text,
  result_encrypted text CHECK (result_encrypted IS NULL OR result_encrypted LIKE 'yb1.%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '90 seconds',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id,child_id,trigger_kind,trigger_reference)
);
CREATE INDEX agent_runs_owner_child ON agent_runs(owner_user_id,child_id,created_at DESC);
CREATE TABLE agent_proposals (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  call_id text NOT NULL CHECK (length(call_id) BETWEEN 1 AND 200),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','dismissed','expired')),
  payload_encrypted text NOT NULL CHECK (payload_encrypted LIKE 'yb1.%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE (run_id,call_id)
);
