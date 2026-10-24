import assert from "node:assert/strict"
import { test } from "node:test"
import { stale } from "./gen-tokens.mjs"

test("generated CSS and Dart tokens match tokens/tokens.json", () => {
  assert.deepEqual(stale(), [], "run: pnpm --filter @unitravel/ui tokens")
})
