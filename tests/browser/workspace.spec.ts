import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { z } from "zod";

const email = process.env.AA_BROWSER_EMAIL;
const password = process.env.AA_BROWSER_PASSWORD;
const envelope = z.object({
  id: z.string(),
  version: z.number(),
  data: z.record(z.string(), z.unknown()),
});
async function login(page: Page, userEmail = email, userPassword = password) {
  if (!userEmail || !userPassword)
    throw new Error(
      "Set AA_BROWSER_EMAIL and AA_BROWSER_PASSWORD for authenticated browser acceptance",
    );
  await page.goto("/#/projects");
  await page.getByLabel("Email", { exact: false }).fill(userEmail);
  await page.getByLabel("Password", { exact: false }).fill(userPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
}
async function api(request: APIRequestContext) {
  const loginResponse = await request.post("/api/v1/auth/login", {
    headers: { "Idempotency-Key": randomUUID() },
    data: { email, password },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const { token } = z.object({ token: z.string() }).parse(await loginResponse.json());
  const sessionResponse = await request.get("/api/v1/auth/session", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const session = z
    .object({ organizations: z.array(z.object({ id: z.string() })) })
    .parse(await sessionResponse.json());
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
  };
}
test("public sign-in and navigation remain keyboard accessible without horizontal overflow", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to your workspace" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  if (info.project.name === "narrow") {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Installation & help" }).click();
  } else await page.getByRole("link", { name: "Installation & help" }).click();
  await expect(page.getByRole("heading", { name: "Installation & help" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
test.describe("real API browser journeys", () => {
  test.skip(
    !email || !password,
    "Requires a bootstrapped local API and AA_BROWSER_EMAIL/AA_BROWSER_PASSWORD; no mocked server is used.",
  );
  test("create a project and preserve recorded policy revision", async ({ page }) => {
    await login(page);
    const name = `Browser project ${randomUUID().slice(0, 8)}`;
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await page.getByLabel("Project name").fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Policy & lifecycle" }).click();
    await page.getByRole("button", { name: "Suspend project", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Reason").fill("Browser acceptance policy cutoff");
    const suspension = page.waitForResponse(
      (response) => response.url().endsWith("/suspend") && response.request().method() === "POST",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Suspend project", exact: true })
      .click();
    if ((await suspension).status() === 409) {
      await expect(page.getByRole("alert")).toContainText("resource changed");
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      const currentProject = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1${new URL(page.url()).hash.slice(1)}`) &&
          response.request().method() === "GET",
      );
      await page.getByRole("button", { name: "Refresh project" }).click();
      await currentProject;
      await page.getByRole("button", { name: "Suspend project", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByLabel("Reason")
        .fill("Reviewed current consumer checkpoint before retrying suspension");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Suspend project", exact: true })
        .click();
    }
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.reload();
    await expect(page.getByText(/Policy generation 2/)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
  });
  test("author visually, freeze an immutable candidate, and publish the exact version", async ({
    page,
    request,
  }) => {
    const client = await api(request);
    const name = `Browser workflow ${randomUUID().slice(0, 8)}`;
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
      body: { id: "flow", type: "sequence", children: [] },
    };
    const draft = envelope.parse(
      await client.post("/catalog/playbooks", { title: name, definition }),
    );
    await login(page);
    await page.goto(`/#/catalog/${draft.id}`);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByLabel("New node kind").selectOption("end");
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    await expect(page.getByText("Owner cursor 1", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Review & submit" }).click();
    await page.getByRole("button", { name: "Freeze review candidate" }).click();
    await page.getByRole("button", { name: "Publish organization version", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Publish organization version", exact: true })
      .click();
    await expect(page.getByText("Submitted head 1", { exact: true })).toBeVisible();
    const published = await request.get("/api/v1/catalog/versions", { headers: client.headers });
    const items = z.object({ items: z.array(envelope) }).parse(await published.json()).items;
    expect(
      items.some(
        (item) =>
          z.object({ package: z.object({ id: z.string() }) }).parse(item.data.definition).package
            .id === definition.package.id,
      ),
    ).toBeTruthy();
  });
  test("five browser replicas retain acknowledged Markdown through a sixty-second disconnect", async ({
    browser,
    request,
  }, info) => {
    test.skip(
      info.project.name !== "desktop",
      "Transport qualification runs once; layout journeys run at both widths.",
    );
    const client = await api(request);
    const title = `Concurrent planning ${randomUUID().slice(0, 8)}`;
    const draft = envelope.parse(
      await client.post("/knowledge/documents", { title, content: "Shared plan\n" }),
    );
    const users = [{ email, password }];
    for (let index = 1; index < 5; index++) {
      const memberEmail = `browser-member-${randomUUID()}@example.test`;
      const memberPassword = `browser-member-password-${randomUUID()}`;
      const invitation = z
        .object({ token: z.string() })
        .parse(await client.post("/invitations", { email: memberEmail, role: "member" }));
      const accepted = await request.post("/api/v1/auth/accept-invitation", {
        headers: { "Idempotency-Key": randomUUID() },
        data: {
          token: invitation.token,
          name: `Browser collaborator ${index}`,
          password: memberPassword,
        },
      });
      expect(accepted.ok(), await accepted.text()).toBeTruthy();
      users.push({ email: memberEmail, password: memberPassword });
    }
    const contexts = await Promise.all(
      Array.from({ length: 5 }, () => browser.newContext({ baseURL: "http://localhost:5173" })),
    );
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      await Promise.all(
        pages.map(async (page, index) => {
          await login(page, users[index].email, users[index].password);
          await page.goto(`/#/documents/${draft.id}`);
          await expect(page.getByLabel("Collaborative Markdown")).toHaveValue("Shared plan\n");
        }),
      );
      await contexts[0].setOffline(true);
      await pages[1]
        .getByLabel("Collaborative Markdown")
        .fill("Shared plan\nAcknowledged while a collaborator is offline\n");
      await expect(pages[1].getByText(/Saved through owner cursor [1-9]/)).toBeVisible();
      await Promise.all(
        pages
          .slice(2)
          .map((page) =>
            expect(page.getByLabel("Collaborative Markdown")).toHaveValue(
              "Shared plan\nAcknowledged while a collaborator is offline\n",
            ),
          ),
      );
      await pages[0]
        .getByLabel("Collaborative Markdown")
        .fill("Shared plan\nOffline draft survives reconnection\n");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      const reconnectedAt = Date.now();
      await contexts[0].setOffline(false);
      for (const page of pages) {
        await expect(page.getByLabel("Collaborative Markdown")).toHaveValue(
          /Acknowledged while a collaborator is offline/,
          { timeout: 10_000 },
        );
        await expect(page.getByLabel("Collaborative Markdown")).toHaveValue(
          /Offline draft survives reconnection/,
          { timeout: 10_000 },
        );
      }
      expect(Date.now() - reconnectedAt).toBeLessThan(10_000);
      const values = await Promise.all(
        pages.map((page) => page.getByLabel("Collaborative Markdown").inputValue()),
      );
      expect(new Set(values).size).toBe(1);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
