-- The migrator holds an advisory lock and executes this entire cutover transactionally.
-- Stop every old API process before applying this migration. ACCESS EXCLUSIVE blocks writes
-- during the verified copy; the dropped relations prevent old processes resuming writes.
LOCK TABLE flows, flow_steps, flow_runs, project_enabled_flows IN ACCESS EXCLUSIVE MODE;
CREATE TABLE retired_workflow_archives (
  source_table TEXT PRIMARY KEY,
  rows JSONB NOT NULL,
  row_count INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);
DO $$
DECLARE source_name TEXT; copied JSONB; original_count INTEGER;
BEGIN
  FOREACH source_name IN ARRAY ARRAY['flows','flow_steps','flow_runs','project_enabled_flows'] LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(source) ORDER BY to_jsonb(source)::text), ''[]''::jsonb), count(*)::integer FROM %I source', source_name) INTO copied, original_count;
    INSERT INTO retired_workflow_archives(source_table, rows, row_count, checksum)
      VALUES (source_name, copied, original_count, md5(copied::text));
    IF NOT EXISTS (SELECT 1 FROM retired_workflow_archives WHERE source_table = source_name
      AND rows = copied AND row_count = original_count AND jsonb_array_length(rows) = original_count
      AND checksum = md5(copied::text)) THEN
      RAISE EXCEPTION 'Archive verification failed for %', source_name;
    END IF;
    UPDATE retired_workflow_archives SET verified_at = NOW() WHERE source_table = source_name;
  END LOOP;
END $$;
DROP TABLE project_enabled_flows, flow_runs, flows, flow_steps;
CREATE TABLE workflows (workflow_id TEXT PRIMARY KEY, definition JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE activity_templates (template_id TEXT PRIMARY KEY, activity JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE project_enabled_workflows (project_id TEXT NOT NULL REFERENCES projects(project_id), workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id), PRIMARY KEY(project_id,workflow_id));
ALTER TABLE projects ADD COLUMN setup_command TEXT;
CREATE TABLE browser_recipients (
  recipient_id TEXT PRIMARY KEY, management_token_hash TEXT NOT NULL,
  subscription JSONB, active BOOLEAN NOT NULL DEFAULT TRUE, delivery_status TEXT NOT NULL DEFAULT 'unenrolled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE workflow_runs (
  run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id), workflow_id TEXT NOT NULL,
  daemon_id TEXT NOT NULL REFERENCES daemons(daemon_id), recipient_id TEXT REFERENCES browser_recipients(recipient_id),
  snapshot JSONB NOT NULL, state JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE workflow_commands (
  command_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(run_id), daemon_id TEXT NOT NULL,
  execution_id TEXT NOT NULL, payload JSONB NOT NULL, received_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX pending_workflow_commands ON workflow_commands(daemon_id,created_at) WHERE received_at IS NULL;
CREATE TABLE workflow_messages (
  message_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(run_id), payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE workflow_documents (
  revision_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(run_id), name TEXT NOT NULL, document_id TEXT NOT NULL,
  execution_id TEXT NOT NULL, activity_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0), content TEXT NOT NULL,
  consumed_revisions JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(run_id,name,revision)
);
CREATE TABLE workflow_notifications (
  notification_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(run_id), recipient_id TEXT REFERENCES browser_recipients(recipient_id),
  payload JSONB NOT NULL, delivery_status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE FUNCTION reject_workflow_snapshot_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN RAISE EXCEPTION 'Workflow run snapshots are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER workflow_snapshot_immutable BEFORE UPDATE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION reject_workflow_snapshot_change();
CREATE FUNCTION reject_immutable_document_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Context document revisions and retired archives are immutable'; END $$;
CREATE TRIGGER workflow_document_immutable BEFORE UPDATE OR DELETE ON workflow_documents FOR EACH ROW EXECUTE FUNCTION reject_immutable_document_change();
CREATE TRIGGER retired_archive_immutable BEFORE UPDATE OR DELETE ON retired_workflow_archives FOR EACH ROW EXECUTE FUNCTION reject_immutable_document_change();
