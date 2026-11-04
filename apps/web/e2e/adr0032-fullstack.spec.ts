import { expect, test } from "@playwright/test"

import { DEV_HOST, dbQuery, STAFF, staffSession } from "../../api/test/client"
import { type ApifyMock, stackControl, startApifyMock } from "../../api/test/fixtures/apify/mock-server"

/**
 * ADR-0032 B2 (credential and connection test) on the local stack, with the Apify API replaced by a local mock (ADR-0029 A9). Nothing reaches Apify.
 * ADR-0034 removed the prewarm and the customer cache this spec used to fill, and a catalog tick would write mock rows into the real routes'
 * Postgres tables (rule 2), so the refresh path is covered in-process by apps/api/test/catalog.e2e.ts and not here.
 * Opt-in, because the API and worker must be started against the mock:
 *   APIFY_TOKEN= APIFY_BASE_URL=http://127.0.0.1:4191/v2 scripts/svc.sh restart api worker
 *   APIFY_MOCK_PORT=4191 npx playwright test e2e/adr0032-fullstack.spec.ts
 * The spec stores a placeholder credential the mock accepts (not an Apify token), turns Apify on and FAKE off for the run, and
 * restores all of it afterwards, including the budget ledger.
 */
const PORT = Number(process.env.APIFY_MOCK_PORT ?? 0)
const MOCK_CREDENTIAL = "local-mock-placeholder-not-an-apify-token"
const APIFY = "apify-google-flights"

test.describe.configure({ mode: "serial" })
test.skip(!PORT, "set APIFY_MOCK_PORT and start the API and worker with APIFY_BASE_URL pointing at it")

let mock: ApifyMock
let stack: Awaited<ReturnType<typeof stackControl>>
let restore: (() => Promise<void>) | undefined

test.beforeAll(async () => {
  test.setTimeout(240_000)
  mock = await startApifyMock(PORT, MOCK_CREDENTIAL)
  stack = await stackControl()
  await stack.snapshot()
  const dev = await staffSession(STAFF.developer, DEV_HOST)
  const settings = (await dev.get("/v1/dev/settings")).body
  const before = Object.fromEntries(await Promise.all(["fake", APIFY].map(async (id) => [id, (await dev.get(`/v1/dev/providers/${id}`)).body.enabled as boolean])))
  const hadCredential = (await dbQuery("select 1 from provider_credentials where provider_id = $1", [APIFY])).length > 0
  expect(hadCredential, "a stored Apify credential would be overwritten; run this on a stack without one").toBe(false)
  restore = async () => {
    const d = await staffSession(STAFF.developer, DEV_HOST)
    await d.patch(`/v1/dev/providers/${APIFY}`, { enabled: before[APIFY] })
    await d.patch("/v1/dev/providers/fake", { enabled: before.fake })
    await dbQuery("delete from provider_credentials where provider_id = $1", [APIFY])
    // The mock's runs are not real spend; keep them out of the Developer Panel run log.
    await dbQuery("delete from provider_runs where external_run_id like 'runMOCK%'")
    await d.put("/v1/dev/settings", settings)
  }

  expect((await dev.put(`/v1/dev/providers/${APIFY}/credentials`, { values: { token: MOCK_CREDENTIAL } })).status).toBe(200)
  // The free limits call proves the API talks to the mock before anything is spent: the mock answers $0.42.
  const probe = await dev.post(`/v1/dev/providers/${APIFY}/test`)
  expect(probe.status, JSON.stringify(probe.body)).toBe(200)
  expect(probe.body.monthlyUsageUsd).toBe(0.42)
  expect(mock.calls.some((c) => c.path === "/users/me/limits")).toBe(true)
  expect((await dev.patch(`/v1/dev/providers/${APIFY}`, { enabled: true })).status).toBe(200)
  expect((await dev.patch("/v1/dev/providers/fake", { enabled: false })).status).toBe(200)
})

test("the stored credential reaches the mock through the free limits call, and the connection test starts no run", async () => {
  expect(mock.calls.some((c) => c.path === "/users/me/limits")).toBe(true)
  expect(mock.calls.filter((c) => c.method === "POST" && c.path.includes("/runs"))).toEqual([])
})

test.afterAll(async () => {
  await restore?.()
  await stack?.restore()
  await mock?.close()
})
