CREATE TABLE IF NOT EXISTS device_authorizations (
  device_code TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  machine_name TEXT NOT NULL,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 5,
  last_polled_at TIMESTAMP,
  daemon_id TEXT,
  auth_token TEXT
);
