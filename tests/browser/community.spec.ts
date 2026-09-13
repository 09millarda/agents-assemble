import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { z } from "zod";

const email = process.env.AA_BROWSER_EMAIL;
const password = process.env.AA_BROWSER_PASSWORD;
const envelope = z.object({ id: z.uuid(), data: z.record(z.string(), z.unknown()) });
async function client(request: APIRequestContext, userEmail: string, userPassword: string) {
  const response = await request.post("/api/v1/auth/login", {
    data: { email: userEmail, password: userPassword },
    headers: { "Idempotency-Key": randomUUID() },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const { token } = z.object({ token: z.string() }).parse(await response.json());
  const sessionResponse = await request.get("/api/v1/auth/session", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const session = z
    .object({ organizations: z.array(z.object({ id: z.uuid() })) })
    .parse(await sessionResponse.json());
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Organization-Id": session.organizations[0].id,
  };
  return {
    headers,
    async post(path: string, data: unknown): Promise<unknown> {
      const result = await request.post(`/api/v1${path}`, {
        data,
        headers: { ...headers, "Idempotency-Key": randomUUID() },
      });
      expect(result.ok(), await result.text()).toBe(true);
      return result.json();
    },
  };
}
async function login(page: Page, userEmail: string, userPassword: string) {
  await page.goto("/#/projects");
  await page.getByLabel("Email", { exact: false }).fill(userEmail);
  await page.getByLabel("Password", { exact: false }).fill(userPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
}
async function submit(page: Page, title: string, path: string) {
  const response = page.waitForResponse(
    (value) =>
      value.request().method() === "POST" && new URL(value.url()).pathname === `/api/v1${path}`,
  );
  await page.getByRole("dialog").getByRole("button", { name: title, exact: true }).click();
  const result = await response;
  expect(result.ok(), await result.text()).toBe(true);
  return result.json();
}

test("public release review, independent member participation, fork and reasoned moderation use real Community controls", async ({
  page,
  browser,
  request,
}) => {
  test.skip(
    !email || !password,
    "Requires the local bootstrapped API and browser qualification credentials.",
  );
  if (!email || !password) throw new Error("Browser credentials missing");
  const suffix = randomUUID().slice(0, 8);
  const publisher = await client(request, email, password);
  const startersResponse = await request.get("/api/v1/catalog/starters", {
    headers: publisher.headers,
  });
  const starters = z
    .object({ items: z.array(z.object({ name: z.string(), definition: z.unknown() })) })
    .parse(await startersResponse.json());
  const definition = starters.items[0]?.definition;
  expect(definition).toBeDefined();
  const draft = envelope.parse(
    await publisher.post("/catalog/playbooks", { title: `Community source ${suffix}`, definition }),
  );
  const frozen = envelope.parse(
    await publisher.post(`/collaboration/catalog/${draft.id}/candidates`, {
      epoch: draft.data.epoch,
      expectedSequence: 0,
    }),
  );
  const version = envelope.parse(
    await publisher.post(`/catalog/playbooks/${draft.id}/publish`, {
      candidateId: frozen.id,
      expectedHead: 0,
    }),
  );
  // The public rating must come from outside the publishing organization. Bootstrap
  // an independent local fixture organization through the supported operator CLI.
  const reviewOwner = `community-owner-${suffix}@example.test`;
  const reviewPassword = `community-review-password-${suffix}`;
  await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/bootstrap.ts"], {
    env: {
      ...process.env,
      AA_ADMIN_EMAIL: reviewOwner,
      AA_ADMIN_PASSWORD: reviewPassword,
      AA_ADMIN_NAME: "Community review operator",
      AA_ORGANIZATION: `Community reviewers ${suffix}`,
    },
  });
  const reviewAdmin = await client(request, reviewOwner, reviewPassword);
  const invite = async (role: "member" | "moderator") => {
    const invitedEmail = `community-${role}-${suffix}@example.test`;
    const invitation = z
      .object({ token: z.string() })
      .parse(await reviewAdmin.post("/invitations", { email: invitedEmail, role }));
    const accepted = await request.post("/api/v1/auth/accept-invitation", {
      data: { token: invitation.token, name: `Community ${role}`, password: reviewPassword },
      headers: { "Idempotency-Key": randomUUID() },
    });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    return invitedEmail;
  };
  const reviewerEmail = await invite("member"),
    moderatorEmail = await invite("moderator");
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:5173").origin;
  const device = test.info().project.use;
  const contextOptions = {
    baseURL: origin,
    viewport: device.viewport,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    deviceScaleFactor: device.deviceScaleFactor,
    userAgent: device.userAgent,
  };
  const anonymous = await browser.newContext(contextOptions),
    reviewer = await browser.newContext(contextOptions),
    moderator = await browser.newContext(contextOptions);
  try {
    const anonymousPage = await anonymous.newPage(),
      reviewPage = await reviewer.newPage(),
      moderatorPage = await moderator.newPage();
    const pages = [page, anonymousPage, reviewPage, moderatorPage];
    const pageErrors: string[] = [];
    for (const surface of pages) surface.on("pageerror", (error) => pageErrors.push(error.message));
    // New contexts use the same actual preview origin, with no shared session state.
    await Promise.all([
      anonymousPage.goto(origin),
      reviewPage.goto(origin),
      moderatorPage.goto(origin),
    ]);
    await login(page, email, password);
    await page.goto("/#/community");
    await page.getByRole("button", { name: "Prepare public release", exact: true }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Organization version").selectOption(version.id);
    await form.getByLabel("Public namespace").fill(`browser-${suffix}`);
    const name = `Community browser ${suffix}`;
    await form.getByLabel("Package name").fill(name);
    await form.getByLabel("Summary").fill("A reviewed portable starter for browser qualification.");
    await form.getByLabel("Tags").fill('["browser-qualification"]');
    await form.getByLabel("Public author name").fill("Browser publisher");
    await form.getByLabel("Public organization name").fill("Browser Acceptance");
    const prepared = envelope.parse(
      await submit(page, "Prepare public release", "/community/candidates"),
    );
    await expect(
      page.getByText("Review the exact public candidate", { exact: true }),
    ).toBeVisible();
    await page.getByText("Complete redacted publication inventory", { exact: true }).click();
    await expect(
      page.getByText(String(prepared.data.digest), { exact: false }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Publish reviewed candidate", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(prepared.id);
    await expect(page.getByRole("dialog")).toContainText(String(prepared.data.digest));
    const release = z
      .object({ id: z.uuid(), root: z.string(), closureDigest: z.string() })
      .parse(await submit(page, "Publish reviewed candidate", "/community/releases"));
    expect(release.root).toBe(prepared.data.root);
    expect(release.closureDigest).toBe(prepared.data.closureDigest);
    const releasePath = `${origin}/#/community/${release.id}`;
    await anonymousPage.goto(`${origin}/#/community`);
    await anonymousPage.getByLabel("Search playbooks").fill(name);
    await anonymousPage.getByRole("button", { name: "Search", exact: true }).click();
    await anonymousPage.getByRole("link", { name, exact: true }).click();
    await expect(anonymousPage.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(
      anonymousPage.getByRole("button", { name: "Post comment", exact: true }),
    ).toHaveCount(0);
    await login(reviewPage, reviewerEmail, reviewPassword);
    await reviewPage.goto(releasePath);
    const comment = `An independent review of the exact package ${suffix}.`;
    await reviewPage.getByLabel("Public comment").fill(comment);
    const commented = reviewPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/v1/community/releases/${release.id}/comments`,
    );
    await reviewPage.getByRole("button", { name: "Post comment", exact: true }).click();
    expect((await commented).ok()).toBe(true);
    await expect(reviewPage.getByText(comment, { exact: true })).toBeVisible();
    await reviewPage.getByRole("button", { name: "Rate reviewed version", exact: true }).click();
    await reviewPage.getByRole("dialog").getByLabel("Rating").selectOption("5");
    await submit(reviewPage, "Rate reviewed version", `/community/releases/${release.id}/rating`);
    await reviewPage.getByRole("button", { name: "Save private bookmark", exact: true }).click();
    await submit(reviewPage, "Save private bookmark", `/community/releases/${release.id}/bookmark`);
    await reviewPage.goto(`${origin}/#/community`);
    await reviewPage.getByRole("tab", { name: "Private bookmarks" }).click();
    await expect(reviewPage.getByRole("link", { name: release.id, exact: true })).toBeVisible();
    await anonymousPage.reload();
    await expect(anonymousPage.getByText(comment, { exact: true })).toBeVisible();
    await page.goto(releasePath);
    await page.getByRole("button", { name: "Fork into editable draft", exact: true }).click();
    const forkTitle = `My reviewed fork ${suffix}`;
    await page.getByRole("dialog").getByLabel("Draft title").fill(forkTitle);
    const fork = envelope.parse(
      await submit(page, "Fork into editable draft", `/community/releases/${release.id}/fork`),
    );
    await expect(page).toHaveURL(new RegExp(`#/catalog/${fork.id}$`));
    await expect(page.getByRole("heading", { name: forkTitle, exact: true })).toBeVisible();
    await login(moderatorPage, moderatorEmail, reviewPassword);
    await moderatorPage.goto(releasePath);
    const moderate = async (action: "quarantine" | "restore") => {
      await moderatorPage.getByRole("button", { name: "Moderate release", exact: true }).click();
      await moderatorPage.getByRole("dialog").getByLabel("Decision").selectOption(action);
      await moderatorPage.getByRole("dialog").getByLabel("Category").fill("qualification");
      await moderatorPage
        .getByRole("dialog")
        .getByLabel("Reason")
        .fill(`${action} exact reviewed release during browser qualification`);
      await submit(moderatorPage, "Moderate release", "/community/moderation");
    };
    await moderate("quarantine");
    await expect(moderatorPage.getByText("quarantined", { exact: true })).toBeVisible();
    await anonymousPage.reload();
    await expect(anonymousPage.getByText("quarantined", { exact: true })).toBeVisible();
    await expect(
      anonymousPage.getByRole("button", { name: "Export package", exact: true }),
    ).toHaveCount(0);
    await moderate("restore");
    await expect(moderatorPage.getByText("active", { exact: true })).toBeVisible();
    await anonymousPage.reload();
    await expect(anonymousPage.getByText(comment, { exact: true })).toBeVisible();
    await expect(
      anonymousPage.getByRole("button", { name: "Export package", exact: true }),
    ).toBeVisible();
    const publicState = await request.get(`/api/v1/community/releases/${release.id}`);
    expect(
      z
        .object({ rating: z.object({ average: z.number(), count: z.number() }) })
        .parse(await publicState.json()).rating,
    ).toEqual({ average: 5, count: 1 });
    expect(pageErrors).toEqual([]);
    for (const surface of pages)
      expect(
        await surface.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
  } finally {
    await Promise.all([anonymous.close(), reviewer.close(), moderator.close()]);
  }
});
