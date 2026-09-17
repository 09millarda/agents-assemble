import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { runDatabaseMigrations } from "../migrate";

export async function withIsolatedWorkflowDatabase(
  adminConnectionString: string,
  runTest: (fixture: {
    connectionString: string;
    sql: ReturnType<typeof postgres>;
  }) => Promise<void>,
): Promise<void> {
  const admin = postgres(adminConnectionString);
  const databaseName = "workflow_fixture_" + randomBytes(8).toString("hex");
  const connectionUrl = new URL(adminConnectionString);
  connectionUrl.pathname = "/" + databaseName;
  let sql: ReturnType<typeof postgres> | undefined;
  let created = false;
  try {
    await admin.unsafe(`create database ${databaseName}`);
    created = true;
    const connectionString = connectionUrl.toString();
    await runDatabaseMigrations(connectionString);
    sql = postgres(connectionString);
    await runTest({ connectionString, sql });
  } finally {
    await sql?.end({ timeout: 1 });
    if (created)
      await admin.unsafe(`drop database ${databaseName} with (force)`);
    await admin.end();
  }
}
