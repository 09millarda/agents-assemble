import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "@aa/catalog/definition";
import { starterPlaybook } from "@aa/catalog/starters";
import { artifactRefSchema, checkpointRefSchema } from "@aa/runner-protocol";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import { GithubRepositories } from "../../apps/api/src/projects.ts";
import { isolatedDatabase } from "../fixtures/database.ts";

const database = isolatedDatabase();
const idSchema = z.object({ id: z.uuid() });
const resultSchema = z.object({ runId: z.uuid(), status: z.literal("pending") });
const runSchema = idSchema.extend({
  data: z.object({
    status: z.string(),
    request: z.object({
      projectId: z.uuid(),
      repositoryId: z.uuid(),
      versionId: z.uuid(),
      sourceCommit: z.string(),
      inputs: z.record(z.string(), z.unknown()),
      workItem: z.object({
        provider: z.literal("github"),
        repositoryId: z.string(),
        issueNumber: z.number(),
        url: z.url(),
      }),
    }),
  }),
});
const commit = "a".repeat(40);
const seen: string[] = [];
const issueBodies = new Map<number, { title: string; body: string }>();
let providerRepositoryId = 501;
const github = createServer((req, res) => {
  const path = req.url ?? "";
  seen.push(path);
  res.setHeader("content-type", "application/json");
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end(JSON.stringify({ error: "fixture_read_only" }));
    return;
  }
  const issue = path.match(/^\/repos\/fixture\/delivery\/issues\/(\d+)$/);
  if (issue) {
    const number = Number(issue[1]);
    res.end(
      JSON.stringify({
        id: 10000 + number,
        number,
        ...(issueBodies.get(number) ?? {
          title: `Issue ${number}`,
          body: `Requirements for issue ${number}.`,
        }),
        html_url: `https://github.com/fixture/delivery/issues/${number}`,
        ...(number === 99
          ? { pull_request: { url: "https://api.github.com/repos/fixture/delivery/pulls/99" } }
          : {}),
      }),
    );
  } else if (path.startsWith("/repos/fixture/delivery/commits/"))
    res.end(JSON.stringify({ sha: commit }));
  else if (path === "/repos/fixture/delivery")
    res.end(
      JSON.stringify({
        id: providerRepositoryId,
        owner: { id: 1, login: "fixture" },
        name: "delivery",
        clone_url: "https://github.com/fixture/delivery.git",
        default_branch: "main",
      }),
    );
  else {
    res.writeHead(404);
    res.end(JSON.stringify({ message: "not_found" }));
  }
});
let application: Application;
let server: ReturnType<typeof serve>;
let directory: string;
let base: string;
let token = "",
  organizationId = "",
  projectId = "",
  repositoryId = "";
let foreignToken = "",
  foreignOrganization = "";
