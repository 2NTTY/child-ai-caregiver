CREATE TABLE family_documents (
  id uuid PRIMARY KEY, child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0), kind text NOT NULL CHECK(kind IN ('preparation','growth_report')),
  status text NOT NULL CHECK(status IN ('active','archived')), auto_refresh boolean NOT NULL DEFAULT false,
  payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  dirty boolean NOT NULL DEFAULT false, dirty_epoch uuid, dirty_generation uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,child_id)
);
CREATE INDEX family_documents_child ON family_documents(child_id,created_at DESC,id);
CREATE INDEX family_documents_pending ON family_documents(updated_at,id) WHERE dirty AND status='active' AND auto_refresh;
CREATE TABLE family_document_snapshots (
  id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES family_documents(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0), payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  UNIQUE(document_id,version)
);
CREATE TABLE family_document_operations (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, op_id uuid NOT NULL,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE, storage_epoch uuid NOT NULL,
  request_encrypted text NOT NULL CHECK(request_encrypted LIKE 'yb1.%'),
  result_encrypted text NOT NULL CHECK(result_encrypted LIKE 'yb1.%'), PRIMARY KEY(user_id,op_id)
);
ALTER TABLE online_changes DROP CONSTRAINT online_changes_kind_check;
ALTER TABLE online_changes ADD CONSTRAINT online_changes_kind_check
  CHECK(kind IN ('children','care','profile','chat','family','preferences','memory','tasks','growth','documents'));
