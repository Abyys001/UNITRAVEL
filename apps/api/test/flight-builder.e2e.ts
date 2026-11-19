import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { FlightBuilderCaptureInput } from "@unitravel/contracts"

import { AppError } from "../src/core/errors"
import { AuditService } from "../src/modules/audit/audit.service"
import { FB_JOBS, FlightBuilderJobsService } from "../src/modules/catalog/flight-builder-jobs.service"
import { FlightBuilderService } from "../src/modules/catalog/flight-builder.service"
import { normalise } from "../src/modules/suppliers/adapters/flight-builder/normalise"
import { UnitOfWork } from "../src/core/infra.module"
import { cleanupTestData, type Catalog, inDays, makeCatalog, offer, seedTestRoutes, slotId } from "./catalog-harness"
import { dbQuery } from "./client"

/**
 * ADR-0037 against the real database: staff captures and feed refreshes share a slot (FEED refresh never retires STAFF, STAFF wins a
 * duplicate, a provider replacement still retires old FEED rows), the freshness sweep, and the gate that keeps sync off: settings and the
 * refresh endpoint refuse, and the scheduled job records BLOCKED without any fetch. Runs on the made-up TBZ→SAW route; settings and
 * authorisation are stubbed so the shared rows are never touched.
 */
let c: Catalog
let ids: Record<string, string>
let fb: FlightBuilderService
let staffId: string
const D = inDays(3)
const NOW = new Date()
const WHO = () => ({ userId: staffId, ip: "10.0.0.1" })

const bag = { segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } }, cabin: { status: "UNKNOWN" } }
const capture = (over: { number?: string; dep?: string; arr?: string; deadline?: string; observedAt?: string; fares?: object[] } = {}) =>
  FlightBuilderCaptureInput.parse({
    observedAt: over.observedAt ?? NOW.toISOString(),
    segments: [{ carrier: "TK", flightNumber: over.number ?? "1979", from: "TBZ", to: "SAW", departLocal: `${D}T${over.dep ?? "08:40"}`, arriveLocal: `${D}T${over.arr ?? "11:55"}` }],
    fares: over.fares ?? [{
      cabin: "ECONOMY", bookingClasses: ["Y"], seats: ["9"], fareType: "PUB", totalMinor: 21000, currency: "EUR", baggage: [bag],
      change: { state: "UNKNOWN" }, refund: { state: "NOT_ALLOWED" }, ...(over.deadline ? { ticketingDeadline: over.deadline } : {}),
    }],
  })
const staffWrite = (input = capture(), now = NOW) =>
  c.write.writeStaffOption({ capture: normalise(input, { reference: c.reference.lookup(), confirmedBy: staffId, now }), actorUserId: staffId, observedAt: new Date(input.observedAt), now })
const rows = (slot: string) => dbQuery<{ id: string; capture: string; is_current: boolean; identity_key: string }>("select id, capture, is_current, identity_key from flight_results where slot_id = $1 order by identity_key", [slot])
const snapshotIds = async (slot: string) => ((await dbQuery<{ payload: { id: string }[] }>("select payload from catalog_public_snapshots where slot_id = $1", [slot]))[0]?.payload ?? []).map((p) => p.id)
const fareStatus = (resultId: string) => dbQuery<{ status: string }>("select status from flight_result_fares where result_id = $1 order by position", [resultId]).then((r) => r.map((x) => x.status))
const feed = (o: { number?: string; dep?: string; arr?: string; minor?: number; provider?: string } = {}) => {
  const f = offer({ from: "TBZ", to: "SAW", date: D, dep: o.dep ?? "08:40", arr: o.arr ?? "11:55", number: o.number ?? "1979", minor: o.minor })
  return o.provider ? { ...f, source: { ...f.source, provider: o.provider, providerOfferId: `${o.provider}|${f.source.providerOfferId}` } } : f
}

beforeAll(async () => {
  c = await makeCatalog()
  ids = await seedTestRoutes(c)
  staffId = (await dbQuery<{ id: string }>("select id from users limit 1"))[0]!.id
  fb = new FlightBuilderService(c.db as never, new UnitOfWork(c.db as never), new AuditService(c.db as never), { view: async () => ({}) } as never, c.write, c.reference)
})
afterAll(async () => {
  await dbQuery("delete from flight_result_fares where result_id in (select id from flight_results where origin = 'TBZ' and destination = 'SAW')")
  await cleanupTestData(c.since)
  await dbQuery("delete from flight_builder_sync_runs where started_at >= $1", [c.since])
  await c.close()
})
beforeEach(async () => {
  await dbQuery("delete from flight_result_fares where result_id in (select id from flight_results where origin = any($1) and destination = any($1))", [["TBZ", "SAW", "MAN"]])
  await dbQuery("delete from flight_results where origin = any($1) and destination = any($1)", [["TBZ", "SAW", "MAN"]])
  vi.restoreAllMocks()
})

