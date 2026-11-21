import { defineConfig } from "@playwright/test"

// Customer portal specs (ADR-0040) mock every /api/v1 call in the browser, so they need only a running web server
// (WEB_URL, default http://localhost:4000) and none of the API, Redis or Postgres that the main config's globalSetup requires.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /portal\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.WEB_URL ?? "http://localhost:4000", trace: "retain-on-failure" },
})
