import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = dirname(dirname(fileURLToPath(import.meta.url))),
  output = join(directory, "dist"),
  licensedDependencies = new Set(["hono", "zod"]);
await rm(output, { recursive: true, force: true });
const result = await build({
  absWorkingDir: directory,
  entryPoints: ["handler.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: "dist/handler.mjs",
  legalComments: "linked",
  metafile: true,
});

const bundled = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const normalized = input.split(sep).join("/");
  if (!normalized.includes("node_modules/")) continue;
  const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(normalized);
  if (
    !match ||
    !licensedDependencies.has(match[1]) ||
    normalized.slice(13).includes("node_modules/")
  )
    throw new Error(`Bundled dependency requires an explicit local license entry: ${input}`);
  bundled.add(match[1]);
}

await mkdir(join(output, "licenses"));
for (const name of bundled) {
  const installed = join(directory, "node_modules", name),
    metadata = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  await copyFile(join(installed, "LICENSE"), join(output, "licenses", `${name}-LICENSE`));
  process.stdout.write(`Included complete license: ${name}@${metadata.version}\n`);
}
for (const name of ["LICENSE", "NOTICE"]) await copyFile(join(directory, name), join(output, name));
