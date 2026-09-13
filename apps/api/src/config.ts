import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ApplicationConfig } from "./app.ts";
export async function loadConfig(): Promise<
  ApplicationConfig & { port: number; runnerPort: number; webOrigin: string; listenHost: string }
> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const env = z
    .object({
      DATABASE_URL: z.string().url(),
      LISTEN_HOST: z.string().default("127.0.0.1"),
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      RUNNER_PORT: z.coerce.number().int().min(1).max(65535).default(3443),
      WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
      DEPLOYMENT_ID: z.string().min(1).default("local-agents-assemble"),
      STATE_DIRECTORY: z.string().default(".local/control-plane"),
      RUNNER_HOSTNAME: z.string().default("localhost"),
      PUBLICATION_POLICY: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.enum(["local", "invitation"]).optional(),
      ),
      INVITED_PUBLISHER_ORGANIZATIONS: z
        .string()
        .default("")
        .transform((value) =>
          value
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        )
        .pipe(z.array(z.uuid())),
      WORKOS_CLIENT_ID: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().optional(),
      ),
      WORKOS_API_KEY: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().optional(),
      ),
      WORKOS_REDIRECT_URI: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.url().optional(),
      ),
      GITHUB_TOKEN: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().optional(),
      ),
      GITHUB_WEBHOOK_SECRET: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().min(32).optional(),
      ),
      GITHUB_OIDC_AUDIENCE: z.string().optional(),
    })
    .parse(process.env);
  if (
    [env.WORKOS_CLIENT_ID, env.WORKOS_API_KEY, env.WORKOS_REDIRECT_URI].some(Boolean) &&
    ![env.WORKOS_CLIENT_ID, env.WORKOS_API_KEY, env.WORKOS_REDIRECT_URI].every(Boolean)
  )
    throw new Error("Set all three WorkOS adapter settings");
  const stateDirectory = resolve(env.STATE_DIRECTORY);
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const path = join(stateDirectory, "session.key");
  if (!existsSync(path))
    try {
      await writeFile(path, randomBytes(48).toString("base64url"), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
        throw error;
    }
  return {
    databaseUrl: env.DATABASE_URL,
    publicationPolicy: env.PUBLICATION_POLICY,
    invitedPublisherOrganizations: env.INVITED_PUBLISHER_ORGANIZATIONS,
    ...(env.WORKOS_CLIENT_ID && env.WORKOS_API_KEY && env.WORKOS_REDIRECT_URI
      ? {
          workos: {
            clientId: env.WORKOS_CLIENT_ID,
            apiKey: env.WORKOS_API_KEY,
            redirectUri: env.WORKOS_REDIRECT_URI,
          },
        }
      : {}),
    sessionKey: await readFile(path, "utf8"),
    deploymentId: env.DEPLOYMENT_ID,
    githubToken: env.GITHUB_TOKEN,
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET,
    githubOidcAudience: env.GITHUB_OIDC_AUDIENCE,
    stateDirectory,
    hostname: env.RUNNER_HOSTNAME,
    port: env.PORT,
    listenHost: env.LISTEN_HOST,
    runnerPort: env.RUNNER_PORT,
    webOrigin: env.WEB_ORIGIN,
  };
}
