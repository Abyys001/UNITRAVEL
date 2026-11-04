import swc from "unplugin-swc"
import { defineConfig } from "vitest/config"

// The in-process API of the catalog e2e (test/catalog*.e2e.ts) needs decorator metadata for Nest's constructor injection; esbuild does not emit it.
const decorators = swc.vite({ jsc: { target: "es2023", parser: { syntax: "typescript", decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } } })

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.spec.ts"], environment: "node" } },
      { plugins: [decorators], test: { name: "e2e", globalSetup: ["test/global-setup.ts"], include: ["test/**/*.e2e.ts"], environment: "node", testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false, isolate: false } },
    ],
  },
})
