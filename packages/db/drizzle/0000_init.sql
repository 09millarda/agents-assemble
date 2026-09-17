CREATE TABLE IF NOT EXISTS daemons (
  daemon_id TEXT PRIMARY KEY,
  machine_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  auth_token_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

