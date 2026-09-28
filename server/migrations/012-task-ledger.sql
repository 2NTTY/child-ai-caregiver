CREATE TABLE care_tasks (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  payload_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX care_tasks_child ON care_tasks(child_id,id);

-- P2 starts with one explicitly confirmed occurrence per manual arrangement.
-- Changes keep its identity; delivery attempts do not belong in this table.
CREATE TABLE task_occurrences (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL UNIQUE REFERENCES care_tasks(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('scheduled','completed','cancelled','needs_review')),
  payload_encrypted text NOT NULL
);
CREATE INDEX task_occurrences_due ON task_occurrences(due_at,id) WHERE state='scheduled';
CREATE TABLE task_revisions (
  task_id uuid NOT NULL REFERENCES care_tasks(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  payload_encrypted text NOT NULL,
  PRIMARY KEY(task_id,version)
);

ALTER TABLE online_operations DROP CONSTRAINT online_operations_kind_check;
ALTER TABLE online_operations ADD CONSTRAINT online_operations_kind_check
  CHECK (kind IN ('children','care','profile','chat','family','preferences','memory','tasks'));
ALTER TABLE online_changes DROP CONSTRAINT online_changes_kind_check;
ALTER TABLE online_changes ADD CONSTRAINT online_changes_kind_check
  CHECK (kind IN ('children','care','profile','chat','family','preferences','memory','tasks'));
