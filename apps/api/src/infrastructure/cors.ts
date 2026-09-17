import { cors } from "hono/cors";

export function resolveAllowedOrigins(environment: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = (environment.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);
  if (explicit.length > 0) return explicit;

  const origins = ["http://localhost:3000", "http://localhost:3002"];
  const portalUrl = (environment.PORTAL_URL ?? "").trim().replace(/\/+$/, "");
  if (portalUrl.length > 0 && !origins.includes(portalUrl)) origins.push(portalUrl);
  return origins;
}

export function createCorsMiddleware(environment: NodeJS.ProcessEnv = process.env) {
  return cors({
    origin: resolveAllowedOrigins(environment),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  });
}
