-- Public metadata only; channel identities and challenge/callback secrets are encrypted.
CREATE TABLE telegram_meta(id integer PRIMARY KEY CHECK(id=1),lookup_key_encrypted text NOT NULL);
CREATE TABLE telegram_challenges(
 id uuid PRIMARY KEY,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 bot_id text NOT NULL,storage_epoch uuid NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 token_hash text NOT NULL UNIQUE,secret_encrypted text NOT NULL,candidate_encrypted text,candidate_hash text,
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','seen','consumed','cancelled')),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_challenges_user ON telegram_challenges(user_id,created_at DESC);
CREATE TABLE telegram_bindings(
 id uuid PRIMARY KEY,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,bot_id text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),status text NOT NULL CHECK(status IN ('active','revoked','blocked')),
 target_hash text,target_encrypted text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='active' AND target_hash IS NOT NULL AND target_encrypted IS NOT NULL)
 OR (status<>'active' AND target_hash IS NULL AND target_encrypted IS NULL))
);
CREATE UNIQUE INDEX telegram_active_user ON telegram_bindings(user_id) WHERE status='active';
CREATE UNIQUE INDEX telegram_active_target ON telegram_bindings(bot_id,target_hash) WHERE status='active';
CREATE TABLE telegram_deliveries(
 id uuid PRIMARY KEY,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 binding_id uuid NOT NULL REFERENCES telegram_bindings(id) ON DELETE CASCADE,binding_version integer NOT NULL,
 bot_id text NOT NULL,storage_epoch uuid NOT NULL,worker_generation uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','accepted','rejected','unknown','stopped')),
 reason text,provider_status integer,message_id bigint,callback_hash text NOT NULL UNIQUE,callback_encrypted text,
 created_at timestamptz NOT NULL DEFAULT now(),attempted_at timestamptz,finished_at timestamptz,acknowledged_at timestamptz
);
CREATE INDEX telegram_deliveries_user ON telegram_deliveries(user_id,created_at DESC);
CREATE TABLE telegram_updates(
 bot_id text NOT NULL,update_id bigint NOT NULL,outcome text NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(bot_id,update_id)
);
