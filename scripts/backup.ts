import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "../apps/api/src/config.ts";

const run = promisify(execFile),
  config = await loadConfig();
if (!process.argv.includes("--quiesced"))
  throw new Error(
    "Stop API and workers, then pass --quiesced to take one consistent database/identity backup",
  );
const destination = process.argv.find((argument) => argument.startsWith("--directory="))?.slice(12);
if (!destination) throw new Error("Pass --directory=/private/new-backup-directory");
const directory = resolve(destination);
await mkdir(directory, { mode: 0o700 });
const url = new URL(process.env.BACKUP_DATABASE_URL ?? config.databaseUrl),
  env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
  };
await run("pg_dump", ["--format=custom", "--file", join(directory, "database.dump")], { env });
await run("tar", [
  "--create",
  "--gzip",
  "--file",
  join(directory, "identity.tar.gz"),
  "--directory",
  config.stateDirectory ?? ".local/control-plane",
  ".",
]);
const files = Object.fromEntries(
  await Promise.all(
    ["database.dump", "identity.tar.gz"].map(async (name) => {
      await chmod(join(directory, name), 0o600);
      return [
        name,
        createHash("sha256")
          .update(await readFile(join(directory, name)))
          .digest("hex"),
      ];
    }),
  ),
);
await writeFile(
  join(directory, "manifest.json"),
  `${JSON.stringify({ format: "agents-assemble.backup/1", createdAt: new Date().toISOString(), deploymentId: config.deploymentId, schemaVersion: 1, files }, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`Backup saved in ${directory}\n`);
