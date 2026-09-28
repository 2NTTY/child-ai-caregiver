CREATE TABLE photo_attachments (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
  byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 4194304),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  relative_path text NOT NULL UNIQUE CHECK(relative_path = id::text || '.enc'),
  metadata_encrypted text NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','ready')),
  visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  record_id uuid UNIQUE REFERENCES text_records(id) ON DELETE CASCADE,
  extraction_state text NOT NULL DEFAULT 'not_requested' CHECK(extraction_state IN ('not_requested','running','available','failed','unknown')),
  extraction_run_id uuid,
  extraction_expires_at timestamptz,
  extraction_access_version integer,
  extraction_encrypted text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (record_id IS NULL OR visibility='shared'),
  CHECK (state='ready' OR record_id IS NULL)
);
CREATE INDEX photo_child ON photo_attachments(child_id,created_at,id);
CREATE TABLE photo_file_deletions (
  id uuid PRIMARY KEY,
  byte_size integer NOT NULL CHECK(byte_size>0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION queue_photo_file_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO photo_file_deletions(id,byte_size) VALUES(OLD.id,OLD.byte_size) ON CONFLICT DO NOTHING;
  RETURN OLD;
END $$;
CREATE TRIGGER photo_file_deleted AFTER DELETE ON photo_attachments
FOR EACH ROW EXECUTE FUNCTION queue_photo_file_deletion();
