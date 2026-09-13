import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { z } from "zod";

const email = process.env.AA_BROWSER_EMAIL,
  password = process.env.AA_BROWSER_PASSWORD;
async function login(page: Page, account: { email: string; password: string }) {
  await page.goto("/#/projects");
  await page.getByLabel("Email", { exact: false }).fill(account.email);
  await page.getByLabel("Password", { exact: false }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
}
async function owner(request: APIRequestContext) {
  const response = await request.post("/api/v1/auth/login", {
      headers: { "Idempotency-Key": randomUUID() },
      data: { email, password },
    }),
    { token } = z.object({ token: z.string() }).parse(await response.json());
  const session = z
    .object({ organizations: z.array(z.object({ id: z.string() })) })
    .parse(
      await (
        await request.get("/api/v1/auth/session", { headers: { Authorization: `Bearer ${token}` } })
      ).json(),
    );
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Organization-Id": session.organizations[0].id,
  };
  return {
    headers,
    async post(path: string, data: unknown) {
      const response = await request.post(`/api/v1${path}`, {
        headers: { ...headers, "Idempotency-Key": randomUUID() },
        data,
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    },
    async get(path: string) {
      const response = await request.get(`/api/v1${path}`, { headers });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    },
  };
}
async function edit(page: Page, index: number, value: string) {
  const node = page.locator(`section[aria-label="end node step_${index}"]`);
  await node.getByRole("button", { name: "Configure", exact: true }).click();
  await node
    .getByLabel(`Behavioral fields · step_${index}`, { exact: true })
    .fill(JSON.stringify({ result: { literal: value } }));
  await node.getByRole("button", { name: "Apply fields", exact: true }).click();
}
test("five distinct browser graph editors converge a 100-node definition and replay a sixty-second offline semantic edit", async ({
  browser,
  request,
}, info) => {
  test.skip(
    !email || !password,
    "Requires an installed API and a bootstrapped account; no mocked server is used.",
  );
  test.skip(
    info.project.name !== "desktop",
    "The five-client transport workload is qualified once; responsive authoring is covered separately.",
  );
  if (!email || !password) throw new Error("Missing browser account");
  const api = await owner(request),
    accounts = [{ email, password }],
    title = `100-node collaborative graph ${randomUUID()}`;
  for (let index = 1; index < 5; index++) {
    const account = {
        email: `graph-${randomUUID()}@example.test`,
        password: `graph-password-${randomUUID()}`,
      },
      invitation = await api.post("/invitations", { email: account.email, role: "member" });
    await api.post("/auth/accept-invitation", {
      token: invitation.token,
      name: `Graph collaborator ${index}`,
      password: account.password,
    });
    accounts.push(account);
  }
  const definition = {
    formatVersion: "agents-assemble.playbook/1",
    package: { id: `browser/${randomUUID()}`, version: "1.0.0" },
    inputs: {},
    outputs: {},
    dependencies: {},
    runtimeSlots: {},
    permissions: [],
    policy: {
      maxInvocations: 10,
      maxConcurrency: 1,
      maxExpressionDepth: 8,
      maxExpressionNodes: 100,
      referencedSpecChange: "pause_and_replan",
    },
    body: {
      id: "flow",
      type: "sequence",
      children: Array.from({ length: 99 }, (_, index) => ({
        id: `step_${index}`,
        type: "end",
        result: {
          literal: index === 90 ? JSON.parse('{"__proto__":{"retained":true}}') : "initial",
        },
      })),
    },
  };
  const draft = await api.post("/catalog/playbooks", { title, definition }),
    contexts = await Promise.all(
      accounts.map(() =>
        browser.newContext({ baseURL: info.project.use.baseURL ?? "http://localhost:5173" }),
      ),
    ),
    errors: string[] = [];
  try {
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const sent: number[] = [],
      arrived: number[] = [],
      samples: number[] = [];
    pages.forEach((page, index) => {
      page.on("websocket", (socket) => {
        socket.on("framesent", (event) => {
          const frame = JSON.parse(String(event.payload));
          if (frame.type === "graph") sent[index] = performance.now();
        });
        socket.on("framereceived", (event) => {
          const frame = JSON.parse(String(event.payload));
          if (frame.type === "sync" && frame.cursor === 5) arrived[index] = performance.now();
        });
      });
    });
    await Promise.all(
      pages.map(async (page, index) => {
        page.on("pageerror", (error) => errors.push(error.message));
        await login(page, accounts[index]);
        await page.goto(`/#/catalog/${draft.id}`);
        await expect(
          page.getByText("Graph saved through owner cursor 0", { exact: true }),
        ).toBeVisible();
      }),
    );
    const roundTrips: number[] = [];
    for (let index = 0; index < 5; index++) {
      const start = performance.now();
      await api.get("/health");
      roundTrips.push(performance.now() - start);
    }
    expect(Math.max(...roundTrips)).toBeLessThan(100);
    // Measure from the browser's exact command send to all replicas observing its owner cursor.
    const started = performance.now();
    await Promise.all(
      pages.map(async (page, index) => {
        await edit(page, index, `editor-${index}`);
      }),
    );
    await Promise.all(
      pages.map(async (page) => {
        await expect(
          page.getByText("Graph saved through owner cursor 5", { exact: true }),
        ).toBeVisible({ timeout: 2000 });
      }),
    );
    for (const start of sent) samples.push(Math.max(...arrived) - start);
    samples.sort((a, b) => a - b);
    expect(samples[Math.ceil(samples.length * 0.95) - 1]).toBeLessThan(2000);
    const persisted = await api.get(`/collaboration/catalog/${draft.id}`);
    expect(persisted.data.graph.entities).toHaveLength(100);
    for (let index = 0; index < 5; index++)
      expect(persisted.data.content.body.children[index].result.literal).toBe(`editor-${index}`);
    const history = await api.get(`/collaboration/catalog/${draft.id}/updates?cursor=0`);
    expect(
      new Set(history.items.map((item: { data: { actorId: string } }) => item.data.actorId)).size,
    ).toBe(5);
    await contexts[0].setOffline(true);
    await edit(pages[0], 6, "offline semantic edit");
    await expect(
      pages[0].getByText("1 graph edits awaiting durable acknowledgment", { exact: true }),
    ).toBeVisible();
    await edit(pages[1], 7, "acknowledged while peer offline");
    await expect(
      pages[1].getByText("Graph saved through owner cursor 6", { exact: true }),
    ).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 60000));
    const reconnect = performance.now();
    await contexts[0].setOffline(false);
    await Promise.all(
      pages.map((page) =>
        expect(page.getByText("Graph saved through owner cursor 7", { exact: true })).toBeVisible({
          timeout: 10000,
        }),
      ),
    );
    expect(performance.now() - reconnect).toBeLessThan(10000);
    const reconnectMs = performance.now() - reconnect;
    const accepted = await api.get(`/collaboration/catalog/${draft.id}`);
    expect(accepted.data.content.body.children[6].result.literal).toBe("offline semantic edit");
    expect(accepted.data.content.body.children[7].result.literal).toBe(
      "acknowledged while peer offline",
    );
    const expected = JSON.stringify(accepted.data.content);
    await Promise.all(
      pages.map(async (page) => {
        await page.getByRole("tab", { name: "Canonical JSON", exact: true }).click();
        await expect
          .poll(async () =>
            JSON.stringify(
              JSON.parse(
                await page.getByLabel("Canonical playbook JSON", { exact: true }).inputValue(),
              ),
            ),
          )
          .toBe(expected);
      }),
    );
    const directory = await mkdtemp(join(process.cwd(), ".generated-browser-playbook-"));
    try {
      const pendingDownload = pages[0].waitForEvent("download");
      await pages[0].getByRole("button", { name: "Export TypeScript", exact: true }).click();
      const download = await pendingDownload,
        file = join(directory, "playbook.ts");
      await download.saveAs(file);
      const result = await promisify(execFile)(process.execPath, [
        "--import=tsx",
        "--input-type=module",
        "-e",
        "const module = await import(process.argv[1]); process.stdout.write(JSON.stringify(module.playbook));",
        pathToFileURL(file).href,
      ]);
      expect(JSON.parse(result.stdout)).toEqual(accepted.data.content);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    const candidate = await api.post(`/collaboration/catalog/${draft.id}/candidates`, {
      epoch: accepted.data.epoch,
      expectedSequence: 7,
    });
    expect(candidate.data.content).toEqual(accepted.data.content);
    const version = await api.post(`/catalog/playbooks/${draft.id}/publish`, {
      candidateId: candidate.id,
      expectedHead: 0,
    });
    expect(version.data.definition).toEqual(candidate.data.content);
    const root = accepted.data.graph.root,
      first = accepted.data.graph.entities.find(
        (item: { fields: { id?: string } }) => item.fields.id === "step_0",
      ).entityId;
    const invalid = await api.post(`/collaboration/catalog/${draft.id}/graph`, {
      epoch: accepted.data.epoch,
      baseSequence: 7,
      command: {
        type: "batch",
        commands: [
          {
            type: "field",
            entityId: first,
            path: ["result", "literal"],
            value: "must not partially apply",
          },
          {
            type: "move",
            entityId: root,
            from: { parent: root, slot: "children" },
            to: { parent: root, slot: "children", index: 0 },
          },
        ],
      },
    });
    expect(invalid.status).toBe("conflict");
    const unchanged = await api.get(`/collaboration/catalog/${draft.id}`);
    expect(unchanged.data.sequence).toBe(7);
    expect(unchanged.data.content).toEqual(accepted.data.content);
    await info.attach("graph-pilot-local-measurements", {
      body: JSON.stringify({
        network: "local loopback",
        httpRoundTripsMs: roundTrips,
        connectedEditPropagationSamplesMs: samples,
        connectedDurationMs: Math.max(...arrived) - started,
        reconnectMs,
        nodeCount: 100,
        clients: 5,
      }),
      contentType: "application/json",
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
