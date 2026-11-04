// Manual live smoke test of the Apify Google Flights actor (ADR-0034, spec §10.6). NEVER run in CI and never by an agent: it spends real money
// (at most $0.02, enforced by maxTotalChargeUsd).
//
//   pnpm --filter @unitravel/api build
//   APIFY_TOKEN=... node scripts/apify-smoke.ts --yes
//
// It sends two route-dates with maxResults 1 and asserts what the cost-control fields promise: no row from KAYAK, and a run cost of
// rows x $0.001 + $0.001. When DATABASE_URL is reachable it also writes a `smoke` row to provider_usage_ledger.
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const API_DIST = new URL("../apps/api/dist/", import.meta.url).pathname

const ROW_USD = 0.001
const START_USD = 0.001
const MAX_CHARGE_USD = 0.02
const POLL_MS = 5_000
const DEADLINE_MS = 5 * 60_000

if (process.env.CI) {
  console.error("apify-smoke: refusing to run when CI is set. This script spends real money and is manual-only.")
  process.exit(2)
}
if (!process.argv.includes("--yes")) {
  console.error("apify-smoke: this starts a real, paid Apify run (at most $0.02). Re-run with --yes to confirm.")
  process.exit(2)
}
const token = process.env.APIFY_TOKEN
if (!token) {
  console.error("apify-smoke: set APIFY_TOKEN in the environment (it is never printed or stored).")
  process.exit(2)
}

const { ApifyClient } = require(`${API_DIST}modules/suppliers/adapters/apify/client.js`) as { ApifyClient: new (token: string) => any }
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const routes = [
  { origin: "IST", destination: "LHR", departureDate: day(14) },
  { origin: "IKA", destination: "IST", departureDate: day(14) },
]

const failures: string[] = []
const assert = (ok: boolean, what: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures.push(what) }

async function main() {
  const client = new ApifyClient(token!)
  const before = await client.limits()
  console.log(`cycle ends ${before.cycleEnd}; usage ${before.monthlyUsageUsd} of ${before.maxMonthlyUsageUsd} USD`)

  // The client forces the four KAYAK/booking/return fields off and pins the build; this run proves the actor honours them.
  const run = await client.startRun({
    routes, maxResults: 1, sortBy: "best", currency: "USD", market: "GB", adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0, cabinClass: "economy", maxStops: "any",
    includePriceInsights: true, includeSearchSummary: false, includeRunSummary: true,
  }, MAX_CHARGE_USD)
  console.log(`started run ${run.id}`)

  const started = Date.now()
  let status = run
  while (status.status === "READY" || status.status === "RUNNING") {
    if (Date.now() - started > DEADLINE_MS) throw new Error("run did not finish within 5 minutes")
    await new Promise((r) => setTimeout(r, POLL_MS))
    status = await client.runStatus(run.id)
  }
  console.log(`run ${status.status}`)
  const items = (await client.items(status.defaultDatasetId)) as Record<string, unknown>[]
  const billable = items.filter((r) => r.type !== "notice" && r.type !== "error").length
  const flights = items.filter((r) => r.type === "flight")
  const expected = Math.round((billable * ROW_USD + START_USD) * 1e6) / 1e6
  const actual = typeof status.usageTotalUsd === "number" ? Math.round(status.usageTotalUsd * 1e6) / 1e6 : null

  assert(status.status === "SUCCEEDED", "run succeeded")
  assert(flights.every((r) => r.dataSource !== "kayak") && !items.some((r) => String(r.dataSource ?? "").toLowerCase() === "kayak"), "no row has dataSource \"kayak\" (the KAYAK fallback is off)")
  assert(flights.length <= routes.length, `at most maxResults x routes flight rows (got ${flights.length})`)
  assert(actual !== null && Math.abs(actual - expected) < 1e-6, `run cost ${actual} equals rows x ${ROW_USD} + ${START_USD} = ${expected} (${billable} billable rows)`)

  const after = await client.limits()
  console.log(`usage now ${after.monthlyUsageUsd} USD`)
  await ledger(status.id, billable, expected, actual, failures.length === 0)
}

/** Best effort: the smoke test is still valid without a database. */
async function ledger(apifyRunId: string, rows: number, est: number, actual: number | null, ok: boolean) {
  if (!process.env.DATABASE_URL) { console.log("DATABASE_URL not set; no ledger row written"); return }
  try {
    const { createDb, providerUsageLedger } = require(`${API_DIST.replace("apps/api/dist/", "packages/db/dist/")}index.js`) as { createDb: (url: string) => { db: any; pool: { end(): Promise<void> } }; providerUsageLedger: unknown }
    const { db, pool } = createDb(process.env.DATABASE_URL)
    await db.insert(providerUsageLedger).values({
      provider: "apify-google-flights", purpose: "smoke", apifyRunId, slotIds: [], maxResults: 1, rowsBilled: rows, estCostUsd: String(est), maxChargeUsd: String(MAX_CHARGE_USD),
      actualCostUsd: actual === null ? null : String(actual), status: ok ? "SUCCEEDED" : "FAILED", finishedAt: new Date(),
    })
    await pool.end()
    console.log("ledger row written (purpose smoke)")
  } catch (err) {
    console.log(`ledger row not written: ${(err as Error).message}`)
  }
}

main().then(() => process.exit(failures.length ? 1 : 0), (err) => { console.error(`apify-smoke failed: ${(err as Error).message}`); process.exit(1) })