describe("slot rows: FEED and STAFF (ADR-0037 D2)", () => {
  it("a FEED refresh does not retire a STAFF row, and the STAFF row stays in the snapshot", async () => {
    const slot = (await slotId(ids.a!, D))!
    const staff = await staffWrite()
    await c.write.writeSlot({ slotId: slot, offers: [feed({ number: "2000", dep: "14:00", arr: "17:30" })], fetchedAt: new Date(), notices: [] })
    await c.write.writeSlot({ slotId: slot, offers: [], fetchedAt: new Date(), notices: [] }) // feed now empty: FEED rows retire, STAFF survives
    const r = await rows(slot)
    expect(r.find((x) => x.id === staff.resultId)).toMatchObject({ capture: "STAFF", is_current: true })
    expect(r.filter((x) => x.capture === "FEED").every((x) => !x.is_current)).toBe(true)
    expect(await snapshotIds(slot)).toEqual([staff.resultId])
  })

  it("STAFF wins a duplicate of the same flight and local departure; the FEED row stays stored but is not in the snapshot", async () => {
    const slot = (await slotId(ids.a!, D))!
    await c.write.writeSlot({ slotId: slot, offers: [feed()], fetchedAt: new Date(), notices: [] })
    const staff = await staffWrite()
    const r = await rows(slot)
    expect(r).toHaveLength(2)
    expect(r.every((x) => x.is_current)).toBe(true)
    expect(await snapshotIds(slot)).toEqual([staff.resultId])
    // A later feed refresh of the same flight must not push the FEED row ahead of the STAFF row.
    await c.write.writeSlot({ slotId: slot, offers: [feed({ minor: 99_000 })], fetchedAt: new Date(), notices: [] })
    expect(await snapshotIds(slot)).toEqual([staff.resultId])
  })

  it("replacing the source (Apify then FlightAPI) still retires the old FEED rows", async () => {
    const slot = (await slotId(ids.a!, D))!
    await c.write.writeSlot({ slotId: slot, offers: [feed({ provider: "apify-google-flights", number: "3001", dep: "06:00", arr: "09:15" })], fetchedAt: new Date(), notices: [] })
    await c.write.writeSlot({ slotId: slot, offers: [feed({ provider: "flightapi", number: "3002", dep: "07:00", arr: "10:15" })], fetchedAt: new Date(), notices: [] })
    const r = await rows(slot)
    expect(r.filter((x) => x.is_current).map((x) => x.identity_key)).toEqual([expect.stringContaining("flightapi")])
    expect(r.filter((x) => !x.is_current).map((x) => x.identity_key)).toEqual([expect.stringContaining("apify-google-flights")])
  })

  it("a staff retire removes the option from the snapshot and keeps the history", async () => {
    const slot = (await slotId(ids.a!, D))!
    const staff = await staffWrite()
    expect(await c.write.retireStaffOption(staff.resultId)).toBe(true)
    expect(await snapshotIds(slot)).toEqual([])
    expect(await fareStatus(staff.resultId)).toEqual(["RETIRED"])
    expect((await rows(slot))[0]).toMatchObject({ is_current: false })
    expect(await c.write.retireStaffOption(c.since.toISOString().replace(/\D/g, "").padEnd(32, "0").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5"))).toBe(false)
  })
})

describe("freshness sweep (ADR-0037 D8)", () => {
  it("marks fares STALE after the stale window and EXPIRED at the ticketing deadline, and drops an option with no live fare from the snapshot", async () => {
    vi.spyOn(fb, "settings").mockResolvedValue({ enabled: false, panelUrl: null, syncMode: "DISABLED", syncInterval: "DAILY", freshHours: 6, staleHours: 24, deadlineWarnHours: 48 })
    // The sweep is global (every LIVE staff fare), so fares outside this test, such as the shared local fixture, are put back afterwards.
    const keepFares = await dbQuery<{ id: string; status: string }>("select f.id, f.status from flight_result_fares f join flight_results r on r.id = f.result_id where not (r.origin = 'TBZ' and r.destination = 'SAW')")
    const keepResults = await dbQuery<{ id: string; slot_id: string }>("select id, slot_id from flight_results where is_current and capture = 'STAFF' and not (origin = 'TBZ' and destination = 'SAW')")
    try {
      const slot = (await slotId(ids.a!, D))!
      const stale = await staffWrite(capture({ number: "5001", dep: "06:00", arr: "09:15" }))
      const expiring = await staffWrite(capture({ number: "5002", dep: "07:00", arr: "10:15", deadline: inDays(3) }))
      expect(await snapshotIds(slot)).toHaveLength(2)
      await fb.sweepFreshness(NOW)
      expect(await fareStatus(stale.resultId)).toEqual(["LIVE"])
      // 30 hours: past the 24h stale window, before the deadline (a day or more ahead).
      await fb.sweepFreshness(new Date(NOW.getTime() + 30 * 3_600_000))
      expect(await fareStatus(stale.resultId)).toEqual(["STALE"])
      // Four days: the deadline rule wins over age.
      const third = await staffWrite(capture({ number: "5003", dep: "09:00", arr: "12:15", deadline: inDays(1) }))
      await fb.sweepFreshness(new Date(NOW.getTime() + 4 * 86_400_000))
      expect(await fareStatus(third.resultId)).toEqual(["EXPIRED"])
      expect(await fareStatus(expiring.resultId)).toEqual(["STALE"]) // swept at +30h already; only LIVE fares are touched
      expect(await snapshotIds(slot)).toEqual([])
      expect((await rows(slot)).every((x) => !x.is_current)).toBe(true)
    } finally {
      for (const f of keepFares) await dbQuery("update flight_result_fares set status = $2 where id = $1", [f.id, f.status])
      for (const r of keepResults) await dbQuery("update flight_results set is_current = true where id = $1", [r.id])
      for (const slot of new Set(keepResults.map((r) => r.slot_id))) await c.write.rebuildSnapshot(slot)
    }
  })
})

describe("the sync gate stays shut until a written authorisation and an adapter exist (ADR-0037 D9-D10)", () => {
  const stub = (enabled = true) => {
    vi.spyOn(fb, "settings").mockResolvedValue({ enabled, panelUrl: null, syncMode: "DISABLED", syncInterval: "DAILY", freshHours: 6, staleHours: 24, deadlineWarnHours: 48 })
    vi.spyOn(fb as never, "authorisationRow").mockResolvedValue(null as never)
  }
  const codeOf = async (p: Promise<unknown>) => { try { await p; return null } catch (e) { return e instanceof AppError ? e.code : String(e) } }

  it("switching sync mode to SCHEDULED or MANUAL is refused with AUTHORISATION_REQUIRED, whether disabled or not authorised", async () => {
    for (const enabled of [false, true]) {
      stub(enabled)
      expect(await codeOf(fb.patchSettings({ syncMode: "SCHEDULED" }, WHO(), "req-1"))).toBe("AUTHORISATION_REQUIRED")
      expect(await codeOf(fb.patchSettings({ syncMode: "MANUAL" }, WHO(), "req-2"))).toBe("AUTHORISATION_REQUIRED")
    }
  })

  it("the refresh endpoint refuses (SOURCE_NOT_AUTHORISED, or NO_ADAPTER) and records a BLOCKED run; nothing is fetched", async () => {
    stub(true)
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    expect(await codeOf(fb.refresh({ scope: {} } as never, WHO(), "req-3"))).toBe("SOURCE_NOT_AUTHORISED")
    const [run] = await dbQuery<{ status: string; blocked_reason: string }>("select status, blocked_reason from flight_builder_sync_runs where started_at >= $1 order by started_at desc limit 1", [c.since])
    expect(run).toMatchObject({ status: "BLOCKED", blocked_reason: "NOT_AUTHORISED" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("the scheduled sync job handler records BLOCKED and makes no HTTP call", async () => {
    stub(true)
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const handlers = new Map<string, () => Promise<unknown>>()
    const jobs = new FlightBuilderJobsService(
      { get: () => ({ upsertJobScheduler: async () => undefined, removeJobScheduler: async () => undefined }) } as never,
      { registerJob: (_q: string, name: string, fn: () => Promise<unknown>) => handlers.set(name, fn) } as never,
      fb,
    )
    await jobs.onModuleInit()
    const before = (await dbQuery("select id from flight_builder_sync_runs")).length
    const out = (await handlers.get(FB_JOBS.sync)!()) as { blocked: string; runId: string }
    expect(out.blocked).toBe("NOT_AUTHORISED")
    expect((await dbQuery("select id from flight_builder_sync_runs")).length).toBe(before + 1)
    expect((await dbQuery<{ status: string; trigger: string }>("select status, trigger from flight_builder_sync_runs where id = $1", [out.runId]))[0]).toEqual({ status: "BLOCKED", trigger: "SCHEDULED" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
