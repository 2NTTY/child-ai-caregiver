ALTER TABLE workspaces ADD COLUMN access_version integer NOT NULL DEFAULT 1 CHECK (access_version > 0);

CREATE TABLE family_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('caregiver', 'viewer')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX family_members_user ON family_members(user_id, workspace_id);

CREATE TABLE family_invitations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  email_encrypted text NOT NULL,
  role text NOT NULL CHECK (role IN ('caregiver', 'viewer')),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_by text REFERENCES "user"(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE INDEX family_invitations_workspace ON family_invitations(workspace_id, created_at DESC);

CREATE TABLE notification_preferences (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  preferences_encrypted text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
