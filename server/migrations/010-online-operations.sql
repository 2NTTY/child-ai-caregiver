ALTER TABLE workspaces ADD COLUMN change_seq bigint NOT NULL DEFAULT 0 CHECK (change_seq >= 0);

CREATE TABLE online_operations (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  op_id uuid NOT NULL,
  device_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  storage_epoch uuid NOT NULL,
  path text NOT NULL,
  child_id uuid,
  kind text NOT NULL CHECK (kind IN ('children','care','profile','chat','family','preferences')),
  owner_only boolean NOT NULL,
  request_hash_encrypted text NOT NULL,
  result_encrypted text,
  status_code integer NOT NULL CHECK (status_code BETWEEN 200 AND 299),
  change_seq bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, op_id)
);
CREATE INDEX online_operations_child ON online_operations(child_id);

CREATE TABLE online_changes (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  change_seq bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('children','care','profile','chat','family','preferences')),
  child_id uuid,
  private_user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  owner_only boolean NOT NULL DEFAULT false,
  deleted boolean NOT NULL,
  PRIMARY KEY(workspace_id, change_seq)
);

-- Erase copies of business content in receipts with the original data. Keep only
-- operation identifiers and encrypted fingerprints so old creates cannot replay.
CREATE FUNCTION redact_online_child_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE online_operations SET result_encrypted=NULL WHERE child_id=OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER online_child_receipt_deletion BEFORE DELETE ON children
  FOR EACH ROW EXECUTE FUNCTION redact_online_child_receipts();

CREATE FUNCTION redact_online_record_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE online_operations SET result_encrypted=NULL WHERE child_id=OLD.child_id AND kind='care';
  RETURN OLD;
END $$;
CREATE TRIGGER online_record_receipt_deletion BEFORE DELETE ON text_records
  FOR EACH ROW EXECUTE FUNCTION redact_online_record_receipts();

CREATE FUNCTION redact_online_profile_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE online_operations SET result_encrypted=NULL WHERE child_id=OLD.child_id AND kind='profile';
  RETURN OLD;
END $$;
CREATE TRIGGER online_profile_receipt_deletion BEFORE DELETE ON child_profile_revisions
  FOR EACH ROW EXECUTE FUNCTION redact_online_profile_receipts();
