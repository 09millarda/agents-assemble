import { createHash } from "node:crypto";
import { DomainError } from "@aa/platform/contracts";
import { z } from "zod";

export interface ExternalIdentity {
  subject: string;
  email: string;
  name: string;
  sessionId: string;
  expiresAt: string;
}
export interface ExternalIdentityPort {
  authorization(state: string, verifier: string): string;
  exchange(code: string, verifier: string): Promise<ExternalIdentity>;
  active(subject: string, sessionId: string): Promise<boolean>;
}
export interface WorkosConfig {
  clientId: string;
  apiKey: string;
  redirectUri: string;
  apiBase?: string;
}
export class WorkosIdentity implements ExternalIdentityPort {
  private base: string;
  constructor(private config: WorkosConfig) {
    this.base = config.apiBase ?? "https://api.workos.com";
  }
  authorization(state: string, verifier: string) {
    const url = new URL("/user_management/authorize", this.base);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      provider: "authkit",
      state,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }).toString();
    return url.toString();
  }
  private async request(path: string, body?: unknown) {
    const response = await fetch(`${this.base}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!response.ok)
      throw new DomainError(
        "identity_unavailable",
        "The identity provider could not verify this session",
        401,
        "reconcile",
      );
    return response.json();
  }
  async exchange(code: string, verifier: string): Promise<ExternalIdentity> {
    const value = z
      .object({
        user: z.object({
          id: z.string(),
          email: z.email(),
          email_verified: z.literal(true),
          first_name: z.string().nullable(),
          last_name: z.string().nullable(),
        }),
        access_token: z.string(),
      })
      .parse(
        await this.request("/user_management/authenticate", {
          client_id: this.config.clientId,
          client_secret: this.config.apiKey,
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
        }),
      );
    // These claims come only from the authenticated server-to-server token exchange.
    // Provider tokens never enter the browser or durable application records.
    const claims = z
      .object({ sub: z.string(), sid: z.string(), exp: z.number().int() })
      .parse(
        JSON.parse(Buffer.from(value.access_token.split(".")[1], "base64url").toString("utf8")),
      );
    if (claims.sub !== value.user.id || claims.exp * 1000 <= Date.now())
      throw new DomainError("identity_expired", "Provider authentication expired", 401);
    return {
      subject: value.user.id,
      email: value.user.email.toLowerCase(),
      name:
        [value.user.first_name, value.user.last_name].filter(Boolean).join(" ") || value.user.email,
      sessionId: claims.sid,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
  }
  async active(subject: string, sessionId: string) {
    let after: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ limit: "100", ...(after ? { after } : {}) });
      const value = z
        .object({
          data: z.array(
            z.object({
              id: z.string(),
              user_id: z.string(),
              status: z.string(),
              expires_at: z.iso.datetime(),
            }),
          ),
          list_metadata: z.object({ after: z.string().nullable() }),
        })
        .parse(
          await this.request(
            `/user_management/users/${encodeURIComponent(subject)}/sessions?${query}`,
          ),
        );
      const session = value.data.find((item) => item.id === sessionId && item.user_id === subject);
      if (session)
        return session.status === "active" && Date.parse(session.expires_at) > Date.now();
      if (!value.list_metadata.after) return false;
      if (seen.has(value.list_metadata.after))
        throw new DomainError(
          "identity_unavailable",
          "Provider pagination did not advance",
          503,
          "same_operation",
        );
      after = value.list_metadata.after;
      seen.add(after);
    }
    throw new DomainError(
      "identity_unavailable",
      "Provider session inventory exceeded its bounded read",
      503,
      "same_operation",
    );
  }
}
