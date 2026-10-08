CREATE TABLE account_invitations (
  id uuid PRIMARY KEY,
  email_hash text NOT NULL CHECK(email_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  consumed_at timestamptz,
  bound_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at>created_at), CHECK(bound_user_id IS NULL OR consumed_at IS NOT NULL)
);
CREATE UNIQUE INDEX account_invitations_unconsumed_email ON account_invitations(email_hash)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX account_invitations_user ON account_invitations(bound_user_id) WHERE bound_user_id IS NOT NULL;

CREATE TABLE account_admissions (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  source text NOT NULL CHECK(source IN ('legacy','invitation')),
  invitation_id uuid UNIQUE REFERENCES account_invitations(id),
  admitted_at timestamptz NOT NULL DEFAULT now(),
  acknowledgement_version text, acknowledged_at timestamptz, acknowledgement_operation_id uuid,
  CHECK((source='legacy' AND invitation_id IS NULL) OR (source='invitation' AND invitation_id IS NOT NULL)),
  CHECK((acknowledgement_version IS NULL AND acknowledged_at IS NULL AND acknowledgement_operation_id IS NULL)
    OR (acknowledgement_version IS NOT NULL AND acknowledged_at IS NOT NULL AND acknowledgement_operation_id IS NOT NULL))
);
-- Preserve existing native identities, while requiring the current service acknowledgement.
INSERT INTO account_admissions(user_id,source) SELECT id,'legacy' FROM "user";

CREATE TABLE auth_mail_outbox (
  id uuid PRIMARY KEY, job_id uuid NOT NULL UNIQUE, worker_generation uuid NOT NULL,
  -- No native-user FK: Better Auth invokes the email hook before its signup transaction commits.
  -- Dispatch always rechecks the committed user; account deletion explicitly purges this table.
  user_id text NOT NULL, email_hash text NOT NULL CHECK(email_hash ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK(kind IN ('verify','reset')),
  state text NOT NULL CHECK(state IN ('queued','sending','accepted','failed','unknown','expired')),
  payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at>created_at)
);
CREATE INDEX auth_mail_outbox_email_rate ON auth_mail_outbox(email_hash,created_at DESC);
CREATE INDEX auth_mail_outbox_user ON auth_mail_outbox(user_id,id);
