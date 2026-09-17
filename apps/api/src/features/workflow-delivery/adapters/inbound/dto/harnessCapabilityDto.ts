import { z } from "zod";
export const HarnessCapabilitySchema = z.object({
  harness: z.literal("codex"),
  version: z.string(),
  models: z.array(
    z.object({ model: z.string(), efforts: z.array(z.string()) }),
  ),
  questions: z.boolean(),
  permissions: z.boolean(),
  structuredOutput: z.boolean(),
});
