import { createPublicKey, verify } from "node:crypto";
import { DomainError } from "@aa/platform/contracts";
import { z } from "zod";

const claimSchema = z
  .object({
    iss: z.string(),
    aud: z.string(),
    exp: z.number().int(),
    nbf: z.number().int().optional(),
    iat: z.number().int(),
    repository_id: z.string(),
    repository_owner_id: z.string(),
    repository: z.string(),
    run_id: z.string().regex(/^\d+$/),
    run_attempt: z.string().regex(/^\d+$/),
    workflow_ref: z.string(),
    workflow_sha: z.string(),
    sha: z.string(),
    ref: z.string(),
  })
  .passthrough();
export type GithubJob = z.infer<typeof claimSchema>;
export class GithubJobIdentity {
  constructor(
    readonly audience = "agents-assemble",
    readonly issuer = "https://token.actions.githubusercontent.com",
    readonly jwksUrl = "https://token.actions.githubusercontent.com/.well-known/jwks",
  ) {}
  async verify(request: Request): Promise<GithubJob> {
    const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
    if (!token || token.length > 32768)
      throw new DomainError(
        "github_job_identity_required",
        "Present a current GitHub Actions OIDC token",
        401,
      );
    try {
      const [headerPart, payloadPart, signature, ...extra] = token.split(".");
      if (extra.length || !signature) throw new Error("invalid_token");
      const header = z
        .object({ alg: z.literal("RS256"), kid: z.string().min(1).max(256) })
        .passthrough()
        .parse(JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")));
      const response = await fetch(this.jwksUrl, {
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("identity_unavailable");
      const jwks = z
        .object({
          keys: z
            .array(
              z
                .object({
                  kty: z.literal("RSA"),
                  kid: z.string(),
                  n: z.string(),
                  e: z.string(),
                  alg: z.literal("RS256").optional(),
                  use: z.literal("sig").optional(),
                })
                .passthrough(),
            )
            .max(32),
        })
        .parse(await response.json());
      const keys = jwks.keys.filter((key) => key.kid === header.kid);
      if (keys.length !== 1) throw new Error("ambiguous_key");
      const key = createPublicKey({ key: keys[0], format: "jwk" });
      if (
        !verify(
          "RSA-SHA256",
          Buffer.from(`${headerPart}.${payloadPart}`),
          key,
          Buffer.from(signature, "base64url"),
        )
      )
        throw new Error("signature_invalid");
      const claims = claimSchema.parse(
          JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")),
        ),
        now = Math.floor(Date.now() / 1000);
      if (
        claims.iss !== this.issuer ||
        claims.aud !== this.audience ||
        claims.exp <= now ||
        claims.iat > now + 30 ||
        (claims.nbf !== undefined && claims.nbf > now + 30) ||
        claims.exp - claims.iat > 3600
      )
        throw new Error("claim_invalid");
      return claims;
    } catch {
      throw new DomainError(
        "github_job_identity_invalid",
        "The signed provider identity or its current scope could not be verified",
        403,
      );
    }
  }
}
