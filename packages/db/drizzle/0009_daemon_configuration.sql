ALTER TABLE daemons ADD COLUMN display_name TEXT;
UPDATE daemons SET display_name = machine_name WHERE display_name IS NULL;
ALTER TABLE daemons ALTER COLUMN display_name SET NOT NULL;

ALTER TABLE daemons ADD COLUMN max_parallel_harnesses INTEGER NOT NULL DEFAULT 1;
ALTER TABLE daemons ADD CONSTRAINT daemon_harness_capacity_range
  CHECK (max_parallel_harnesses BETWEEN 1 AND 10);

ALTER TABLE daemons ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE daemons ADD COLUMN configuration_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE daemons ADD CONSTRAINT daemon_configuration_revision_positive
  CHECK (configuration_revision > 0);
ALTER TABLE daemons ADD COLUMN applied_configuration JSONB;
ALTER TABLE daemons ADD COLUMN applied_configuration_revision INTEGER;
ALTER TABLE daemons ADD CONSTRAINT daemon_applied_configuration_revision_valid
  CHECK (
    applied_configuration_revision IS NULL OR
    (applied_configuration_revision > 0 AND applied_configuration_revision <= configuration_revision)
  );
ALTER TABLE daemons ADD COLUMN configuration_apply_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE daemons ADD CONSTRAINT daemon_configuration_apply_status_known
  CHECK (configuration_apply_status IN ('pending', 'applied', 'failed'));
ALTER TABLE daemons ADD COLUMN configuration_failure_reason TEXT;
ALTER TABLE daemons ADD COLUMN runtime_facts JSONB;
