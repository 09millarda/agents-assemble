import { createHmac, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { CollaborationService } from "@aa/collaboration/service";
import { MessageSchema } from "@aa/platform/contracts";
import { digest } from "@aa/platform/crypto";
import { ApiRouter } from "@aa/platform/http";
import { ContextStore } from "@aa/platform/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate.ts";
import { LocalAccess } from "./access.ts";
import { deploymentProfileSchema, type EffectIntent, Integrations } from "./integrations.ts";
import { GithubRepositories, Projects, type Repository } from "./projects.ts";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://agents_assemble:local-development-only@127.0.0.1:55433/agents_assemble";

describe("GitHub protocol and durable effect conformance", () => {
  let server: Server,
    base: string,
    router: ApiRouter,
    integrations: Integrations,
    organizationId: string,
    token: string,
    repositoryId: string,
    projectId: string,
    repository: Repository;
  let stores: ContextStore[] = [];
  let branch: string | null = null,
    pull: Record<string, unknown> | null = null,
    prWrites = 0,
    dispatchWrites = 0,
    lostPullResponse = true,
    lostDispatchResponse = true,
    healthStatus = 200,
    healthConnectionLost = false,
    effectAuthority = true;
  const runRecords: {
    id: number;
    head_sha: string;
    display_title: string;
    path: string;
    run_attempt: number;
  }[] = [];
  const runIds = new Map<string, string>();
  const deliveryId = randomUUID(),
    sha = "a".repeat(40),
    checkpoint = "b".repeat(40),
    merged = "c".repeat(40),
    artifactDigest = "d".repeat(64),
    webhookSecret = "a-conformance-only-webhook-secret";
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const request = async (
    path: string,
    body?: unknown,
    operationId: string = randomUUID(),
    bearer = token,
  ) =>
    router.app.request(`http://localhost/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": operationId,
        authorization: `Bearer ${bearer}`,
        "x-organization-id": organizationId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const effect = async (action: EffectIntent["action"], input: unknown): Promise<EffectIntent> => {
    const intent = {
      effectId: randomUUID(),
      runId: randomUUID(),
      path: `/${action}`,
      action,
      input,
      manifestDigest: "e".repeat(64),
      deadline: new Date(Date.now() + 300000).toISOString(),
      deliveryId,
      projectId,
      repositoryRegistrationId: repositoryId,
      repository,
      sourceCommit: sha,
    };
    await integrations.accept(
      MessageSchema.parse({
        id: randomUUID(),
        organizationId,
        source: "execution",
        type: "execution.effect_requested",
        schemaVersion: 1,
        aggregateId: intent.runId,
        aggregateVersion: 1,
        sequence: 1,
        causationId: randomUUID(),
        correlationId: randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: intent,
      }),
    );
    return intent as EffectIntent;
  };
  const effects = async () => {
    const response = await request("/integrations/effects");
    expect(response.status).toBe(200);
    return (await response.json()).items;
  };
  const jobToken = (runId: number, runAttempt = 1, overrides: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000),
      header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "conformance-key" })).toString(
        "base64url",
      );
    const body = Buffer.from(
      JSON.stringify({
        iss: base,
        aud: "agents-assemble",
        exp: now + 300,
        iat: now,
        repository_id: "101",
        repository_owner_id: "202",
        repository: "owner/repo",
        run_id: String(runId),
        run_attempt: String(runAttempt),
        workflow_ref: "owner/repo/.github/workflows/delivery.yml@refs/heads/main",
        workflow_sha: sha,
        sha,
        ref: "refs/heads/main",
        ...overrides,
      }),
    ).toString("base64url");
    return `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), pair.privateKey).toString("base64url")}`;
  };
  beforeAll(async () => {
    await migrate(databaseUrl);
    server = createServer(async (req, res) => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : {};
      const send = (value: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (path === "/jwks") {
        send({
          keys: [
            {
              ...pair.publicKey.export({ format: "jwk" }),
              kid: "conformance-key",
              alg: "RS256",
              use: "sig",
            },
          ],
        });
        return;
      }
      if (path === "/health") {
        if (healthConnectionLost) {
          req.socket.destroy();
          return;
        }
        send({ artifactDigest }, healthStatus);
        return;
      }
      if (path === "/repos/owner/repo") {
        send({
          id: 101,
          owner: { id: 202, login: "owner" },
          name: "repo",
          clone_url: "https://github.com/owner/repo.git",
          default_branch: "main",
        });
        return;
      }
      if (path.startsWith("/repos/owner/repo/commits/")) {
        send({ sha });
        return;
      }
      if (path.startsWith("/repos/owner/repo/git/ref/heads/")) {
        if (!branch) {
          send({}, 404);
          return;
        }
        send({ object: { sha: branch } });
        return;
      }
      if (
        path === "/repos/owner/repo/git/refs" ||
        path.startsWith("/repos/owner/repo/git/refs/heads/")
      ) {
        branch = body.sha;
        send({ object: { sha: branch } });
        return;
      }
      if (path === "/repos/owner/repo/pulls" && req.method === "GET") {
        send(pull ? [pull] : []);
        return;
      }
      if (path === "/repos/owner/repo/pulls" && req.method === "POST") {
        prWrites++;
        pull = {
          number: 7,
          html_url: "https://github.com/owner/repo/pull/7",
          body: body.body,
          head: { sha: branch, ref: body.head },
          base: { repo: { id: 101 } },
        };
        if (lostPullResponse) {
          lostPullResponse = false;
          req.socket.destroy();
          return;
        }
        send(pull);
        return;
      }
      if (path === "/repos/owner/repo/pulls/7") {
        send({ ...pull, merged: true, merge_commit_sha: merged });
        return;
      }
      if (path.endsWith("/dispatches")) {
        dispatchWrites++;
        runRecords.push({
          id: 76 + dispatchWrites,
          head_sha: sha,
          display_title: `Agents Assemble ${body.inputs.effect_id}`,
          path: decodeURIComponent(path.split("/workflows/")[1].replace("/dispatches", "")),
          run_attempt: 1,
        });
        if (lostDispatchResponse) {
          lostDispatchResponse = false;
          req.socket.destroy();
          return;
        }
        send({ workflow_run_id: 76 + dispatchWrites });
        return;
      }
      if (path.endsWith("/runs")) {
        send({ workflow_runs: runRecords });
        return;
      }
      send({ error: "unhandled_fixture_route" }, 404);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing_address");
    base = `http://127.0.0.1:${address.port}`;
    stores = [
      new ContextStore("access", databaseUrl),
      new ContextStore("projects", databaseUrl),
      new ContextStore("integrations", databaseUrl),
      new ContextStore("knowledge", databaseUrl),
    ];
    const access = new LocalAccess(stores[0], "integration-conformance-session-key-32-characters");
    router = new ApiRouter(access);
    access.register(router);
    const projects = new Projects(
      stores[1],
      new GithubRepositories("fixture-provider-token", base),
    );
    projects.register(router);
    const knowledge = new CollaborationService(stores[3]);
    integrations = new Integrations(stores[2], {
      apiBase: base,
      webhookSecret,
      oidcIssuer: base,
      oidcJwksUrl: `${base}/jwks`,
      repository: async (org, id) => (await projects.repository(org, id)).data,
      authorizeConsumer: (org, id) => projects.authorizeConsumer(org, id, "integrations"),
      authorizeEffect: async (org, intent) => {
        if (!effectAuthority) throw new Error("effect_authority_held");
        const project = await projects.get(org, intent.projectId);
        if (project.data.status !== "active") throw new Error("project_not_active");
      },
      startFromIssue: async (_org, input) => {
        const runId = runIds.get(input.deliveryKey) ?? randomUUID();
        runIds.set(input.deliveryKey, runId);
        return { runId, status: "pending" };
      },
      createArtifact: async (org, input) => {
        const meta = {
          organizationId: org,
          actorId: "integration-adapter",
          operation: "effect-artifact",
          operationId: input.operationId,
          request: input,
        };
        const draft = await knowledge.create(meta, "Provider evidence", "markdown", input.content);
        const candidate = await knowledge.candidate(
          { ...meta, operation: "effect-artifact-candidate" },
          draft.id,
          { epoch: draft.data.epoch, expectedSequence: 0 },
        );
        const revision = await knowledge.submit(
          { ...meta, operation: "effect-artifact-submit" },
          draft.id,
          { candidateId: candidate.id, expectedHead: 0 },
        );
        return {
          id: draft.id,
          revisionId: revision.id,
          digest: revision.data.digest,
          mediaType: input.mediaType,
        };
      },
    });
    integrations.register(router);
    const email = `integration-${randomUUID()}@example.test`;
    organizationId = (
      await access.bootstrap({
        email,
        name: "Integration owner",
        password: "integration-test-password",
        organizationName: "Provider conformance",
      })
    ).organizationId;
    token = (
      await (await request("/auth/login", { email, password: "integration-test-password" })).json()
    ).token;
    const project = await (await request("/projects", { name: "Provider conformance" })).json();
    projectId = project.id;
    const incarnation = randomUUID();
    await projects.enrollConsumer(organizationId, "integrations", incarnation);
    for (const checkpoint of await projects.consumerCheckpoints(
      organizationId,
      "integrations",
      incarnation,
    ))
      await projects.acknowledgeCheckpoint(
        organizationId,
        await integrations.installProjectCheckpoint(organizationId, checkpoint),
      );
    const registered = await (
      await request(`/projects/${projectId}/repositories`, { owner: "owner", name: "repo" })
    ).json();
    repositoryId = registered.id;
    repository = registered.data;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all(stores.map((store) => store.close()));
  });
  it("verifies raw signatures before decoding and deduplicates provider delivery separately from logical issue start", async () => {
    expect(
      (
        await request("/integrations/github/routes", {
          projectId,
          repositoryId,
          label: "agents-assemble",
        })
      ).status,
    ).toBe(200);
    const delivery = randomUUID();
    const payload = {
      action: "labeled",
      repository: { id: 101, owner: { id: 202, login: "owner" }, name: "repo" },
      issue: {
        id: 303,
        number: 12,
        title: "Feature request",
        body: "Intentional brief",
        html_url: "https://github.com/owner/repo/issues/12",
        labels: [{ name: "agents-assemble" }],
      },
    };
    const webhook = async (body: string, key = delivery, signature?: string) =>
      router.app.request(`http://localhost/api/v1/integrations/github/webhooks/${organizationId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "issues",
          "x-github-delivery": key,
          "x-hub-signature-256":
            signature ?? `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`,
        },
        body,
      });
    const bad = await webhook("{invalid", randomUUID(), "sha256=invalid");
    expect(bad.status).toBe(401);
    expect((await bad.json()).code).toBe("invalid_webhook_signature");
    const first = await webhook(JSON.stringify(payload));
    expect(first.status).toBe(200);
    const admitted = await first.json();
    expect(admitted.status).toBe("pending");
    expect(await (await webhook(JSON.stringify(payload))).json()).toEqual(admitted);
    expect(await (await webhook(JSON.stringify(payload), randomUUID())).json()).toEqual(admitted);
    expect(runIds.size).toBe(1);
    expect((await webhook(JSON.stringify({ ...payload, action: "opened" }))).status).toBe(409);
    await request("/integrations/github/routes", {
      projectId,
      repositoryId,
      label: "agents-assemble",
    });
    expect((await (await webhook(JSON.stringify(payload), randomUUID())).json()).status).toBe(
      "ambiguous",
    );
    expect(runIds.size).toBe(1);
  });
  it("reconciles an accepted pull-request POST with a lost response without creating another PR", async () => {
    const artifact = {
      id: randomUUID(),
      revisionId: randomUUID(),
      digest: "f".repeat(64),
      mediaType: "text/markdown",
    };
    const intent = await effect("publishPR", {
      checkpoint: {
        id: randomUUID(),
        repositoryId: repository.providerId,
        commit: checkpoint,
        digest: "1".repeat(64),
      },
      spec: artifact,
      approval: { approved: true, receiptId: randomUUID(), manifestDigest: "2".repeat(64) },
      deliveryKey: "feature-12",
    });
    await integrations.tick(organizationId);
    expect(
      (await effects()).find((item: { id: string }) => item.id === intent.effectId).data.status,
    ).toBe("outcome_unknown");
    expect(prWrites).toBe(1);
    await integrations.tick(organizationId);
    const result = (await effects()).find((item: { id: string }) => item.id === intent.effectId);
    expect(result.data).toMatchObject({
      status: "completed",
      output: { pullRequest: "https://github.com/owner/repo/pull/7" },
    });
    expect(prWrites).toBe(1);
  });
  it("pins signed build provenance, reconciles one dispatch, and consumes exact workflow authority once", async () => {
    const profiles = [];
    for (const environment of ["staging", "production"] as const) {
      const profile = deploymentProfileSchema.parse({
        repositoryId,
        environment,
        workflowPath: ".github/workflows/delivery.yml",
        workflowRef: "main",
        workflowRevision: sha,
        environmentRevision: `${environment}-1`,
        healthUrl: `${base}/health`,
        accountId: "123456789012",
        stackName: `aa-${environment}`,
        region: "eu-west-1",
        expectedPreviousArtifact: null,
        policyGeneration: 1,
      });
      profiles.push(profile);
      expect((await request("/integrations/deployment-profiles", profile)).status).toBe(200);
    }
    const buildBody = {
      deliveryId,
      repositoryId,
      commit: merged,
      artifactDigest,
      workflowRevision: sha,
      artifactObject: { bucket: "retained-builds", key: "release.zip", versionId: "version-1" },
      templateDigest: "3".repeat(64),
      runId: 66,
      runAttempt: 1,
    };
    const bad = await request(
      `/integrations/github/releases/${organizationId}`,
      buildBody,
      randomUUID(),
      jobToken(66, 1, { repository_id: "999" }),
    );
    expect(bad.status).toBe(403);
    const firstBuild = await request(
      `/integrations/github/releases/${organizationId}`,
      buildBody,
      randomUUID(),
      jobToken(66),
    );
    expect(firstBuild.status).toBe(200);
    const retainedBuild = await firstBuild.json();
    expect(
      await (
        await request(
          `/integrations/github/releases/${organizationId}`,
          buildBody,
          randomUUID(),
          jobToken(66),
        )
      ).json(),
    ).toEqual(retainedBuild);
    for (const changed of [
      { ...buildBody, artifactDigest: "9".repeat(64) },
      { ...buildBody, artifactObject: { ...buildBody.artifactObject, versionId: "replacement" } },
      { ...buildBody, runAttempt: 2 },
    ]) {
      const rejected = await request(
        `/integrations/github/releases/${organizationId}`,
        changed,
        randomUUID(),
        jobToken(66, changed.runAttempt),
      );
      expect(rejected.status).toBe(409);
      expect((await rejected.json()).code).toBe("delivery_build_immutable");
    }
    const wait = await effect("waitMerge", {
      pullRequest: "https://github.com/owner/repo/pull/7",
      checkpoint: {
        id: randomUUID(),
        repositoryId: repository.providerId,
        commit: checkpoint,
        digest: "1".repeat(64),
      },
    });
    await integrations.tick(organizationId);
    const build = (await effects()).find((item: { id: string }) => item.id === wait.effectId).data
      .output;
    expect(build).toMatchObject({
      artifactDigest,
      commit: merged,
      stagingPolicy: { profileDigest: digest(profiles[0]) },
    });
    const deployment = await effect("staging", {
      artifactDigest,
      workflowRevision: sha,
      sourceCommit: merged,
      policy: build.stagingPolicy,
    });
    await integrations.tick(organizationId);
    expect(dispatchWrites).toBe(1);
    expect(
      (await effects()).find((item: { id: string }) => item.id === deployment.effectId).data.status,
    ).toBe("outcome_unknown");
    await integrations.tick(organizationId);
    expect(dispatchWrites).toBe(1);
    const claimBody = {
        effectId: deployment.effectId,
        manifestDigest: deployment.manifestDigest,
        artifactDigest,
        environmentRevision: "staging-1",
        workflowRevision: sha,
        policyGeneration: 1,
      },
      claimId = randomUUID();
    const claim = await request(
      `/integrations/github/claims/${organizationId}`,
      claimBody,
      claimId,
      jobToken(77),
    );
    expect(claim.status).toBe(200);
    const claimed = await claim.json();
    expect(claimed).toMatchObject({ status: "claimed", environmentGeneration: 1 });
    expect(
      await (
        await request(
          `/integrations/github/claims/${organizationId}`,
          claimBody,
          claimId,
          jobToken(77),
        )
      ).json(),
    ).toEqual(claimed);
    expect(
      (
        await request(
          `/integrations/github/claims/${organizationId}`,
          claimBody,
          randomUUID(),
          jobToken(77, 2),
        )
      ).status,
    ).toBe(409);
    const receipt = {
      effectId: deployment.effectId,
      manifestDigest: deployment.manifestDigest,
      artifactDigest,
      runId: 77,
      runAttempt: 1,
      environmentGeneration: 1,
      providerOperationId: "cloudformation-change-set-1",
      observedCodeDigest: artifactDigest,
      healthy: true,
      healthStatus: 200,
      healthArtifactDigest: artifactDigest,
      accountId: "123456789012",
      region: "eu-west-1",
      stackId: "arn:aws:cloudformation:eu-west-1:123456789012:stack/aa-staging/unique",
      lambdaVersion: "1",
    };
    expect(
      (
        await request(
          `/integrations/github/deployment-receipts/${organizationId}`,
          receipt,
          randomUUID(),
          jobToken(77),
        )
      ).status,
    ).toBe(200);
    await integrations.tick(organizationId);
    expect(
      (await effects()).find((item: { id: string }) => item.id === deployment.effectId).data,
    ).toMatchObject({ status: "completed", output: { healthy: true, artifactDigest } });
    expect(dispatchWrites).toBe(1);
    healthStatus = 503;
    const health = await effect("verifyHealth", {
      deploymentId: deployment.effectId,
      artifactDigest,
    });
    await integrations.tick(organizationId);
    expect(
      (await effects()).find((item: { id: string }) => item.id === health.effectId).data.output,
    ).toMatchObject({ healthy: false, evidence: { mediaType: "application/json" } });
    const recovery = await effect("recoverProduction", {
      deploymentId: deployment.effectId,
      evidence: {
        id: randomUUID(),
        revisionId: randomUUID(),
        digest: "f".repeat(64),
        mediaType: "application/json",
      },
    });
    await integrations.tick(organizationId);
    expect(
      (await effects()).find((item: { id: string }) => item.id === recovery.effectId).data.reason,
    ).toBe("rollback_lineage_mismatch");
  });
  it("rolls back only the retained prior release/configuration with one exact signed workflow claim", async () => {
    const policy = (profile: ReturnType<typeof deploymentProfileSchema.parse>) => ({
      profileDigest: digest(profile),
      environmentRevision: profile.environmentRevision,
      policyGeneration: profile.policyGeneration,
      accountId: profile.accountId,
      stackName: profile.stackName,
    });
    const oldProfile = deploymentProfileSchema.parse({
      repositoryId,
      environment: "production",
      workflowPath: ".github/workflows/delivery.yml",
      workflowRef: "main",
      workflowRevision: sha,
      environmentRevision: "production-1",
      healthUrl: `${base}/health`,
      accountId: "123456789012",
      stackName: "aa-production",
      region: "eu-west-1",
      expectedPreviousArtifact: null,
      policyGeneration: 1,
    });
    const old = await effect("production", {
      artifactDigest,
      workflowRevision: sha,
      sourceCommit: merged,
      policy: policy(oldProfile),
      approval: { approved: true },
    });
    await integrations.tick(organizationId);
    const claim = async (
      intent: EffectIntent,
      runId: number,
      revision: string,
      generation: number,
      bearer = jobToken(runId),
    ) => {
      const body = {
        effectId: intent.effectId,
        manifestDigest: intent.manifestDigest,
        artifactDigest,
        environmentRevision: revision,
        workflowRevision: sha,
        policyGeneration: generation,
      };
      const response = await request(
        `/integrations/github/claims/${organizationId}`,
        body,
        randomUUID(),
        bearer,
      );
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      return { body, data: await response.json() };
    };
    const receipt = async (
      intent: EffectIntent,
      runId: number,
      generation: number,
      healthy: boolean,
      bearer = jobToken(runId),
    ) => {
      const response = await request(
        `/integrations/github/deployment-receipts/${organizationId}`,
        {
          effectId: intent.effectId,
          manifestDigest: intent.manifestDigest,
          artifactDigest,
          runId,
          runAttempt: 1,
          environmentGeneration: generation,
          providerOperationId: `change-${runId}`,
          observedCodeDigest: artifactDigest,
          healthy,
          healthStatus: healthy ? 200 : null,
          healthFailure: healthy ? null : "network",
          healthArtifactDigest: healthy ? artifactDigest : null,
          accountId: "123456789012",
          region: "eu-west-1",
          stackId: "arn:aws:cloudformation:eu-west-1:123456789012:stack/aa-production/unique",
          lambdaVersion: String(runId),
        },
        randomUUID(),
        bearer,
      );
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    };
    const oldRun = 76 + dispatchWrites;
    await claim(old, oldRun, "production-1", 1);
    await receipt(old, oldRun, 1, true);
    await integrations.tick(organizationId);
    const profile = deploymentProfileSchema.parse({
      ...oldProfile,
      environmentRevision: "production-2",
      policyGeneration: 2,
      expectedPreviousArtifact: artifactDigest,
      rollbackWorkflowPath: ".github/workflows/rollback.yml",
    });
    expect((await request("/integrations/deployment-profiles", profile)).status).toBe(200);
    const failed = await effect("production", {
      artifactDigest,
      workflowRevision: sha,
      sourceCommit: merged,
      policy: policy(profile),
      approval: { approved: true },
    });
    await integrations.tick(organizationId);
    const failedRun = 76 + dispatchWrites;
    await claim(failed, failedRun, "production-2", 2);
    await receipt(failed, failedRun, 2, false);
    await integrations.tick(organizationId);
    expect(
      (await effects()).find((item: { id: string }) => item.id === failed.effectId).data.status,
    ).toBe("completed");
    healthConnectionLost = true;
    const health = await effect("verifyHealth", { deploymentId: failed.effectId, artifactDigest });
    await integrations.tick(organizationId);
    const evidence = (await effects()).find((item: { id: string }) => item.id === health.effectId)
      .data.output.evidence;
    const observation = await new CollaborationService(stores[3]).getRevision(
      organizationId,
      evidence.revisionId,
    );
    if (typeof observation.data.content !== "string") throw new Error("expected_health_content");
    expect(JSON.parse(observation.data.content)).toMatchObject({
      deploymentId: failed.effectId,
      artifactDigest,
      healthy: false,
      status: null,
      failure: "network",
    });
    const rollback = await effect("recoverProduction", { deploymentId: failed.effectId, evidence });
    lostDispatchResponse = true;
    await integrations.tick(organizationId);
    const count = dispatchWrites,
      rollbackRun = 76 + dispatchWrites;
    expect(
      (await effects()).find((item: { id: string }) => item.id === rollback.effectId).data.status,
    ).toBe("outcome_unknown");
    await integrations.tick(organizationId);
    expect(dispatchWrites).toBe(count);
    const rollbackToken = jobToken(rollbackRun, 1, {
      workflow_ref: "owner/repo/.github/workflows/rollback.yml@refs/heads/main",
    });
    const rollbackClaim = await claim(rollback, rollbackRun, "production-1", 2, rollbackToken);
    expect(rollbackClaim.data.environmentGeneration).toBe(3);
    expect(
      (
        await request(
          `/integrations/github/claims/${organizationId}`,
          rollbackClaim.body,
          randomUUID(),
          jobToken(rollbackRun, 2, {
            workflow_ref: "owner/repo/.github/workflows/rollback.yml@refs/heads/main",
          }),
        )
      ).status,
    ).toBe(409);
    const manifest = await request(
      `/integrations/github/manifests/${organizationId}/${rollback.effectId}`,
      undefined,
      randomUUID(),
      rollbackToken,
    );
    expect(manifest.status).toBe(200);
    expect(await manifest.json()).toMatchObject({
      artifactDigest,
      sourceCommit: merged,
      workflow: {
        workflowPath: ".github/workflows/rollback.yml",
        environmentRevision: "production-1",
      },
      artifactObject: { versionId: "version-1" },
    });
    healthConnectionLost = false;
    healthStatus = 200;
    await receipt(rollback, rollbackRun, 3, true, rollbackToken);
    await integrations.tick(organizationId);
    expect(
      (await effects()).find((item: { id: string }) => item.id === rollback.effectId).data,
    ).toMatchObject({
      status: "completed",
      output: { outcome: "rolled_back", evidence: { mediaType: "application/json" } },
    });
    expect(dispatchWrites).toBe(count);
  });
  it("retains a pre-dispatch authority hold as waiting with no uncertain provider write", async () => {
    effectAuthority = false;
    const before = { prWrites, dispatchWrites };
    const intent = await effect("publishPR", {
      checkpoint: {
        id: randomUUID(),
        repositoryId: repository.providerId,
        commit: checkpoint,
        digest: "1".repeat(64),
      },
      spec: {
        id: randomUUID(),
        revisionId: randomUUID(),
        digest: "f".repeat(64),
        mediaType: "text/markdown",
      },
      approval: { approved: true, receiptId: randomUUID(), manifestDigest: "2".repeat(64) },
      deliveryKey: "feature-12",
    });
    try {
      await integrations.tick(organizationId);
      expect(
        (await effects()).find((item: { id: string }) => item.id === intent.effectId).data,
      ).toMatchObject({ status: "waiting", phase: "lookup" });
      expect({ prWrites, dispatchWrites }).toEqual(before);
    } finally {
      effectAuthority = true;
    }
  });
});
