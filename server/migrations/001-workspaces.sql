CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL UNIQUE REFERENCES "user" (id) ON DELETE CASCADE,
  storage_epoch uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
