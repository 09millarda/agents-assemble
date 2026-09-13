import { Hono } from "hono";
import { z } from "zod";

export const healthSchema = z.strictObject({
  status: z.literal("ok"),
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
/** A deployed revision returns its immutable artifact identity, independent of request input. */
export function createApp(artifactDigest: string) {
  const health = Object.freeze(healthSchema.parse({ status: "ok", artifactDigest }));
  const app = new Hono();
  app.get("/health", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(healthSchema.parse(health));
  });
  app.notFound((context) => context.json({ error: "not_found" }, 404));
  return app;
}
