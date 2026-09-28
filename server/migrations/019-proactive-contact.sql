-- Exact task/version grants and recipient-owned consent are separate authorities.
CREATE TABLE contact_consents (
 child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0),
 payload_encrypted text NOT NULL,
 PRIMARY KEY(child_id,user_id)
);
CREATE TABLE contact_consent_revisions (
 child_id uuid NOT NULL,user_id text NOT NULL,version integer NOT NULL,payload_encrypted text NOT NULL,
 PRIMARY KEY(child_id,user_id,version),
 FOREIGN KEY(child_id,user_id) REFERENCES contact_consents(child_id,user_id) ON DELETE CASCADE
);
CREATE TABLE contact_grants (
 task_id uuid PRIMARY KEY REFERENCES care_tasks(id) ON DELETE CASCADE,
 child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0),
 payload_encrypted text NOT NULL
);
CREATE TABLE contact_grant_revisions (
 task_id uuid NOT NULL REFERENCES contact_grants(task_id) ON DELETE CASCADE,
 version integer NOT NULL,payload_encrypted text NOT NULL,PRIMARY KEY(task_id,version)
);
CREATE TABLE contact_requests (
 id uuid PRIMARY KEY,
 run_id uuid NOT NULL,
 child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 task_id uuid NOT NULL REFERENCES contact_grants(task_id) ON DELETE CASCADE,
 reminder_id uuid NOT NULL UNIQUE REFERENCES task_reminders(id) ON DELETE CASCADE,
 worker_generation uuid NOT NULL,storage_epoch uuid NOT NULL,job_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','accepted','rejected','unknown','stopped','coalesced')),
 reason text,next_at timestamptz NOT NULL,payload_encrypted text NOT NULL,
 grouped_to uuid REFERENCES contact_requests(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE contact_attempts (
 id uuid PRIMARY KEY,request_id uuid NOT NULL REFERENCES contact_requests(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 3),
 recipient_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 channel text NOT NULL CHECK(channel IN ('web_push','telegram')),
 binding_id uuid NOT NULL,binding_version integer NOT NULL CHECK(binding_version>0),
 status text NOT NULL CHECK(status IN ('sending','accepted','rejected','unknown','stopped')),
 reason text,provider_status integer,message_id bigint,bot_id text,
 callback_hash text UNIQUE,callback_encrypted text,
 attempted_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,acknowledged_at timestamptz,
 UNIQUE(request_id,position)
);
CREATE INDEX contact_requests_run ON contact_requests(run_id,child_id);
CREATE INDEX contact_requests_pending ON contact_requests(next_at,id) WHERE state='pending';
-- Keep a consumed daily slot even if its child/request is later deleted.
CREATE TABLE contact_daily_slots (
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 local_day date NOT NULL,request_id uuid REFERENCES contact_requests(id) ON DELETE SET NULL,
 PRIMARY KEY(user_id,local_day)
);
CREATE TABLE contact_updates (
 bot_id text NOT NULL,update_id bigint NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(bot_id,update_id)
);
