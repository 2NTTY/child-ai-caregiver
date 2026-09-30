CREATE TABLE shared_inputs (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('paste','public_source')),
  source_id text,
  payload_encrypted text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  fetch_state text NOT NULL CHECK(fetch_state IN ('not_requested','running','ready','failed','unknown')),
  fetch_run_id uuid,
  fetch_expires_at timestamptz,
  fetch_access_version integer,
  extraction_state text NOT NULL DEFAULT 'not_requested' CHECK(extraction_state IN ('not_requested','running','available','failed','unknown')),
  extraction_run_id uuid,
  extraction_expires_at timestamptz,
  extraction_access_version integer,
  record_id uuid UNIQUE REFERENCES text_records(id) ON DELETE CASCADE,
  confirmation_kind text CHECK(confirmation_kind IN ('reference','family_record')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((kind='paste' AND source_id IS NULL) OR (kind='public_source' AND source_id IS NOT NULL)),
  CHECK((record_id IS NULL)=(confirmation_kind IS NULL))
);
CREATE INDEX shared_input_child ON shared_inputs(child_id,owner_user_id,created_at,id);
