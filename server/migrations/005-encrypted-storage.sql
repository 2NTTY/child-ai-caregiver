-- Legacy plaintext remains only until the explicit, transactional data upgrade.
ALTER TABLE children ALTER COLUMN display_name DROP NOT NULL;
ALTER TABLE children ADD COLUMN display_name_encrypted text;
ALTER TABLE text_records ALTER COLUMN text DROP NOT NULL;
ALTER TABLE text_records ADD COLUMN text_encrypted text;
ALTER TABLE chat_messages ALTER COLUMN text DROP NOT NULL;
ALTER TABLE chat_messages ADD COLUMN text_encrypted text;
CREATE TABLE storage_security (
  id integer PRIMARY KEY CHECK (id = 1),
  version integer NOT NULL CHECK (version = 1),
  key_check text NOT NULL,
  encrypted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE deleted_children (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
