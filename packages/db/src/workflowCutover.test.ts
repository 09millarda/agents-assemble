import { expect, test } from "bun:test";
import { mkdtempSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { resolveMigrationsDir, runDatabaseMigrations } from "./migrate";

const isolatedDatabaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL;

test.skipIf(!isolatedDatabaseUrl)(
  "archives definitions and history before replacement and never replays retired schema",
  async () => {
    const admin = postgres(isolatedDatabaseUrl!);
    const databaseName = `workflow_cutover_${randomBytes(8).toString("hex")}`;
    await admin.unsafe(`CREATE DATABASE ${databaseName}`);
    const testUrl = new URL(isolatedDatabaseUrl!);
    testUrl.pathname = `/${databaseName}`;
    const sql = postgres(testUrl.toString());
    try {
      const oldMigrations = mkdtempSync(join(tmpdir(), "factory-old-schema-"));
      for (const file of [
        "0000_init.sql",
        "0001_device_authorizations.sql",
        "0002_stable_daemon_channel.sql",
        "0003_projects.sql",
        "0004_flows.sql",
      ]) {
        copyFileSync(
          join(resolveMigrationsDir(), file),
          join(oldMigrations, file),
        );
      }
      await runDatabaseMigrations(testUrl.toString(), oldMigrations);
      await sql`insert into projects(project_id,name,absolute_path) values('kept-project','Kept','/tmp/kept')`;
      await sql`insert into flows(flow_id,name,nodes) values('old-definition','Old definition','[]')`;
      await sql`insert into flow_steps(step_id,name,prompt_template,model) values('old-step','Old step','Plan','model')`;
      await sql`insert into flow_runs(run_id,name,project_id,flow_id) values('old-run','Old run','kept-project','old-definition')`;
      await sql`insert into project_enabled_flows(project_id,flow_id) values('kept-project','old-definition')`;
      await runDatabaseMigrations(testUrl.toString());
      const archived =
        await sql`select source_table, row_count, verified_at is not null as verified from retired_workflow_archives order by source_table`;
      expect([...archived]).toEqual([
        { source_table: "flow_runs", row_count: 1, verified: true },
        { source_table: "flow_steps", row_count: 1, verified: true },
        { source_table: "flows", row_count: 1, verified: true },
        { source_table: "project_enabled_flows", row_count: 1, verified: true },
      ]);
      await runDatabaseMigrations(testUrl.toString());
      expect(
        (await sql`select to_regclass('public.flows') as retired`)[0]?.retired,
      ).toBeNull();
      expect(
        (await sql`select count(*)::int as count from workflow_runs`)[0]?.count,
      ).toBe(0);
      expect(
        (
          await sql`select name from projects where project_id='kept-project'`
        )[0]?.name,
      ).toBe("Kept");
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE ${databaseName}`);
      await admin.end();
    }
  },
);

test.skipIf(!isolatedDatabaseUrl)(
  "resets legacy workflow definitions to an empty editable graph",
  async () => {
    const admin = postgres(isolatedDatabaseUrl!);
    const databaseName = `workflow_reset_${randomBytes(8).toString("hex")}`;
    await admin.unsafe(`CREATE DATABASE ${databaseName}`);
    const testUrl = new URL(isolatedDatabaseUrl!);
    testUrl.pathname = `/${databaseName}`;
    const sql = postgres(testUrl.toString());
    try {
      const currentMigrations = mkdtempSync(join(tmpdir(), "factory-current-schema-"));
      for (const file of [
        "0000_init.sql",
        "0001_device_authorizations.sql",
        "0002_stable_daemon_channel.sql",
        "0003_projects.sql",
        "0004_flows.sql",
        "0005_workflows.sql",
        "0006_browser_delivery.sql",
      ]) {
        copyFileSync(
          join(resolveMigrationsDir(), file),
          join(currentMigrations, file),
        );
      }
      await runDatabaseMigrations(testUrl.toString(), currentMigrations);
      await sql`insert into workflows(workflow_id, definition) values(
        'legacy-build',
        jsonb_build_object(
          'workflowId', 'legacy-build',
          'name', 'Build a feature',
          'loops', '[]'::jsonb,
          'documents', '[]'::jsonb,
          'activities', '[]'::jsonb
        )
      )`;

      const resetMigration = mkdtempSync(join(tmpdir(), "factory-reset-migration-"));
      copyFileSync(
        join(resolveMigrationsDir(), "0007_reset_legacy_workflows.sql"),
        join(resetMigration, "0007_reset_legacy_workflows.sql"),
      );
      copyFileSync(
        join(resolveMigrationsDir(), "0008_workflow_descriptions.sql"),
        join(resetMigration, "0008_workflow_descriptions.sql"),
      );
      await runDatabaseMigrations(testUrl.toString(), resetMigration);

      const [workflow] = await sql`select definition from workflows where workflow_id = 'legacy-build'`;
      expect(workflow?.definition).toEqual({
        workflowId: "legacy-build",
        name: "Build a feature",
        description: "",
        activities: [],
        positions: {},
      });
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE ${databaseName}`);
      await admin.end();
    }
  },
);
