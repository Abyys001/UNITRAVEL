import type * as s from "../schema"

/**
 * ADR-0014: the FAKE supplier and sandbox credentials exist only with APP_ENV=local. Deployed hosts (staging and
 * production) get live-environment rows, disabled until a live credential is entered in the Developer Panel.
 */
export function providerSeedRows(appEnv = "local"): (typeof s.providers.$inferInsert)[] {
  const local = appEnv === "local"
  const envFor: "test" | "production" = local ? "test" : "production"
  const rows: (typeof s.providers.$inferInsert)[] = [
    ...(local ? [{ id: "fake", name: "Fake supplier (local and tests only)", environment: "test" as const, enabled: true, priority: 1, capabilities: { search: true, price: true, seatMap: true, order: false }, limits: { timeoutMs: 6000, maxConcurrent: 8, rps: 20, dailyBudget: 100000, lookToBookAlert: 1000 }, markets: { pointOfSale: "GB", currency: "GBP", originRegions: [], destinationRegions: [] } }] : []),
    { id: "duffel", name: "Duffel", environment: envFor, enabled: false, priority: 2, capabilities: { search: true, price: true, seatMap: true, order: false }, limits: { timeoutMs: 10000, maxConcurrent: 6, rps: 5, dailyBudget: 3000, lookToBookAlert: 1500 }, markets: { pointOfSale: "GB", currency: "GBP", originRegions: [], destinationRegions: [] } },
    { id: "amadeus-enterprise", name: "Amadeus Enterprise (Master Pricer)", environment: envFor, enabled: false, priority: 3, capabilities: { search: true, price: true, seatMap: false, order: false }, limits: { timeoutMs: 12000, maxConcurrent: 4, rps: 2, dailyBudget: 2000, lookToBookAlert: 1000 }, markets: { pointOfSale: "GB", currency: "GBP", originRegions: [], destinationRegions: [] } },
    { id: "manual", name: "Manual inventory (staff-entered)", environment: "production" as const, enabled: true, priority: 0, capabilities: { search: false, price: false, seatMap: false, order: false }, limits: { timeoutMs: 0, maxConcurrent: 0, rps: 0, dailyBudget: 0, lookToBookAlert: 0 }, markets: { pointOfSale: "GB", currency: "GBP", originRegions: [], destinationRegions: [] } },
  ]
  // ADR-0015: every provider seeded today serves flights.
  return rows.map((r) => ({ ...r, vertical: "FLIGHT" as const }))
}

/** ADR-0014: demo accounts are seeded only on a developer machine or CI, never on a deployed host. */
export const shouldSeedDemo = (appEnv = "local", seedDemo?: string) => appEnv === "local" && seedDemo !== "0"
