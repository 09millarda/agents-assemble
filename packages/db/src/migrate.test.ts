import { describe, expect, test } from "bun:test";
import { runDatabaseMigrations } from "./migrate";

describe("runDatabaseMigrations", () => {
  test("refuses to migrate without a connection string", async () => {
    await expect(runDatabaseMigrations("")).rejects.toThrow("DATABASE_URL is not set");
  });
});
