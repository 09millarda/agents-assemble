import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { RunnerCertificateAuthority } from "../../apps/api/src/tls.ts";

const exec = promisify(execFile),
  hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
it.each(["healthy", "network", "timeout"] as const)(
  "runs the actual workflow client after verified AWS writes with %s health and no repeated mutations",
  async (healthMode) => {
    const directory = await mkdtemp(join(tmpdir(), "aa-workflow-client-")),
      bin = join(directory, "bin"),
      release = join(directory, "archive");
    await mkdir(bin);
    await mkdir(release);
    const authority = new RunnerCertificateAuthority(join(directory, "pki"));
    await authority.initialize();
    const template = Buffer.from("AWSTemplateFormatVersion: 2010-09-09\nResources: {}\n");
    await writeFile(join(release, "template.yaml"), template);
    await writeFile(join(release, "handler.mjs"), "export const handler = () => {};\n");
    await exec("zip", ["-q", "-X", "-r", join(directory, "retained.zip"), "."], { cwd: release });
    const artifact = hash(await readFile(join(directory, "retained.zip"))),
      effectId = randomUUID(),
      organizationId = randomUUID();
    const seen: { path: string; body: Record<string, unknown> }[] = [];
    let base = "";
    const server = createServer(await authority.serverOptions(), async (req, res) => {
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : {};
      seen.push({ path: req.url ?? "", body });
      const send = (value: unknown) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(value));
      };
      if (req.url?.startsWith("/identity")) {
        send({ value: "fixture-oidc-token" });
        return;
      }
      if (req.url === "/health") {
        if (healthMode === "network") {
          req.socket.destroy();
          return;
        }
        if (healthMode === "timeout") return;
        send({ artifactDigest: artifact });
        return;
      }
      if (req.url?.includes("/claims/")) {
        send({ status: "claimed", effectId, environmentGeneration: 9 });
        return;
      }
      if (req.url?.includes("/manifests/")) {
        send({
          effectId,
          manifestDigest: "m".repeat(64),
          artifactDigest: artifact,
          sourceCommit: "a".repeat(40),
          artifactObject: { bucket: "builds", key: "release.zip", versionId: "immutable-version" },
          templateDigest: hash(template),
          workflow: {
            repositoryId: randomUUID(),
            environment: "staging",
            workflowPath: ".github/workflows/delivery.yml",
            workflowRef: "trusted",
            workflowRevision: "b".repeat(40),
            environmentRevision: "stage-7",
            expectedStatus: 200,
            healthUrl: `${base}/health`,
            accountId: "123456789012",
            stackName: "aa-stage",
            region: "eu-west-1",
            policyGeneration: 2,
          },
          environmentGeneration: 9,
          authorityExpiresAt: new Date(Date.now() + 120000).toISOString(),
        });
        return;
      }
      if (req.url?.includes("/deployment-receipts/")) {
        send({ status: "accepted", effectId });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing_address");
    base = `https://127.0.0.1:${address.port}`;
    const counter = join(directory, "writes"),
      aws = join(bin, "aws");
    await writeFile(
      aws,
      `#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2),verb=args.slice(0,2).join(' ');const result=value=>console.log(JSON.stringify(value));
if(verb==='sts assume-role-with-web-identity')result({Credentials:{AccessKeyId:'fixture-key',SecretAccessKey:'fixture-secret',SessionToken:'fixture-session'}});
else if(verb==='sts get-caller-identity')result({Account:'123456789012'});
else if(verb==='s3api get-object'){fs.copyFileSync(${JSON.stringify(join(directory, "retained.zip"))},'release.zip');result({VersionId:'immutable-version'});}
else if(verb==='cloudformation describe-stacks')result({Stacks:[{StackId:'arn:aws:cloudformation:eu-west-1:123456789012:stack/aa-stage/fixture',Outputs:[{OutputKey:'FunctionName',OutputValue:'fixture-function'},{OutputKey:'Version',OutputValue:'7'},{OutputKey:'HealthUrl',OutputValue:${JSON.stringify(`${base}/health`)}}]}]});
else if(verb==='cloudformation create-change-set'||verb==='cloudformation execute-change-set'){fs.appendFileSync(${JSON.stringify(counter)},verb+'\\n');process.exit(1);}
else if(verb==='cloudformation describe-change-set'){const writes=fs.readFileSync(${JSON.stringify(counter)},'utf8');result({Id:'arn:aws:cloudformation:eu-west-1:123456789012:changeSet/aa-${effectId}/fixture',Status:'CREATE_COMPLETE',ExecutionStatus:writes.includes('execute-change-set')?'EXECUTE_IN_PROGRESS':'AVAILABLE'});}
else if(verb==='cloudformation wait')process.exit(0);
else if(verb==='lambda get-function')result({Configuration:{CodeSha256:${JSON.stringify(Buffer.from(artifact, "hex").toString("base64"))},Version:'7'}});
else{console.error('unexpected_fixture_aws_operation');process.exit(2);}
`,
      { mode: 0o700 },
    );
    const event = join(directory, "event.json");
    await writeFile(
      event,
      JSON.stringify({
        inputs: {
          mode: "deploy",
          effect_id: effectId,
          manifest_digest: "m".repeat(64),
          artifact_digest: artifact,
          environment: "staging",
          environment_revision: "stage-7",
          policy_generation: "2",
          source_commit: "",
          delivery_id: "",
        },
      }),
    );
    try {
      const child = await exec(
        process.execPath,
        [resolve("examples/reference-delivery/scripts/workflow.ts"), "deploy"],
        {
          cwd: directory,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            NODE_EXTRA_CA_CERTS: join(authority.directory, "ca.pem"),
            ACTIONS_ID_TOKEN_REQUEST_URL: `${base}/identity`,
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture-request-token",
            AA_SERVICE_URL: base,
            AA_ORGANIZATION_ID: organizationId,
            AA_DEPLOY_ROLE_ARN: "arn:aws:iam::123456789012:role/fixture",
            GITHUB_RUN_ID: "77",
            GITHUB_RUN_ATTEMPT: "1",
            GITHUB_SHA: "b".repeat(40),
            GITHUB_EVENT_PATH: event,
          },
          timeout: 20000,
        },
      );
      expect(child.stdout).not.toContain("fixture-secret");
      expect((await readFile(counter, "utf8")).trim().split("\n")).toEqual([
        "cloudformation create-change-set",
        "cloudformation execute-change-set",
      ]);
      const receipt = seen.find((item) => item.path.includes("/deployment-receipts/"));
      expect(receipt?.body).toMatchObject({
        effectId,
        artifactDigest: artifact,
        observedCodeDigest: artifact,
        environmentGeneration: 9,
        accountId: "123456789012",
        region: "eu-west-1",
        lambdaVersion: "7",
        healthy: healthMode === "healthy",
        healthStatus: healthMode === "healthy" ? 200 : null,
        healthFailure: healthMode === "healthy" ? null : healthMode,
        healthArtifactDigest: healthMode === "healthy" ? artifact : null,
      });
      expect(seen.filter((item) => item.path.includes("/claims/"))).toHaveLength(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
