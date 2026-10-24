import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

// WCAG 2.2 AA automated pass (ch. 32.1); manual screen-reader passes stay a per-release task.
const PAGES = ["/en", "/fa", "/en/sign-in", "/fa/sign-in", "/en/cargo", "/en/terms", "/en/privacy", "/en/credits", "/fa/credits"]

for (const path of PAGES) {
  test(`no serious accessibility violations on ${path} @mobile`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
    const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
  })
}