type Credentials = { token: string; organizationId: string };
async function request(
  path: string,
  body?: unknown,
  key = randomUUID(),
  credentials: Credentials = { token, organizationId },
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "X-Organization-Id": credentials.organizationId,
      "Idempotency-Key": key,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value: unknown = await response.json();
  return { response, value };
}
async function ok<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  key = randomUUID(),
  credentials?: Credentials,
): Promise<T> {
  const result = await request(path, body, key, credentials);
  expect(result.response.ok, JSON.stringify(result.value)).toBe(true);
  return schema.parse(result.value);
}
beforeAll(async () => {
  await database.create();
  directory = await mkdtemp(join(tmpdir(), "aa-issue-start-"));
  await new Promise<void>((resolve) => github.listen(0, "127.0.0.1", resolve));
  const address = github.address();
  if (!address || typeof address === "string") throw new Error("GitHub fixture address missing");
  const githubBase = `http://127.0.0.1:${address.port}`;
  application = await createApplication({
    databaseUrl: database.url,
    stateDirectory: directory,
    sessionKey: "issue-start-fixture-signing-key-at-least-32-characters",
    deploymentId: "issue-start-fixture",
    githubApiBase: githubBase,
    repositories: new GithubRepositories(undefined, githubBase),
  });
  organizationId = (
    await application.access.bootstrap({
      email: "issue-owner@example.test",
      name: "Issue owner",
      password: "issue-start-fixture-password",
      organizationName: "Issue start",
    })
  ).organizationId;
  foreignOrganization = (
    await application.access.bootstrap({
      email: "issue-foreign@example.test",
      name: "Other owner",
      password: "issue-start-fixture-password",
      organizationName: "Other organization",
    })
  ).organizationId;
  await new Promise<void>((resolve) => {
    server = serve(
      { fetch: application.router.app.fetch, hostname: "127.0.0.1", port: 0 },
      (address) => {
        base = `http://127.0.0.1:${address.port}`;
        resolve();
      },
    );
  });
  token = (
    await ok("/auth/login", z.object({ token: z.string() }), {
      email: "issue-owner@example.test",
      password: "issue-start-fixture-password",
    })
  ).token;
  foreignToken = (
    await ok("/auth/login", z.object({ token: z.string() }), {
      email: "issue-foreign@example.test",
      password: "issue-start-fixture-password",
    })
  ).token;
  projectId = (await ok("/projects", idSchema, { name: "Delivery" })).id;
  repositoryId = (
    await ok(`/projects/${projectId}/repositories`, idSchema, {
      owner: "fixture",
      name: "delivery",
    })
  ).id;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await application?.close();
  await new Promise<void>((resolve) => github.close(() => resolve()));
  await database.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test.each(["new-feature", "bug-fix"] as const)(
  "%s freezes the verified issue, immutable starter, and baseline exactly once",
  async (starter) => {
    const issueNumber = starter === "new-feature" ? 21 : 22;
    const input = { projectId, repositoryId, issueNumber, starter };
    const key = randomUUID();
    const first = await ok("/runs/from-issue", resultSchema, input, key);
    const run = await ok(`/runs/${first.runId}`, runSchema);
    expect(run.data.status).toBe("candidate");
    expect(run.data.request).toMatchObject({
      projectId,
      repositoryId,
      sourceCommit: commit,
      workItem: {
        provider: "github",
        repositoryId: "501",
        issueNumber,
        url: `https://github.com/fixture/delivery/issues/${issueNumber}`,
      },
    });
    const version = await ok(
      `/catalog/versions/${run.data.request.versionId}`,
      idSchema.extend({ data: z.object({ definition: z.unknown(), digest: z.string() }) }),
    );
    expect(version.data.definition).toEqual(starterPlaybook(starter));
    expect(version.data.digest).toBe(digest(starterPlaybook(starter)));
    const inputs = run.data.request.inputs;
    const brief = artifactRefSchema.parse(starter === "new-feature" ? inputs.brief : inputs.report);
    const checkpoint = checkpointRefSchema.parse(
      starter === "new-feature" ? inputs.checkpoint : inputs.baselineCheckpoint,
    );
    expect(Object.keys(inputs).sort()).toEqual(
      (starter === "new-feature"
        ? ["brief", "checkpoint", "suppliedSpec", "deliveryKey"]
        : ["report", "baselineCheckpoint", "priorFindings", "deliveryKey"]
      ).sort(),
    );
    expect(starter === "new-feature" ? inputs.suppliedSpec : inputs.priorFindings).toBeNull();
    expect(inputs.deliveryKey).toBe(`github-issue:501:${10000 + issueNumber}`);
    expect(brief.mediaType).toBe("text/markdown");
    expect(checkpoint).toMatchObject({ repositoryId: "501", commit });
    const revision = await ok(
      `/knowledge/revisions/${brief.revisionId}`,
      idSchema.extend({
        data: z.object({ documentId: z.uuid(), digest: z.string(), content: z.string() }),
      }),
    );
    expect(revision.data).toEqual({
      documentId: brief.id,
      digest: brief.digest,
      content: `# Issue ${issueNumber}\n\nRequirements for issue ${issueNumber}.\n\nSource: https://github.com/fixture/delivery/issues/${issueNumber}`,
    });
    issueBodies.set(issueNumber, {
      title: "Edited upstream title",
      body: "Later upstream edits must not replace accepted input.",
    });
    expect(await ok("/runs/from-issue", resultSchema, input, key)).toEqual(first);
    expect(await ok("/runs/from-issue", resultSchema, input)).toEqual(first);
    expect(await ok(`/runs/${first.runId}`, runSchema)).toEqual(run);
    expect(
      await ok(
        `/knowledge/revisions/${brief.revisionId}`,
        idSchema.extend({
          data: z.object({ documentId: z.uuid(), digest: z.string(), content: z.string() }),
        }),
      ),
    ).toEqual(revision);
    const alternate = starter === "new-feature" ? "bug-fix" : "new-feature";
    const conflict = await request("/runs/from-issue", { ...input, starter: alternate });
    expect(conflict.response.status).toBe(409);
    expect(z.object({ code: z.string() }).parse(conflict.value).code).toBe(
      "issue_start_scope_conflict",
    );
    const repeatedKeyConflict = await request(
      "/runs/from-issue",
      { ...input, starter: alternate },
      key,
    );
    expect(repeatedKeyConflict.response.status).toBe(409);
    expect(z.object({ code: z.string() }).parse(repeatedKeyConflict.value).code).toBe(
      "idempotency_conflict",
    );
    const runs = await ok("/runs", z.object({ items: z.array(runSchema) }));
    expect(
      runs.items.filter((item) => item.data.request.workItem.issueNumber === issueNumber),
    ).toHaveLength(1);
    expect(seen).toContain(`/repos/fixture/delivery/issues/${issueNumber}`);
  },
);

test("unauthorized actors and mismatched project or repository scopes cannot create issue runs", async () => {
  const input = { projectId, repositoryId, issueNumber: 31, starter: "new-feature" };
  const before = seen.length;
  expect(
    (await request("/runs/from-issue", input, randomUUID(), { token: "", organizationId })).response
      .status,
  ).toBe(401);
  expect(
    (
      await request("/runs/from-issue", input, randomUUID(), {
        token: foreignToken,
        organizationId,
      })
    ).response.status,
  ).toBe(403);
  expect(
    (
      await request("/runs/from-issue", input, randomUUID(), {
        token: foreignToken,
        organizationId: foreignOrganization,
      })
    ).response.status,
  ).toBe(404);
  expect(
    (await request("/runs/from-issue", { ...input, projectId: randomUUID() })).response.status,
  ).toBe(403);
  expect(
    (await request("/runs/from-issue", { ...input, repositoryId: randomUUID() })).response.status,
  ).toBe(404);
  expect(seen.length).toBe(before);
  providerRepositoryId = 999;
  try {
    const replaced = await request("/runs/from-issue", input);
    expect(replaced.response.status).toBe(409);
    expect(z.object({ code: z.string() }).parse(replaced.value).code).toBe(
      "repository_identity_changed",
    );
  } finally {
    providerRepositoryId = 501;
  }
  expect((await request("/runs/from-issue", { ...input, issueNumber: 99 })).response.status).toBe(
    400,
  );
  const runs = await ok("/runs", z.object({ items: z.array(runSchema) }));
  expect(runs.items.some((item) => [31, 99].includes(item.data.request.workItem.issueNumber))).toBe(
    false,
  );
});
