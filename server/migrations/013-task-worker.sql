CREATE TABLE worker_control (
  id integer PRIMARY KEY CHECK (id=1),
  generation uuid NOT NULL DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO worker_control(id) VALUES(1);

CREATE TABLE task_work (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES care_tasks(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL REFERENCES task_occurrences(id) ON DELETE CASCADE,
  task_version integer NOT NULL CHECK (task_version>0),
  storage_epoch uuid NOT NULL,
  worker_generation uuid NOT NULL,
  job_id uuid NOT NULL,
  run_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','processed','stopped','failed','unknown')),
  failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 3),
  job_failures_base integer NOT NULL DEFAULT 0 CHECK (job_failures_base BETWEEN 0 AND 2),
  payload_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id,task_version)
);
CREATE INDEX task_work_pending ON task_work(run_at,id) WHERE status='pending';

-- One ordinary inbox digest per recipient/local day, shared across child scopes.
-- Sealing freezes a future external delivery snapshot; it never means read/done.
CREATE TABLE task_reminder_batches (
  id uuid PRIMARY KEY,
  recipient_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('ordinary','appointment')),
  batch_key text NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','sealed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipient_user_id,category,batch_key)
);
CREATE TABLE task_reminders (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES task_reminder_batches(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES care_tasks(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL REFERENCES task_occurrences(id) ON DELETE CASCADE,
  task_version integer NOT NULL CHECK (task_version>0),
  phase text NOT NULL CHECK (phase IN ('initial','follow_up')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(occurrence_id,phase)
);
CREATE INDEX task_reminders_task ON task_reminders(task_id);
