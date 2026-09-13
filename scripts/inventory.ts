import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type LockPackage = {
  name?: string;
  version?: string;
  license?: string;
  integrity?: string;
  resolved?: string;
  dev?: boolean;
  optional?: boolean;
  link?: boolean;
};
export async function generateInventory(rootDirectory = process.cwd()) {
  const lockfiles = ["package-lock.json", "examples/reference-delivery/package-lock.json"];
  const locks = await Promise.all(
    lockfiles.map(async (path) => {
      const bytes = await readFile(join(rootDirectory, path));
      return {
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        lock: JSON.parse(bytes.toString()) as { packages: Record<string, LockPackage> },
      };
    }),
  );
  const dependencies = locks
    .flatMap(({ path: lockfile, lock }) =>
      Object.entries(lock.packages)
        .filter(([path, item]) => path && !item.link)
        .map(([path, item]) => ({
          path: lockfile === "package-lock.json" ? path : `examples/reference-delivery/${path}`,
          lockfile,
          name: item.name ?? path.split("node_modules/").at(-1) ?? path,
          version: item.version ?? "workspace",
          license: item.license ?? "UNDECLARED",
          integrity: item.integrity ?? null,
          source: item.resolved ?? "workspace",
          development: item.dev ?? false,
          optional: item.optional ?? false,
        })),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  const missing = dependencies.filter((item) => item.license === "UNDECLARED");
  if (missing.length)
    throw new Error(
      `License declarations missing for: ${missing.map((item) => item.path).join(", ")}`,
    );
  const firstPartyFiles = await Promise.all(
    [
      "packages/runner/supervisor/supervisor.py",
      "packages/runner/supervisor/install.py",
      "examples/reference-delivery/app.ts",
      "examples/reference-delivery/handler.ts",
      "examples/reference-delivery/template.yaml",
    ].map(async (path) => ({
      path,
      license: "Apache-2.0",
      sha256: createHash("sha256")
        .update(await readFile(join(rootDirectory, path)))
        .digest("hex"),
    })),
  );
  return {
    lockfileSha256: locks[0].sha256,
    lockfiles: locks.map(({ path, sha256 }) => ({ path, sha256 })),
    dependencies,
    firstPartyFiles,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = await generateInventory();
  await mkdir("docs/distribution", { recursive: true });
  await writeFile("docs/distribution/dependencies.json", `${JSON.stringify(inventory, null, 2)}\n`);
  process.stdout.write(
    `Inventoried ${inventory.dependencies.length} locked components across ${inventory.lockfiles.length} lockfiles and ${inventory.firstPartyFiles.length} first-party distribution files\n`,
  );
}
