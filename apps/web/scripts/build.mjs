import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { writeDistributionLicenses } from "../../../scripts/licenses.ts";

const result = await build();
const inputs = new Set();
for (const bundle of Array.isArray(result) ? result : [result]) {
  if (!("output" in bundle)) throw new Error("web_build_output_unavailable");
  for (const output of bundle.output)
    if (output.type === "chunk")
      for (const id of Object.keys(output.modules)) {
        if (id.startsWith("\0vite/"))
          inputs.add(fileURLToPath(import.meta.resolve("vite/package.json")));
        else if (!id.startsWith("\0")) inputs.add(resolve(id.split("?")[0]));
      }
}
await writeDistributionLicenses(resolve("dist"), [...inputs]);
