ALTER TABLE shared_inputs ADD CONSTRAINT shared_inputs_management_scope UNIQUE(id,child_id,owner_user_id);

CREATE TABLE shared_input_management_revisions (
  input_id uuid NOT NULL,
  child_id uuid NOT NULL,
  owner_user_id text NOT NULL,
  version integer NOT NULL CHECK(version>0),
  payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(input_id,version),
  FOREIGN KEY(input_id,child_id,owner_user_id) REFERENCES shared_inputs(id,child_id,owner_user_id) ON DELETE CASCADE
);
