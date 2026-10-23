import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.spec.ts"], environment: "node" } },
      { test: { name: "e2e", globalSetup: ["test/global-setup.ts"], include: ["test/**/*.e2e.ts"], environment: "node", testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false, isolate: false } },
    ],
  },
})
