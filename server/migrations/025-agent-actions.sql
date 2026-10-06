-- Preauthorization is caller/child scoped; no default grants or plaintext statements.
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_agent_source_scope UNIQUE(id,child_id,owner_user_id);
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_action_scope UNIQUE(id,child_id,owner_user_id);

CREATE TABLE agent_operation_policies (
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0),
 payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
 PRIMARY KEY(user_id,child_id)
);
CREATE TABLE agent_policy_revisions (
 user_id text NOT NULL,child_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
 PRIMARY KEY(user_id,child_id,version),
 FOREIGN KEY(user_id,child_id) REFERENCES agent_operation_policies(user_id,child_id) ON DELETE CASCADE
);
-- Own only the exact grant version created through the ordinary-task policy.
-- A subsequent manual grant supersedes this linkage without extending policy authority.
CREATE TABLE agent_task_authorizations (
 child_id uuid NOT NULL,
 user_id text NOT NULL,
 task_id uuid NOT NULL REFERENCES contact_grants(task_id) ON DELETE CASCADE,
 policy_version integer NOT NULL CHECK(policy_version>0),
 grant_version integer NOT NULL CHECK(grant_version>0),
 PRIMARY KEY(child_id,user_id,task_id),
 FOREIGN KEY(user_id,child_id) REFERENCES agent_operation_policies(user_id,child_id) ON DELETE CASCADE
);
CREATE TABLE agent_manual_operations (
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 storage_epoch uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('policy','delete_note')),
 request_encrypted text NOT NULL CHECK(request_encrypted LIKE 'yb1.%'),
 result_encrypted text NOT NULL CHECK(result_encrypted LIKE 'yb1.%'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE agent_private_notes (
 id uuid PRIMARY KEY,
 child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0),
 source_message_id uuid NOT NULL,
 payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,child_id,owner_user_id),
 FOREIGN KEY(source_message_id,child_id,owner_user_id) REFERENCES chat_messages(id,child_id,owner_user_id) ON DELETE CASCADE
);
CREATE INDEX agent_private_notes_owner_child ON agent_private_notes(owner_user_id,child_id,id);
CREATE TABLE agent_private_note_revisions (
 note_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 source_message_id uuid NOT NULL,
 payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
 PRIMARY KEY(note_id,version),
 FOREIGN KEY(note_id,child_id,owner_user_id) REFERENCES agent_private_notes(id,child_id,owner_user_id) ON DELETE CASCADE,
 FOREIGN KEY(source_message_id,child_id,owner_user_id) REFERENCES chat_messages(id,child_id,owner_user_id) ON DELETE CASCADE
);
CREATE TABLE agent_action_receipts (
 id uuid PRIMARY KEY,run_id uuid NOT NULL,
 child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 source_message_id uuid NOT NULL,
 request_encrypted text NOT NULL CHECK(request_encrypted LIKE 'yb1.%'),
 payload_encrypted text NOT NULL CHECK(payload_encrypted LIKE 'yb1.%'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,run_id),
 FOREIGN KEY(run_id,child_id,owner_user_id) REFERENCES agent_runs(id,child_id,owner_user_id) ON DELETE CASCADE,
 FOREIGN KEY(source_message_id,child_id,owner_user_id) REFERENCES chat_messages(id,child_id,owner_user_id) ON DELETE CASCADE
);
CREATE INDEX agent_action_receipts_run ON agent_action_receipts(run_id,created_at,id);
CREATE TABLE agent_action_calls (
 run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
 call_id text NOT NULL CHECK(length(call_id) BETWEEN 1 AND 200),
 receipt_id uuid NOT NULL,
 PRIMARY KEY(run_id,call_id),
 FOREIGN KEY(receipt_id,run_id) REFERENCES agent_action_receipts(id,run_id) ON DELETE CASCADE
);

-- Cascading source-message cleanup must also discard summaries containing old notes.
CREATE FUNCTION invalidate_agent_note_summaries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE conversation_summaries SET invalidated=true WHERE child_id=OLD.child_id AND owner_user_id=OLD.owner_user_id;
 RETURN OLD;
END $$;
CREATE TRIGGER agent_private_note_summary_deletion BEFORE DELETE ON agent_private_notes
 FOR EACH ROW EXECUTE FUNCTION invalidate_agent_note_summaries();
