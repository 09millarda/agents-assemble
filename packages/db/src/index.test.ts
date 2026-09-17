import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getTableName } from "drizzle-orm";
import { createDatabaseConnection, daemons, deviceAuthorizations, workflowRuns, activityTemplates, workflows, projectEnabledWorkflows, projects, resolveMigrationsDir } from "./index";

describe("@factory/db primitives", () => {
  test("exposes the daemon registry and device authorization tables", () => {
    expect(getTableName(daemons)).toBe("daemons");
    expect(getTableName(deviceAuthorizations)).toBe("device_authorizations");
    expect(getTableName(projects)).toBe("projects");
    expect(getTableName(activityTemplates)).toBe("activity_templates");
    expect(getTableName(workflows)).toBe("workflows");
    expect(getTableName(workflowRuns)).toBe("workflow_runs");
    expect(getTableName(projectEnabledWorkflows)).toBe("project_enabled_workflows");
  });

  test("refuses to connect without a connection string", () => {
    expect(() => createDatabaseConnection("")).toThrow("DATABASE_URL is not set");
  });

  test("migrations dir holds the checked-in sql migrations", () => {
    const files = readdirSync(resolveMigrationsDir()).filter((file) => file.endsWith(".sql")).sort();
    expect(files).toEqual(["0000_init.sql", "0001_device_authorizations.sql", "0002_stable_daemon_channel.sql", "0003_projects.sql", "0004_flows.sql", "0005_workflows.sql", "0006_browser_delivery.sql", "0007_reset_legacy_workflows.sql", "0008_workflow_descriptions.sql", "0009_daemon_configuration.sql", "0010_workflow_lifecycle.sql"]);
  });

  test("workflow lifecycle migration preserves definitions without rewriting run snapshots", () => {
    const migrationSql = readFileSync(
      join(resolveMigrationsDir(), "0010_workflow_lifecycle.sql"),
      "utf8",
    ).toLowerCase();

    expect(migrationSql).toContain("update workflows");
    expect(migrationSql).toContain("published");
    expect(migrationSql).not.toContain("update workflow_runs");
  });

  test("daemon diagnostics have no durable log table", () => {
    const migrationSql = readdirSync(resolveMigrationsDir())
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(join(resolveMigrationsDir(), file), "utf8"))
      .join("\n")
      .toLowerCase();

    expect(migrationSql).not.toContain("daemon_logs");
    expect(migrationSql).not.toContain("daemon_log_events");
  });
});
