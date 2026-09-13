import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../scripts/migrate.ts";

/** Each process-level fixture owns one random database, never an existing database. */
export function isolatedDatabase() {
  const source = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://agents_assemble:local-development-only@127.0.0.1:55433/agents_assemble_test",
  );
  const name = `aa_fixture_${randomUUID().replaceAll("-", "")}`;
  const target = new URL(source);
  target.pathname = `/${name}`;
  const maintenance = new URL(source);
  maintenance.pathname = "/postgres";
  async function change(create: boolean) {
    const client = new pg.Client({ connectionString: maintenance.toString() });
    await client.connect();
    try {
      await client.query(
        `${create ? "CREATE DATABASE" : "DROP DATABASE"} ${pg.escapeIdentifier(name)}${create ? "" : " WITH (FORCE)"}`,
      );
    } finally {
      await client.end();
    }
  }
  return {
    url: target.toString(),
    async create() {
      await change(true);
      await migrate(target.toString());
    },
    async destroy() {
      await change(false);
    },
  };
}
