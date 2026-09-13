import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { writeDistributionLicenses } from "../../../scripts/licenses.ts";

const bundle = await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: "dist/cli.js",
  metafile: true,
  legalComments: "linked",
});
await mkdir("dist/supervisor", { recursive: true });
for (const file of ["supervisor.py", "install.py", "README.md"])
  await copyFile(`../../packages/runner/supervisor/${file}`, `dist/supervisor/${file}`);
await writeDistributionLicenses(
  resolve("dist"),
  Object.keys(bundle.metafile.inputs).map((path) => resolve(path)),
);
