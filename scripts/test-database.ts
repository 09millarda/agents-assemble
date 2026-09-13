import pg from "pg";
import { migrate } from "./migrate.ts";
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://agents_assemble:local-development-only@127.0.0.1:55433/agents_assemble_test";
export async function provisionTestDatabase() {
  const target = new URL(testDatabaseUrl),
    database = target.pathname.slice(1);
  if (!/^[a-zA-Z0-9_]+$/.test(database))
    throw new Error("Test database name must contain only ASCII identifiers");
  const owner = new URL(target);
  owner.pathname = "/postgres";
  const client = new pg.Client({ connectionString: owner.toString() });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(2026091321)");
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]);
    if (!result.rowCount) await client.query(`CREATE DATABASE "${database}"`);
  } finally {
    await client.query("SELECT pg_advisory_unlock(2026091321)");
    await client.end();
  }
  await migrate(testDatabaseUrl);
}
export default async function () {
  await provisionTestDatabase();
}
