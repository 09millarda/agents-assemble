import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { writeDistributionLicenses } from "./licenses.ts";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: {
    api: "apps/api/src/main.ts",
    worker: "apps/worker/src/main.ts",
    bootstrap: "scripts/bootstrap.ts",
    migrate: "scripts/migrate.ts",
  },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  legalComments: "linked",
  external: ["pg", "hono", "hono/*", "@hono/*", "zod", "yjs", "ws"],
});
for (const workspace of ["@aa/runner", "@aa/web"]) {
  const result = await new Promise<number | null>((resolve, reject) => {
    const child = spawn("npm", ["run", "build", "--workspace", workspace], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (result !== 0) throw new Error(`Build failed for ${workspace}`);
}
await writeDistributionLicenses("dist");
