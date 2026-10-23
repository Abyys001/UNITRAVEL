import { defineConfig, devices } from "@playwright/test"

// Runs against the locally started stack (scripts/svc.sh start api worker console); nothing here boots servers.
// *.localhost resolves to 127.0.0.1 in Chromium, so the admin and dev hosts work without /etc/hosts entries.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "../api/test/global-setup.ts",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
})
