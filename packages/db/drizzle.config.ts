import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig } from "drizzle-kit";

function loadDotEnvUpwards(startDir: string = process.cwd()): void {
  let directory = startDir;
  while (true) {
    const candidate = join(directory, ".env");
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) {
          continue;
        }
        const separator = trimmed.indexOf("=");
        if (separator === -1) {
          continue;
        }
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (key.length > 0) {
          process.env[key] ??= value;
        }
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

loadDotEnvUpwards();

export default defineConfig({
  schema: "./src/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
