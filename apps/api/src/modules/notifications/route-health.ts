/** Runbook trigger "SMS route failure" (ch. 30.7): delivery rate below 80% for a route over 30 minutes. */
export const ROUTE_HEALTH = { windowMinutes: 30, minSample: 20, threshold: 0.8, alertTtlSeconds: 3600 } as const

export interface RouteStatusCount {
  route: string
  status: string
  n: number
}

const OK = new Set(["SENT", "DELIVERED"])
const FAILED = new Set(["FAILED", "UNDELIVERABLE"])

/**
 * Routes whose success rate is under the threshold. QUEUED and SKIPPED rows are not delivery attempts and are left
 * out; SENT counts as a success because not every provider returns a delivery report.
 */
export function degradedRoutes(rows: RouteStatusCount[], minSample: number = ROUTE_HEALTH.minSample, threshold: number = ROUTE_HEALTH.threshold): { route: string; rate: number; sample: number }[] {
  const byRoute = new Map<string, { ok: number; failed: number }>()
  for (const r of rows) {
    const c = byRoute.get(r.route) ?? { ok: 0, failed: 0 }
    if (OK.has(r.status)) c.ok += r.n
    else if (FAILED.has(r.status)) c.failed += r.n
    byRoute.set(r.route, c)
  }
  const out: { route: string; rate: number; sample: number }[] = []
  for (const [route, { ok, failed }] of byRoute) {
    const sample = ok + failed
    if (sample < minSample) continue
    const rate = ok / sample
    if (rate < threshold) out.push({ route, rate: Math.round(rate * 100), sample })
  }
  return out.sort((a, b) => a.route.localeCompare(b.route))
}
