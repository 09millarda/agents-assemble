CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  daemon_id TEXT,
  git_status TEXT NOT NULL DEFAULT 'unknown',
  blocked_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
