-- Migration 014 belongs to the independent, not-yet-merged knowledge refresh package.
CREATE TABLE web_push_subscriptions (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('active','revoked','expired')),
  endpoint_hash text UNIQUE CHECK (endpoint_hash ~ '^[a-f0-9]{64}$'),
  provider text NOT NULL CHECK (provider IN ('fcm','mozilla')),
  vapid_public_key text NOT NULL,
  subscription_encrypted text CHECK (subscription_encrypted LIKE 'yb1.%'),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='active' AND endpoint_hash IS NOT NULL AND subscription_encrypted IS NOT NULL)
    OR (status<>'active' AND endpoint_hash IS NULL AND subscription_encrypted IS NULL))
);
CREATE INDEX web_push_subscriptions_user ON web_push_subscriptions(user_id,created_at DESC);

-- A test notification has explicit per-click consent, no care task or family content.
CREATE TABLE web_push_deliveries (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  subscription_version integer NOT NULL CHECK (subscription_version > 0),
  worker_generation uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','sending','accepted','rejected','unknown','stopped')),
  reason text CHECK (reason IN ('subscription_expired','provider_rejected','rate_limited','transport_unknown','revoked',
    'worker_paused','configuration_unavailable','request_invalid','worker_interrupted')),
  provider_status integer CHECK (provider_status BETWEEN 100 AND 599),
  created_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  finished_at timestamptz,
  CHECK ((status IN ('queued','sending') AND finished_at IS NULL)
    OR (status NOT IN ('queued','sending') AND finished_at IS NOT NULL)),
  CHECK (status <> 'queued' OR attempted_at IS NULL),
  CHECK (status <> 'sending' OR attempted_at IS NOT NULL)
);
CREATE INDEX web_push_deliveries_user ON web_push_deliveries(user_id,created_at DESC);
CREATE INDEX web_push_deliveries_pending ON web_push_deliveries(status) WHERE status IN ('queued','sending');
