import { existsSync } from "node:fs";
import { ContextName } from "@aa/platform/contracts";
import pg from "pg";

export async function migrate(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(2026091320)");
    for (const name of ContextName.options) {
      await client.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='aa_${name}') THEN CREATE ROLE aa_${name} NOLOGIN; END IF; END $$;
        CREATE SCHEMA IF NOT EXISTS ${name};
        REVOKE ALL ON SCHEMA ${name} FROM PUBLIC;
        GRANT USAGE ON SCHEMA ${name} TO aa_${name};
        CREATE TABLE IF NOT EXISTS ${name}.aggregates(
          organization_id uuid NOT NULL,kind text NOT NULL,id uuid NOT NULL,version int NOT NULL CHECK(version>0),data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organization_id,kind,id));
        CREATE TABLE IF NOT EXISTS ${name}.revisions(
          organization_id uuid NOT NULL,kind text NOT NULL,aggregate_id uuid NOT NULL,version int NOT NULL,data jsonb NOT NULL,digest text NOT NULL CHECK(length(digest)=64),
          actor_id text NOT NULL,operation_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organization_id,kind,aggregate_id,version));
        CREATE TABLE IF NOT EXISTS ${name}.idempotency(
          organization_id uuid NOT NULL,operation text NOT NULL,operation_id text NOT NULL,request_digest text NOT NULL,actor_id text NOT NULL,result jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organization_id,operation,operation_id));
        CREATE TABLE IF NOT EXISTS ${name}.outbox(
          id uuid PRIMARY KEY,organization_id uuid NOT NULL,aggregate_id uuid NOT NULL,sequence int NOT NULL CHECK(sequence>0),message jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(organization_id,aggregate_id,sequence));
        CREATE TABLE IF NOT EXISTS ${name}.delivery(
          message_id uuid PRIMARY KEY REFERENCES ${name}.outbox(id),available_at timestamptz NOT NULL DEFAULT clock_timestamp(),attempts int NOT NULL DEFAULT 0,
          delivered_at timestamptz,poison boolean NOT NULL DEFAULT false,last_error text);
        CREATE INDEX IF NOT EXISTS delivery_due ON ${name}.delivery(available_at) WHERE delivered_at IS NULL;
        CREATE TABLE IF NOT EXISTS ${name}.inbox(organization_id uuid NOT NULL,source text NOT NULL,message_id uuid NOT NULL,aggregate_id uuid NOT NULL,sequence int NOT NULL,payload_digest text NOT NULL,processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organization_id,source,message_id),UNIQUE(organization_id,source,aggregate_id,sequence));
        CREATE TABLE IF NOT EXISTS ${name}.inbox_cursor(organization_id uuid NOT NULL,source text NOT NULL,aggregate_id uuid NOT NULL,sequence int NOT NULL,PRIMARY KEY(organization_id,source,aggregate_id));
        CREATE TABLE IF NOT EXISTS ${name}.worker_observation(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),incarnation uuid NOT NULL,last_seen timestamptz NOT NULL);
        CREATE INDEX IF NOT EXISTS aggregates_filter ON ${name}.aggregates USING GIN(data jsonb_path_ops);
        CREATE OR REPLACE FUNCTION ${name}.protect_accepted_records() RETURNS trigger LANGUAGE plpgsql AS $guard$
        DECLARE node record;
        BEGIN
          IF OLD.kind IN ('version','revision','candidate','checkpoint','receipt','component','package_blob','publisher_evidence','runtime_profile','admission-snapshot','consumer-checkpoint-receipt','effect-result-evidence','human-expiry-evidence','deployment-profile','public_candidate','publication','decision','appeal_decision','human-acceptance','launch-grant','output','export_origin','exported_component','fork_source','issue-intent','verified-issue-request','deployment-claim','deployment-receipt','delivery-build') OR (TG_TABLE_SCHEMA='integrations' AND OLD.kind='release') THEN
            RAISE EXCEPTION 'accepted_record_is_immutable';
          END IF;
          IF OLD.kind='assignment' AND (NEW.data-'status'-'native') IS DISTINCT FROM (OLD.data-'status'-'native') THEN RAISE EXCEPTION 'assignment_authority_is_immutable'; END IF;
          IF OLD.kind='conversation' AND (NEW.data-'status') IS DISTINCT FROM (OLD.data-'status') THEN RAISE EXCEPTION 'conversation_command_is_immutable'; END IF;
          IF OLD.kind='run' THEN
            IF OLD.data->'engine'->'output' IS NOT NULL AND NEW.data->'engine'->'output' IS DISTINCT FROM OLD.data->'engine'->'output' THEN RAISE EXCEPTION 'accepted_run_output_is_immutable'; END IF;
            IF OLD.data->'manifest' IS NOT NULL AND NEW.data->'manifest' IS DISTINCT FROM OLD.data->'manifest' THEN RAISE EXCEPTION 'admitted_manifest_is_immutable'; END IF;
            IF OLD.data->'admissionVerdict' IS NOT NULL AND NEW.data->'admissionVerdict' IS DISTINCT FROM OLD.data->'admissionVerdict' THEN RAISE EXCEPTION 'admission_verdict_is_immutable'; END IF;
            IF OLD.data->>'status' IN ('completed','canceled','rejected','superseded','failed') AND NEW.data->>'status' IS DISTINCT FROM OLD.data->>'status' THEN RAISE EXCEPTION 'terminal_verdict_is_immutable'; END IF;
            FOR node IN SELECT key,value FROM jsonb_each(COALESCE(OLD.data->'engine'->'nodes','{}'::jsonb)) LOOP
              IF node.value->>'status'='completed' AND NEW.data->'engine'->'nodes'->node.key IS DISTINCT FROM node.value THEN RAISE EXCEPTION 'accepted_output_is_immutable'; END IF;
            END LOOP;
          END IF;
          IF OLD.kind='permit' AND (NEW.data-'verdict') IS DISTINCT FROM (OLD.data-'verdict') THEN RAISE EXCEPTION 'scope_permit_is_immutable'; END IF;
          IF OLD.kind='release' AND (NEW.data-'status'-'policyGeneration'-'reasonCategory') IS DISTINCT FROM (OLD.data-'status'-'policyGeneration'-'reasonCategory') THEN RAISE EXCEPTION 'public_release_bytes_are_immutable'; END IF;
          RETURN NEW;
        END $guard$;
        DROP TRIGGER IF EXISTS protect_accepted ON ${name}.aggregates;
        CREATE TRIGGER protect_accepted BEFORE UPDATE ON ${name}.aggregates FOR EACH ROW EXECUTE FUNCTION ${name}.protect_accepted_records();
        GRANT SELECT,INSERT,UPDATE ON ${name}.aggregates,${name}.delivery TO aa_${name};
        GRANT SELECT,INSERT,UPDATE ON ${name}.inbox_cursor TO aa_${name};
        GRANT SELECT,INSERT,UPDATE ON ${name}.worker_observation TO aa_${name};
        GRANT SELECT,INSERT ON ${name}.inbox TO aa_${name};
        GRANT SELECT,INSERT ON ${name}.revisions,${name}.idempotency,${name}.outbox TO aa_${name};`);
    }
    if (process.env.APP_DATABASE_PASSWORD) {
      await client.query(
        "DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='aa_control_plane') THEN CREATE ROLE aa_control_plane LOGIN NOINHERIT; END IF; END $$;",
      );
      await client.query(
        `ALTER ROLE aa_control_plane PASSWORD ${pg.escapeLiteral(process.env.APP_DATABASE_PASSWORD)}`,
      );
      for (const context of ContextName.options)
        await client.query(`GRANT aa_${context} TO aa_control_plane`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
if (/migrate\.(ts|mjs)$/.test(process.argv[1] ?? "")) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL for the migration owner");
  await migrate(process.env.DATABASE_URL);
  process.stdout.write("Context schemas migrated\n");
}
