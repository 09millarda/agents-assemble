import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createHash } from "node:crypto";

export function resolveMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../drizzle");
}

export function isDatabaseUrlMissing(connectionString: string): boolean {
  return connectionString.trim().length === 0;
}

export function parseDotEnv(contents: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = withoutExport.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = withoutExport.slice(0, separator).trim();
    let value = withoutExport.slice(separator + 1).trim();
    if (value.startsWith("#")) {
      continue;
    }
    const comment = value.search(/\s+#/);
    if (comment !== -1 && !value.startsWith('"') && !value.startsWith("'")) {
      value = value.slice(0, comment).trim();
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) {
      entries.push([key, value]);
    }
  }
  return entries;
}

export function loadDotEnvUpwards(startDir: string = process.cwd()): void {
  let directory = startDir;
  while (true) {
    const candidate = join(directory, ".env");
    if (existsSync(candidate)) {
      for (const [key, value] of parseDotEnv(readFileSync(candidate, "utf8"))) {
        process.env[key] ??= value;
      }
      return;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return;
    }
    directory = parent;
  }
}

export async function runDatabaseMigrations(
  connectionString: string = process.env.DATABASE_URL ?? "",
  migrationsDir: string = resolveMigrationsDir()
): Promise<void> {
  if (isDatabaseUrlMissing(connectionString)) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env (repo root and apps/api) and start postgres with `docker compose up -d postgres`."
    );
  }
  const migrationFiles = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const client = postgres(connectionString);
  try {
    await client.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(781209114)`;
      await transaction`create table if not exists factory_schema_migrations (
        filename text primary key, checksum text not null, applied_at timestamptz not null default now()
      )`;
      for (const file of migrationFiles) {
        const contents = readFileSync(join(migrationsDir, file), "utf8");
        const checksum = createHash("sha256").update(contents).digest("hex");
        const applied = await transaction`select checksum from factory_schema_migrations where filename = ${file}`;
        if (applied[0]) {
          if (applied[0].checksum !== checksum) throw new Error(`Applied migration changed: ${file}`);
          continue;
        }
        await transaction.unsafe(contents);
        await transaction`insert into factory_schema_migrations(filename, checksum) values (${file}, ${checksum})`;
        console.log(`db:migrate applied ${file}`);
      }
    });
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  loadDotEnvUpwards();
  await runDatabaseMigrations();
}
