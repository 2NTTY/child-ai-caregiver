ALTER TABLE text_records ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE text_records ADD COLUMN details_encrypted text;
ALTER TABLE text_records ADD COLUMN confirmed_by text REFERENCES "user"(id);
ALTER TABLE text_records ADD COLUMN confirmed_at timestamptz;
ALTER TABLE children ADD COLUMN profile_version integer NOT NULL DEFAULT 0 CHECK (profile_version >= 0);

CREATE TABLE text_record_revisions (
  record_id uuid NOT NULL REFERENCES text_records(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  payload_encrypted text NOT NULL,
  PRIMARY KEY(record_id, version)
);
CREATE TABLE child_profile_revisions (
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  payload_encrypted text NOT NULL,
  PRIMARY KEY(child_id, version)
);
CREATE TABLE deleted_records (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  version integer NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX text_records_timeline ON text_records(child_id, created_at DESC, id DESC);
