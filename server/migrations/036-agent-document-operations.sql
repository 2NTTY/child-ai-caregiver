-- A committed document receipt belongs to its original scoped run, without copying bodies.
ALTER TABLE family_document_operations ADD CONSTRAINT family_document_operations_agent_scope
  UNIQUE(user_id,op_id,child_id);
CREATE TABLE agent_document_operations (
  run_id uuid NOT NULL,
  child_id uuid NOT NULL,
  owner_user_id text NOT NULL,
  op_id uuid NOT NULL,
  tool_name text NOT NULL CHECK(tool_name IN ('generate_family_document','change_family_document')),
  PRIMARY KEY(owner_user_id,op_id),
  UNIQUE(run_id,op_id),
  FOREIGN KEY(run_id,child_id,owner_user_id)
    REFERENCES agent_runs(id,child_id,owner_user_id) ON DELETE CASCADE,
  FOREIGN KEY(owner_user_id,op_id,child_id)
    REFERENCES family_document_operations(user_id,op_id,child_id) ON DELETE CASCADE
);
