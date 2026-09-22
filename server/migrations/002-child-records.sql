CREATE TABLE children (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80 AND display_name ~ '[^[:space:]]'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX children_workspace_created_idx ON children (workspace_id, created_at, id);

CREATE TABLE text_records (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  author_user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 10000 AND text ~ '[^[:space:]]'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX text_records_child_recent_idx ON text_records (child_id, created_at DESC, id DESC);
CREATE INDEX text_records_author_idx ON text_records (author_user_id);
