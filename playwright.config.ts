import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: ".local/browser-results",
  use: {
    baseURL: process.env.AA_BROWSER_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
      args: ["--no-sandbox"],
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 980 } } },
    { name: "narrow", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run build --workspace @aa/web && npm run preview --workspace @aa/web",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
