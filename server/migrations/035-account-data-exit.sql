-- Erasure receipts deliberately survive native account deletion and contain no plaintext identity or content.
CREATE TABLE account_erasure_journal (
  id integer PRIMARY KEY CHECK(id=1),
  journal_id uuid NOT NULL,
  latest_sequence bigint NOT NULL CHECK(latest_sequence>=0),
  latest_digest text NOT NULL CHECK(latest_digest ~ '^[a-f0-9]{64}$')
);
CREATE TABLE account_erasure_receipts (
  operation_id uuid PRIMARY KEY,
  user_hash text NOT NULL CHECK(user_hash ~ '^[a-f0-9]{64}$'),
  token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','completed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE TABLE account_erasure_applied (
  operation_id uuid PRIMARY KEY,
  journal_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('user','child')),
  target_hash text NOT NULL CHECK(target_hash ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_erasure_photos (
  operation_id uuid NOT NULL,
  photo_id uuid NOT NULL,
  PRIMARY KEY(operation_id,photo_id)
);
ALTER TABLE text_records DROP CONSTRAINT text_records_confirmed_by_fkey;
ALTER TABLE text_records ADD CONSTRAINT text_records_confirmed_by_fkey
  FOREIGN KEY(confirmed_by) REFERENCES "user"(id) ON DELETE SET NULL;
