CREATE TABLE IF NOT EXISTS flow_steps (
  step_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  harness TEXT NOT NULL DEFAULT 'codex',
  model TEXT NOT NULL,
  human_gate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS flows (
  flow_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nodes TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS flow_runs (
  run_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_id TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  current_node_ids TEXT NOT NULL DEFAULT '[]',
  completed_node_ids TEXT NOT NULL DEFAULT '[]',
  attempts TEXT NOT NULL DEFAULT '{}',
  blocked_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_enabled_flows (
  project_id TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  PRIMARY KEY (project_id, flow_id)
);
