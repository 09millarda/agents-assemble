import { readFileSync, writeFileSync } from "node:fs";
import { generateFactoryOpenApiDocument } from "./factoryApi";

const SPEC_URL = new URL("../../../openapi.json", import.meta.url);

function renderSpec(): string {
  return `${JSON.stringify(generateFactoryOpenApiDocument(), null, 2)}\n`;
}

function readCommittedSpec(): string | null {
  try {
    return readFileSync(SPEC_URL, "utf8");
  } catch {
    return null;
  }
}

const checkOnly = process.argv.includes("--check");
const rendered = renderSpec();
if (checkOnly) {
  if (readCommittedSpec() !== rendered) {
    console.error("openapi.json drift detected. Run `bun run openapi:generate` in apps/api and commit the result.");
    process.exit(1);
  }
  console.log("openapi.json matches the generated document.");
} else {
  writeFileSync(SPEC_URL, rendered);
  console.log("openapi.json regenerated.");
}
