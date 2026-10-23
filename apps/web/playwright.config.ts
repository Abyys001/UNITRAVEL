import { defineConfig, devices } from "@playwright/test"

// Runs against the locally started stack (scripts/svc.sh start api worker web); nothing here boots servers.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "../api/test/global-setup.ts",
  use: { baseURL: process.env.WEB_URL ?? "http://localhost:4000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
})
