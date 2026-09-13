import { expect, test } from "@playwright/test";
import { z } from "zod";

const email = process.env.AA_BROWSER_EMAIL;
const password = process.env.AA_BROWSER_PASSWORD;
test("operations separates API availability from observed worker activity", async ({
  page,
}, info) => {
  test.skip(!email || !password, "Requires the local API, running worker and browser credentials.");
  if (!email || !password) throw new Error("Browser credentials missing");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/projects");
  await page.getByLabel("Email", { exact: false }).fill(email);
  await page.getByLabel("Password", { exact: false }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  if (info.project.name === "narrow")
    await page.getByRole("button", { name: "Open navigation" }).click();
  const response = page.waitForResponse(
    (value) => new URL(value.url()).pathname === "/api/v1/operations",
  );
  await page.getByRole("link", { name: "Operations", exact: true }).click();
  const result = await response;
  expect(result.ok()).toBe(true);
  const data = z
    .object({
      contexts: z.array(
        z.object({
          context: z.string(),
          worker: z.object({
            status: z.enum(["unknown", "recent", "stale"]),
            lastSeen: z.iso.datetime().nullable(),
          }),
        }),
      ),
    })
    .parse(await result.json());
  await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
  await expect(page.getByText("Database: connected", { exact: false })).toBeVisible();
  await expect(page.getByText("Worker last cycle", { exact: true })).toHaveCount(
    data.contexts.length,
  );
  await expect(page.getByText("recent", { exact: true })).toHaveCount(data.contexts.length);
  await expect(page.locator("time[datetime]")).toHaveCount(data.contexts.length);
  await expect(
    page.getByText("API availability and worker activity are reported separately.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath("operations.png"), fullPage: true });
  expect(errors).toEqual([]);
});
