import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { generateInventory } from "./inventory.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageSchema = z.object({ name: z.string(), version: z.string(), license: z.string() });
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const legalFile = /^(?:licen[cs]e|copying|notice|copyright(?:notice)?|authors)(?:[._-].*)?$/i;
const licenseFile = /^(?:licen[cs]e|copying)(?:[._-].*)?$/i;
const fallback = {
  name: "react-remove-scroll-bar",
  version: "2.3.8",
  license: "MIT",
  file: "scripts/license-sources/react-remove-scroll-bar-2.3.8.LICENSE.txt",
  source:
    "https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE",
  sha256: "a79aae0c0f21990d9d963bb3c5a79cdcea9a46f8523ba55c58d7fe776b6ebc84",
};

/** Offline, conservative coverage of installed production packages and emitted Tailwind CSS.
 * Bundler inputs additionally prevent an embedded development dependency from losing its terms. */
export async function writeDistributionLicenses(
  outputDirectory: string,
  bundledInputs: string[] = [],
) {
  const inventory = await generateInventory(root);
  const lock = z
    .object({
      packages: z.record(
        z.string(),
        z
          .object({
            name: z.string().optional(),
            version: z.string().optional(),
            license: z.string().optional(),
            integrity: z.string().optional(),
            resolved: z.string().optional(),
            dev: z.boolean().optional(),
            optional: z.boolean().optional(),
            link: z.boolean().optional(),
          })
          .passthrough(),
      ),
    })
    .parse(JSON.parse(await readFile(join(root, "package-lock.json"), "utf8")));
  const allPackages = Object.entries(lock.packages).filter(
    ([path, value]) => path.includes("node_modules/") && !value.link,
  );
  const embedded = new Set<string>();
  for (const input of bundledInputs) {
    const path = relative(root, resolve(input)).split(sep).join("/");
    if (!path.includes("node_modules/")) continue;
    const owner = allPackages
      .filter(([candidate]) => path.startsWith(`${candidate}/`))
      .sort(([a], [b]) => b.length - a.length)[0];
    if (!owner) throw new Error(`bundled_dependency_not_locked:${path}`);
    embedded.add(owner[0]);
  }
  const selected = allPackages
    .filter(
      ([path, value]) => !value.dev || path === "node_modules/tailwindcss" || embedded.has(path),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  const texts = new Map<string, { content: string; packages: Set<string> }>();
  const covered: {
    name: string;
    version: string;
    paths: string[];
    license: string;
    integrity: string | null;
    source: string | null;
    files: { path: string; sha256: string; source?: string }[];
  }[] = [];
  const omittedOptional: string[] = [];
  for (const [path, expected] of selected) {
    let bytes: string;
    try {
      bytes = await readFile(join(root, path, "package.json"), "utf8");
    } catch (error) {
      if (
        expected.optional &&
        !embedded.has(path) &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        omittedOptional.push(path);
        continue;
      }
      throw error;
    }
    const installed = packageSchema.parse(JSON.parse(bytes));
    if (
      installed.name !== (expected.name ?? path.split("node_modules/").at(-1)) ||
      installed.version !== expected.version ||
      installed.license !== expected.license
    )
      throw new Error(`installed_dependency_differs_from_lock:${path}`);
    const prior = covered.find(
      (entry) =>
        entry.name === installed.name &&
        entry.version === installed.version &&
        entry.integrity === (expected.integrity ?? null),
    );
    if (prior) {
      prior.paths.push(path);
      continue;
    }
    const files: { path: string; content: string; source?: string }[] = [];
    const entries = await readdir(join(root, path), { withFileTypes: true });
    for (const entry of entries
      .filter((entry) => entry.isFile() && legalFile.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name)))
      files.push({
        path: entry.name,
        content: await readFile(join(root, path, entry.name), "utf8"),
      });
    if (!files.some((file) => licenseFile.test(file.path))) {
      const readme = entries.find(
        (entry) => entry.isFile() && /^readme(?:\.md|\.txt)?$/i.test(entry.name),
      );
      const section = readme
        ? (await readFile(join(root, path, readme.name), "utf8")).match(
            /(?:^|\n)#{1,6}\s+licen[cs]e\b[^\n]*\n([\s\S]+)/i,
          )?.[1]
        : undefined;
      if (section && /copyright/i.test(section) && /permission is hereby granted/i.test(section))
        files.push({ path: `${readme?.name}#license`, content: section });
      else if (
        installed.name === fallback.name &&
        installed.version === fallback.version &&
        installed.license === fallback.license
      ) {
        const content = await readFile(join(root, fallback.file), "utf8");
        if (hash(content) !== fallback.sha256) throw new Error("retained_license_digest_mismatch");
        files.push({ path: "LICENSE (retained upstream)", content, source: fallback.source });
      } else throw new Error(`license_text_missing:${installed.name}@${installed.version}`);
    }
    const label = `${installed.name}@${installed.version}`;
    for (const file of files) {
      if (!file.content.trim()) throw new Error(`empty_license_file:${label}/${file.path}`);
      const id = hash(file.content);
      if (!texts.has(id)) texts.set(id, { content: file.content, packages: new Set() });
      texts.get(id)?.packages.add(`${label} — ${file.path}`);
    }
    covered.push({
      ...installed,
      paths: [path],
      integrity: expected.integrity ?? null,
      source: expected.resolved ?? null,
      files: files.map(({ path, content, source }) => ({
        path,
        sha256: hash(content),
        ...(source ? { source } : {}),
      })),
    });
  }
  const header =
    "# Third-party license texts\n\nThis conservative notice collection covers the installed locked production dependencies across the product, Tailwind CSS emitted into the browser output, and additional dependencies identified in bundler inputs. A package listed here is not a claim that every distribution executes or embeds it. Uninstalled optional packages are excluded from this collection. Exact package versions, source integrity, and license-text hashes are in THIRD_PARTY_LICENSES.json. The complete source lock inventory, including development and optional packages, is in docs/distribution/dependencies.json.\n";
  const sections = [...texts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([id, text]) =>
        `\n---\n\n## ${[...text.packages].sort().join(", ")}\n\nSHA-256: ${id}\n\n${text.content}${text.content.endsWith("\n") ? "" : "\n"}`,
    );
  await mkdir(join(outputDirectory, "docs/distribution"), { recursive: true });
  await writeFile(join(outputDirectory, "THIRD_PARTY_LICENSES.txt"), header + sections.join(""));
  await writeFile(
    join(outputDirectory, "THIRD_PARTY_LICENSES.json"),
    `${JSON.stringify({ scope: "installed production dependency superset plus emitted CSS and bundler inputs", lockfileSha256: inventory.lockfileSha256, dependencies: covered, omittedOptional }, null, 2)}\n`,
  );
  await writeFile(
    join(outputDirectory, "docs/distribution/dependencies.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
  for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"])
    await copyFile(join(root, file), join(outputDirectory, file));
  return { packages: covered.length, licenseTexts: texts.size };
}
