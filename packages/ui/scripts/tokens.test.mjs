import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { stale } from "./gen-tokens.mjs"

test("generated CSS and Dart tokens match tokens/tokens.json", () => {
  assert.deepEqual(stale(), [], "run: pnpm --filter @unitravel/ui tokens")
})

// WCAG 2.2: 4.5:1 for text (1.4.3), 3:1 for control boundaries and focus indicators (1.4.11).
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const t = JSON.parse(readFileSync(new URL("../tokens/tokens.json", import.meta.url), "utf8"))

for (const [mode, v] of [["console light", t.console], ["console dark", t.dark]]) {
  test(`${mode}: text, controls and focus meet WCAG AA`, () => {
    for (const bg of ["--surface", "--surface-raised"]) {
      for (const fg of ["--ink", "--ink-muted", "--link"]) assert.ok(ratio(v[fg], v[bg]) >= 4.5, `${fg} on ${bg}: ${ratio(v[fg], v[bg]).toFixed(2)}`)
      assert.ok(ratio(v["--ring"], v[bg]) >= 3, `--ring on ${bg}`)
    }
    assert.ok(ratio(v["--ink-subtle"], v["--surface-raised"]) >= 4.5, "--ink-subtle on raised")
    assert.ok(ratio(v["--control-border"], v["--surface-raised"]) >= 3, "--control-border on raised")
    assert.ok(ratio(v["--chrome-ink"], v["--chrome"]) >= 4.5 && ratio(v["--chrome-muted"], v["--chrome"]) >= 4.5, "rail text")
    assert.ok(ratio(v["--primary-foreground"], v["--primary"]) >= 4.5, "primary button text")
  })
}
