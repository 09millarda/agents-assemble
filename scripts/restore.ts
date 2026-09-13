import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { newId } from "@aa/platform/crypto";
import pg from "pg";
import { z } from "zod";
import { createApplication } from "../apps/api/src/app.ts";
import { migrate } from "./migrate.ts";

const run = promisify(execFile);
const directory = resolve(z.string().min(1).parse(process.env.BACKUP_DIRECTORY)),
  databaseUrl = z.url().parse(process.env.RESTORE_DATABASE_URL),
  stateDirectory = resolve(z.string().min(1).parse(process.env.RESTORE_STATE_DIRECTORY));
const manifest = z
  .strictObject({
    format: z.literal("agents-assemble.backup/1"),
    createdAt: z.iso.datetime(),
    deploymentId: z.string(),
    schemaVersion: z.literal(1),
    files: z.strictObject({ "database.dump": z.string(), "identity.tar.gz": z.string() }),
  })
  .parse(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
for (const [name, expected] of Object.entries(manifest.files))
  if (
    createHash("sha256")
      .update(await readFile(join(directory, name)))
      .digest("hex") !== expected
  )
    throw new Error(`Backup integrity failed: ${name}`);
const target = new URL(databaseUrl),
  name = decodeURIComponent(target.pathname.slice(1));
if (!/^[a-z][a-z0-9_]{0,62}$/.test(name) || ["postgres", "template0", "template1"].includes(name))
  throw new Error("Restore requires a new explicitly named database");
const maintenance = new URL(databaseUrl);
maintenance.pathname = "/postgres";
const owner = new pg.Client({ connectionString: maintenance.toString() });
await owner.connect();
try {
  if ((await owner.query("SELECT 1 FROM pg_database WHERE datname=$1", [name])).rowCount)
    throw new Error(
      "Destination database already exists; restore never overwrites a live database",
    );
  try {
    await mkdir(stateDirectory, { mode: 0o700 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST")
      throw new Error(
        "Destination state directory already exists; restore never overwrites identity",
      );
    throw error;
  }
  await owner.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
} finally {
  await owner.end();
}
const env = {
  ...process.env,
  PGHOST: target.hostname,
  PGPORT: target.port || "5432",
  PGUSER: decodeURIComponent(target.username),
  PGPASSWORD: decodeURIComponent(target.password),
  PGDATABASE: name,
};
await run(
  "pg_restore",
  ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", name, join(directory, "database.dump")],
  { env },
);
// Restore schema, data, then constraints in archive dependency order. Loading only
// data into migrated tables can restore delivery rows before their outbox parents.
await migrate(databaseUrl);
// Archives are created by this operator tool, verified above, and extracted only
// into a newly created empty directory. Restores never target running state.
await run("tar", [
  "--extract",
  "--gzip",
  "--file",
  join(directory, "identity.tar.gz"),
  "--directory",
  stateDirectory,
  "--no-same-owner",
  "--no-same-permissions",
]);
const application = await createApplication({
  databaseUrl,
  stateDirectory,
  sessionKey: await readFile(join(stateDirectory, "session.key"), "utf8"),
  deploymentId: manifest.deploymentId,
});
try {
  const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  for (const org of await application.access.organizations())
    await application.execution.fenceRestore(
      org.id,
      { createdAt: manifest.createdAt, digest },
      newId(),
    );
} finally {
  await application.close();
}
process.stdout.write(
  "Restored into a new database and identity directory. Active runs are fenced for explicit reconciliation; no external effect was reissued.\n",
);
