import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function createDatabaseConnection(connectionString: string) {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env (repo root and apps/api) and start postgres with `docker compose up -d postgres`."
    );
  }
  const client = postgres(connectionString);
  return drizzle(client);
}

export type Database = ReturnType<typeof createDatabaseConnection>;
