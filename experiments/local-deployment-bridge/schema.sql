CREATE ROLE aa_execution LOGIN PASSWORD 'throwaway';
  CREATE ROLE aa_integrations LOGIN PASSWORD 'throwaway';
  CREATE SCHEMA execution AUTHORIZATION aa_execution;
  CREATE SCHEMA integrations AUTHORIZATION aa_integrations;
  SET ROLE aa_execution;
  CREATE TABLE execution.environments(id text PRIMARY KEY, owner text, current_release text NOT NULL, generation int NOT NULL DEFAULT 0, hold boolean NOT NULL DEFAULT false);
  CREATE TABLE execution.effects(id text PRIMARY KEY, env text NOT NULL, manifest jsonb NOT NULL, digest text NOT NULL,
    expected_prior text NOT NULL, kind text NOT NULL, parent text, expires_at timestamptz NOT NULL, rollback_until timestamptz NOT NULL,
    revoked boolean NOT NULL DEFAULT false, canceled boolean NOT NULL DEFAULT false, allow_rollback boolean NOT NULL DEFAULT true,
    state text NOT NULL DEFAULT 'approved', claim_run text, claim_attempt int, consumed_at timestamptz, receipt jsonb);
  CREATE TABLE execution.inbox(id text PRIMARY KEY, digest text NOT NULL, payload jsonb NOT NULL, verdict text NOT NULL);
  CREATE TABLE execution.outbox(id text PRIMARY KEY, payload jsonb NOT NULL);
  CREATE TABLE execution.journal(id bigserial PRIMARY KEY, command jsonb NOT NULL, result jsonb NOT NULL);
  RESET ROLE; SET ROLE aa_integrations;
  CREATE TABLE integrations.intents(id text PRIMARY KEY, digest text NOT NULL, state text NOT NULL);
  CREATE TABLE integrations.receipts(id text PRIMARY KEY, payload jsonb NOT NULL);
  CREATE TABLE integrations.outbox(id text PRIMARY KEY, payload jsonb NOT NULL);
  CREATE TABLE integrations.journal(id bigserial PRIMARY KEY, command jsonb NOT NULL, result jsonb NOT NULL);
  RESET ROLE;

SET ROLE aa_execution;
CREATE TABLE execution.dispatches(run_id text PRIMARY KEY,effect text NOT NULL,digest text NOT NULL,workflow_sha text NOT NULL);
ALTER TABLE execution.outbox ADD COLUMN delivered boolean NOT NULL DEFAULT false;
RESET ROLE; SET ROLE aa_integrations;
ALTER TABLE integrations.intents ADD COLUMN manifest jsonb;
ALTER TABLE integrations.intents ADD COLUMN detail jsonb NOT NULL DEFAULT '{}';
ALTER TABLE integrations.outbox ADD COLUMN delivered boolean NOT NULL DEFAULT false;
RESET ROLE;
