/** Trusted workflow entry point. Every mutation has a retained exact operation identity. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { readHealth } from "./health.ts";

const execute = promisify(execFile),
  hex = z.string().regex(/^[a-f0-9]{64}$/),
  sha = z.string().regex(/^[a-f0-9]{40}$/),
  uuid = z.uuid();
const required = (name: string) => z.string().min(1).parse(process.env[name]);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const optionalInput = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
const inputSchema = z.object({
  effect_id: optionalInput(uuid),
  manifest_digest: optionalInput(z.string()),
  artifact_digest: optionalInput(hex),
  environment: optionalInput(z.enum(["staging", "production"])),
  environment_revision: optionalInput(z.string()),
  policy_generation: optionalInput(z.coerce.number().int().positive()),
  source_commit: optionalInput(sha),
  delivery_id: optionalInput(uuid),
  mode: z.enum(["build", "deploy"]).default("deploy"),
});
const event = z
  .object({
    inputs: inputSchema.optional(),
    pull_request: z
      .object({
        merged: z.boolean(),
        merge_commit_sha: sha.nullable(),
        body: z.string().nullable(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const manifestSchema = z.object({
  effectId: uuid,
  manifestDigest: z.string(),
  artifactDigest: hex,
  sourceCommit: sha,
  artifactObject: z.object({ bucket: z.string(), key: z.string(), versionId: z.string() }),
  templateDigest: hex,
  workflow: z
    .object({
      repositoryId: uuid,
      environment: z.enum(["staging", "production"]),
      workflowPath: z.string(),
      workflowRef: z.string(),
      workflowRevision: sha,
      environmentRevision: z.string(),
      expectedStatus: z.number(),
      healthUrl: z.url(),
      accountId: z.string().regex(/^\d{12}$/),
      stackName: z.string(),
      region: z.literal("eu-west-1"),
      policyGeneration: z.number(),
    })
    .passthrough(),
  environmentGeneration: z.number().int().positive(),
  authorityExpiresAt: z.iso.datetime(),
});
let credentials: Record<string, string> = {};
async function command(binary: string, args: string[], options: { cwd?: string } = {}) {
  return (
    await execute(binary, args, {
      ...options,
      env: {
        ...process.env,
        ...credentials,
        AWS_REGION: "eu-west-1",
        AWS_DEFAULT_REGION: "eu-west-1",
        AWS_MAX_ATTEMPTS: "1",
        AWS_PAGER: "",
      },
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    })
  ).stdout;
}
async function aws(args: string[]) {
  const output = await command("aws", [...args, "--output", "json"]);
  return output.trim() ? JSON.parse(output) : null;
}
async function token(audience: string) {
  const url = new URL(required("ACTIONS_ID_TOKEN_REQUEST_URL"));
  url.searchParams.set("audience", audience);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${required("ACTIONS_ID_TOKEN_REQUEST_TOKEN")}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("oidc_identity_unavailable");
  return z.object({ value: z.string() }).parse(await response.json()).value;
}
async function service(path: string, body?: unknown, operationId?: string) {
  const response = await fetch(
    new URL(
      `/api/v1/integrations/github/${path}/${uuid.parse(required("AA_ORGANIZATION_ID"))}`,
      required("AA_SERVICE_URL"),
    ),
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${await token("agents-assemble")}`,
        "content-type": "application/json",
        ...(operationId ? { "idempotency-key": operationId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error(`service_${path}_${response.status}`);
  return response.json();
}
async function manifest(effectId: string) {
  const response = await fetch(
    new URL(
      `/api/v1/integrations/github/manifests/${uuid.parse(required("AA_ORGANIZATION_ID"))}/${effectId}`,
      required("AA_SERVICE_URL"),
    ),
    {
      headers: { authorization: `Bearer ${await token("agents-assemble")}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("claimed_manifest_unavailable");
  return manifestSchema.parse(await response.json());
}
async function awsIdentity(role: string) {
  const path = resolve(".aa-aws-identity.jwt");
  await writeFile(path, await token("sts.amazonaws.com"), { mode: 0o600 });
  try {
    const value = z
      .object({
        Credentials: z.object({
          AccessKeyId: z.string(),
          SecretAccessKey: z.string(),
          SessionToken: z.string(),
        }),
      })
      .parse(
        await aws([
          "sts",
          "assume-role-with-web-identity",
          "--role-arn",
          role,
          "--role-session-name",
          `aa-${required("GITHUB_RUN_ID")}`,
          "--web-identity-token",
          `file://${path}`,
          "--duration-seconds",
          "900",
        ]),
      );
    credentials = {
      AWS_ACCESS_KEY_ID: value.Credentials.AccessKeyId,
      AWS_SECRET_ACCESS_KEY: value.Credentials.SecretAccessKey,
      AWS_SESSION_TOKEN: value.Credentials.SessionToken,
    };
  } finally {
    const { rm } = await import("node:fs/promises");
    await rm(path, { force: true });
  }
}
function finite(deadline: string) {
  if (Date.parse(deadline) - Date.now() < 5000)
    throw new Error("effect_authority_expired_no_new_write");
}
async function dispatchMerged() {
  const value = event.parse(JSON.parse(await readFile(required("GITHUB_EVENT_PATH"), "utf8"))),
    pr = value.pull_request;
  if (!pr?.merged || !pr.merge_commit_sha) return;
  const matches = [
    ...(pr.body ?? "").matchAll(/<!-- agents-assemble:delivery:([a-f0-9-]{36}) -->/g),
  ];
  if (matches.length !== 1) throw new Error("unique_delivery_lineage_required");
  const response = await fetch(
    `https://api.github.com/repos/${required("GITHUB_REPOSITORY")}/actions/workflows/delivery.yml/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${required("GITHUB_TOKEN")}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: required("AA_WORKFLOW_REF"),
        return_run_details: true,
        inputs: {
          mode: "build",
          delivery_id: uuid.parse(matches[0][1]),
          source_commit: pr.merge_commit_sha,
        },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("build_dispatch_outcome_unknown_do_not_retry");
}
async function build(inputs: z.infer<typeof inputSchema>) {
  const source = sha.parse(inputs.source_commit),
    delivery = uuid.parse(inputs.delivery_id),
    cwd = resolve(required("AA_SOURCE_DIRECTORY"), "examples/reference-delivery");
  if ((await command("git", ["rev-parse", "HEAD"], { cwd })).trim() !== source)
    throw new Error("build_source_commit_mismatch");
  await command("npm", ["ci", "--ignore-scripts"], { cwd });
  await command("npm", ["run", "build"], { cwd });
  const template = await readFile(join(cwd, "template.yaml"));
  await writeFile(join(cwd, "dist/template.yaml"), template);
  await command("zip", ["-q", "-X", "-r", resolve("release.zip"), "."], { cwd: join(cwd, "dist") });
  const bytes = await readFile("release.zip"),
    artifactDigest = hash(bytes),
    bucket = required("AA_ARTIFACT_BUCKET"),
    key = `agents-assemble/${delivery}/${source}/${artifactDigest}.zip`;
  await awsIdentity(required("AA_BUILD_ROLE_ARN"));
  const versioning = z
    .object({ Status: z.literal("Enabled") })
    .parse(await aws(["s3api", "get-bucket-versioning", "--bucket", bucket]));
  void versioning;
  const uploaded = z
    .object({ VersionId: z.string().min(1) })
    .parse(
      await aws([
        "s3api",
        "put-object",
        "--bucket",
        bucket,
        "--key",
        key,
        "--body",
        "release.zip",
        "--checksum-algorithm",
        "SHA256",
        "--checksum-sha256",
        Buffer.from(artifactDigest, "hex").toString("base64"),
        "--if-none-match",
        "*",
      ]),
    );
  await service(
    "releases",
    {
      deliveryId: delivery,
      repositoryId: uuid.parse(required("AA_REPOSITORY_ID")),
      commit: source,
      artifactDigest,
      workflowRevision: sha.parse(required("GITHUB_SHA")),
      artifactObject: { bucket, key, versionId: uploaded.VersionId },
      templateDigest: hash(template),
      runId: Number(required("GITHUB_RUN_ID")),
      runAttempt: Number(required("GITHUB_RUN_ATTEMPT")),
    },
    `build-${required("GITHUB_RUN_ID")}-${required("GITHUB_RUN_ATTEMPT")}`,
  );
}
async function deploy(inputs: z.infer<typeof inputSchema>) {
  const effectId = uuid.parse(inputs.effect_id),
    runId = Number(required("GITHUB_RUN_ID")),
    runAttempt = Number(required("GITHUB_RUN_ATTEMPT"));
  await service(
    "claims",
    {
      effectId,
      manifestDigest: z.string().parse(inputs.manifest_digest),
      artifactDigest: hex.parse(inputs.artifact_digest),
      environmentRevision: z.string().parse(inputs.environment_revision),
      workflowRevision: sha.parse(required("GITHUB_SHA")),
      policyGeneration: z.number().parse(inputs.policy_generation),
    },
    `claim-${effectId}-${runId}-${runAttempt}`,
  );
  const bound = await manifest(effectId);
  if (
    bound.effectId !== effectId ||
    bound.artifactDigest !== inputs.artifact_digest ||
    bound.workflow.environment !== inputs.environment ||
    bound.workflow.workflowRevision !== required("GITHUB_SHA")
  )
    throw new Error("exact_manifest_mismatch");
  finite(bound.authorityExpiresAt);
  await awsIdentity(required("AA_DEPLOY_ROLE_ARN"));
  const identity = z
    .object({ Account: z.string() })
    .parse(await aws(["sts", "get-caller-identity"]));
  if (identity.Account !== bound.workflow.accountId) throw new Error("aws_account_mismatch");
  await aws([
    "s3api",
    "get-object",
    "--bucket",
    bound.artifactObject.bucket,
    "--key",
    bound.artifactObject.key,
    "--version-id",
    bound.artifactObject.versionId,
    "release.zip",
  ]);
  if (hash(await readFile("release.zip")) !== bound.artifactDigest)
    throw new Error("retained_artifact_digest_mismatch");
  const template = await command("unzip", ["-p", "release.zip", "template.yaml"]);
  if (hash(Buffer.from(template)) !== bound.templateDigest)
    throw new Error("retained_template_digest_mismatch");
  await writeFile("release-template.yaml", template);
  let prior: unknown;
  try {
    prior = await aws([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      bound.workflow.stackName,
    ]);
  } catch (error) {
    const failure = error as { stderr?: string };
    if (!failure.stderr?.includes("does not exist")) throw error;
  }
  const changeName = `aa-${effectId}`,
    params = [
      { ParameterKey: "CodeBucket", ParameterValue: bound.artifactObject.bucket },
      { ParameterKey: "CodeKey", ParameterValue: bound.artifactObject.key },
      { ParameterKey: "CodeVersion", ParameterValue: bound.artifactObject.versionId },
      { ParameterKey: "ArtifactDigest", ParameterValue: bound.artifactDigest },
    ];
  await writeFile("parameters.json", JSON.stringify(params));
  finite(bound.authorityExpiresAt);
  // Both writes occur once. A lost response is followed only by reads of this named effect.
  try {
    await aws([
      "cloudformation",
      "create-change-set",
      "--stack-name",
      bound.workflow.stackName,
      "--change-set-name",
      changeName,
      "--change-set-type",
      prior ? "UPDATE" : "CREATE",
      "--template-body",
      "file://release-template.yaml",
      "--parameters",
      "file://parameters.json",
      "--capabilities",
      "CAPABILITY_IAM",
      "CAPABILITY_AUTO_EXPAND",
      "--client-token",
      effectId,
    ]);
  } catch {
    await aws([
      "cloudformation",
      "describe-change-set",
      "--stack-name",
      bound.workflow.stackName,
      "--change-set-name",
      changeName,
    ]);
  }
  await command("aws", [
    "cloudformation",
    "wait",
    "change-set-create-complete",
    "--stack-name",
    bound.workflow.stackName,
    "--change-set-name",
    changeName,
  ]);
  const changes = z
    .object({
      Id: z.string(),
      Status: z.literal("CREATE_COMPLETE"),
      ExecutionStatus: z.literal("AVAILABLE"),
    })
    .passthrough()
    .parse(
      await aws([
        "cloudformation",
        "describe-change-set",
        "--stack-name",
        bound.workflow.stackName,
        "--change-set-name",
        changeName,
      ]),
    );
  finite(bound.authorityExpiresAt);
  try {
    await aws([
      "cloudformation",
      "execute-change-set",
      "--stack-name",
      bound.workflow.stackName,
      "--change-set-name",
      changes.Id,
      "--client-request-token",
      effectId,
    ]);
  } catch {
    z.object({ ExecutionStatus: z.enum(["EXECUTE_IN_PROGRESS", "EXECUTE_COMPLETE"]) })
      .passthrough()
      .parse(await aws(["cloudformation", "describe-change-set", "--change-set-name", changes.Id]));
  }
  await command("aws", [
    "cloudformation",
    "wait",
    prior ? "stack-update-complete" : "stack-create-complete",
    "--stack-name",
    bound.workflow.stackName,
  ]);
  const stack = z
      .object({
        Stacks: z
          .array(
            z.object({
              StackId: z.string(),
              Outputs: z.array(z.object({ OutputKey: z.string(), OutputValue: z.string() })),
            }),
          )
          .length(1),
      })
      .parse(
        await aws(["cloudformation", "describe-stacks", "--stack-name", bound.workflow.stackName]),
      ).Stacks[0],
    outputs = Object.fromEntries(stack.Outputs.map((item) => [item.OutputKey, item.OutputValue]));
  const functionName = z.string().parse(outputs.FunctionName),
    version = z.string().parse(outputs.Version);
  const code = z
    .object({ Configuration: z.object({ CodeSha256: z.string(), Version: z.string() }) })
    .passthrough()
    .parse(
      await aws([
        "lambda",
        "get-function",
        "--function-name",
        functionName,
        "--qualifier",
        version,
      ]),
    );
  if (
    Buffer.from(code.Configuration.CodeSha256, "base64").toString("hex") !== bound.artifactDigest ||
    code.Configuration.Version !== version
  )
    throw new Error("observed_lambda_version_digest_mismatch");
  if (outputs.HealthUrl !== bound.workflow.healthUrl)
    throw new Error("observed_health_target_mismatch");
  const health = await readHealth(bound.workflow.healthUrl);
  const healthy =
    health.failure === null &&
    health.status === bound.workflow.expectedStatus &&
    health.artifactDigest === bound.artifactDigest;
  await service(
    "deployment-receipts",
    {
      effectId,
      manifestDigest: bound.manifestDigest,
      artifactDigest: bound.artifactDigest,
      runId,
      runAttempt,
      environmentGeneration: bound.environmentGeneration,
      providerOperationId: changes.Id,
      observedCodeDigest: bound.artifactDigest,
      healthy,
      healthStatus: health.status,
      healthFailure: health.failure,
      healthArtifactDigest: health.artifactDigest,
      accountId: identity.Account,
      region: "eu-west-1",
      stackId: stack.StackId,
      lambdaVersion: version,
    },
    `receipt-${effectId}-${runId}-${runAttempt}`,
  );
}
async function main() {
  const mode = process.argv[2];
  if (mode === "notify") return dispatchMerged();
  const value = event.parse(JSON.parse(await readFile(required("GITHUB_EVENT_PATH"), "utf8"))),
    inputs = inputSchema.parse(value.inputs ?? {});
  await mkdir(".aa-workflow", { recursive: true });
  if (mode === "build") await build(inputs);
  else if (mode === "deploy") await deploy(inputs);
  else throw new Error("workflow_mode_required");
}
main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      status: "outcome_unknown",
      reason:
        error instanceof Error && /^[a-zA-Z0-9_]+$/.test(error.message)
          ? error.message
          : "workflow_needs_provider_reconciliation",
    })}\n`,
  );
  process.exitCode = 1;
});
