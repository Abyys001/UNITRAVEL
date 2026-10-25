export interface NamePair { en: string; fa: string }

/** Staff-facing and system values that reach customers or staff as bare codes; each gets an English and a Persian label. */
const LABELS: Record<string, Record<string, NamePair>> = {
  client: {
    web: { en: "the web", fa: "وب" }, console: { en: "the console", fa: "کنسول" }, mobile: { en: "the mobile app", fa: "اپ موبایل" },
  },
  decision: {
    RELEASE: { en: "released", fa: "آزادسازی" }, DECLINE: { en: "declined", fa: "رد" },
  },
  trigger: {
    SCREENING: { en: "screening", fa: "غربالگری" }, POLICY: { en: "policy", fa: "سیاست" }, LANE: { en: "lane", fa: "مسیر" }, GOODS: { en: "goods", fa: "کالا" },
  },
}

const ROUTE_SEPARATOR = /\s*([→⇄])\s*/

/** Maps each place in "A → B" or "A ⇄ B" to its English and Persian name; unknown places stay as written. */
export function localiseRoute(label: string, names: Map<string, NamePair>): NamePair {
  const parts = label.split(ROUTE_SEPARATOR)
  const map = (k: "en" | "fa") => parts.map((p, i) => (i % 2 === 1 ? ` ${p} ` : (names.get(p.trim().toLowerCase())?.[k] ?? p))).join("")
  return { en: map("en"), fa: map("fa") }
}

/** Adds `<name>_en` and `<name>_fa` variants; `varsFor` picks the one matching the recipient's language, so no English leaks into Persian text. */
export function localisedVars(vars: Record<string, string | number | undefined>, names: Map<string, NamePair>): Record<string, string> {
  const out: Record<string, string> = {}
  const route = vars.route
  if (typeof route === "string" && route) {
    const r = localiseRoute(route, names)
    out.route_en = r.en
    out.route_fa = r.fa
  }
  for (const [key, table] of Object.entries(LABELS)) {
    const v = vars[key]
    const hit = typeof v === "string" ? table[v] ?? table[v.toLowerCase()] ?? table[v.toUpperCase()] : undefined
    if (hit) { out[`${key}_en`] = hit.en; out[`${key}_fa`] = hit.fa }
  }
  return out
}
