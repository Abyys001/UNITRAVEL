import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { cleanupTestData, type Catalog, inDays, makeCatalog, offer, seedTestRoutes, slotId } from "./catalog-harness"
import { dbQuery } from "./client"

/**
 * ADR-0034 write path against the real database: identity upsert, "no longer listed", price history, policy exclusion and the review flag,
 * write-time self-transfer connections (layover window, overnight, day offset), snapshots and versions.
 * Runs on made-up watchlist routes (TBZ→SAW, SAW→MAN, combined TBZ→MAN) that are deleted afterwards.
 * Prices are asserted from the staff-side tables only; the snapshot is checked to carry none.
 */
let c: Catalog
let ids: Record<string, string>
const D = inDays(2)
const D1 = inDays(3)

const results = (slot: string) => dbQuery<{ id: string; identity_key: string; is_current: boolean; self_transfer: boolean; compliance_review: boolean; detail: any }>("select id, identity_key, is_current, self_transfer, compliance_review, detail from flight_results where slot_id = $1 order by identity_key", [slot])
const pricing = (resultId: string) => dbQuery<{ amount_minor: string; previous_amount_minor: string | null; price_changed_at: Date | null }>("select amount_minor, previous_amount_minor, price_changed_at from flight_result_pricing where result_id = $1", [resultId]).then((r) => r[0]!)
const snapshot = async (slot: string) => (await dbQuery<{ version: number; payload: any[]; fetched_at: Date | null }>("select version, payload, fetched_at from catalog_public_snapshots where slot_id = $1", [slot]))[0]
const slotRow = async (slot: string) => (await dbQuery<any>("select * from catalog_slots where id = $1", [slot]))[0]
const feeder = (from: string, to: string, dep: string, arr: string, o: { date?: string; number?: string; carrier?: string; minor?: number; fetchedAt?: Date; arrDate?: string } = {}) => offer({ from, to, date: o.date ?? D, dep, arr, number: o.number ?? `${dep.replace(":", "")}`, carrier: o.carrier, minor: o.minor, fetchedAt: o.fetchedAt, arrDate: o.arrDate })

beforeAll(async () => {
  c = await makeCatalog()
  ids = await seedTestRoutes(c)
})
afterAll(async () => {
  await cleanupTestData(c.since)
  await c.close()
})
beforeEach(async () => {
  // Every test starts from empty slots; routes and slots stay.
  await dbQuery("delete from flight_results where origin = any($1) and destination = any($1)", [["TBZ", "SAW", "MAN"]])
  await dbQuery("update catalog_slots set last_fetched_at = null, status = 'NEVER', last_result_count = 0, recent_counts = '{}', consecutive_empty = 0, consecutive_errors = 0, version = 0 where route_id = any($1)", [Object.values(ids)])
  await dbQuery("delete from catalog_public_snapshots where slot_id in (select id from catalog_slots where route_id = any($1))", [Object.values(ids)])
  c.events.length = 0
  c.cfg.settings = { ...c.cfg.settings, connections: { ...c.cfg.settings.connections, minLayoverMin: 240, maxLayoverMin: 360, allowOvernight: false, dayOffsets: [0, 1], sameAirport: true } }
  c.policy.blockedCarriers.clear(); c.policy.reviewLanes.clear(); c.policy.blockedLanes.clear()
})

describe("direct slots", () => {
  it("upserts by identity, marks rows no longer listed, tracks price changes, bumps the version and rebuilds the snapshot", async () => {
    const slot = (await slotId(ids.a!, D))!
    const a = feeder("TBZ", "SAW", "08:00", "11:30", { minor: 10_000 })
    const b = feeder("TBZ", "SAW", "14:00", "17:30", { minor: 12_000, number: "2000" })
    const first = await c.write.writeSlot({ slotId: slot, offers: [a, b], fetchedAt: new Date(), notices: [] })
    expect(first).toMatchObject({ version: 1, kept: 2, dropped: 0 })
    let rows = await results(slot)
    expect(rows.map((r) => r.is_current)).toEqual([true, true])
    expect(await slotRow(slot)).toMatchObject({ version: 1, last_result_count: 2, recent_counts: [2], consecutive_empty: 0, status: "FRESH" })
    const snap1 = await snapshot(slot)
    expect(snap1!.version).toBe(1)
    expect(snap1!.payload).toHaveLength(2)
    expect(JSON.stringify(snap1!.payload)).not.toMatch(/amount|price|currency|USD|bookingToken|googleFlights|SYNTHETIC/i)
    expect(await c.redis.get(`cat:${slot}:latest`)).toBe("1")
    expect(JSON.parse((await c.redis.get(`cat:${slot}:v1`))!)).toMatchObject({ slotId: slot, version: 1, status: "FRESH" })
    expect(c.events).toContainEqual({ aggregateType: "catalog_slot", aggregateId: slot, eventType: "catalog.slot_updated", payload: { slotId: slot, version: 1 } })

    // Second refresh: `a` is dearer, `b` is gone, `n` is new.
    const aRow = rows.find((r) => r.identity_key === a.source.providerOfferId)!
    expect(await pricing(aRow.id)).toMatchObject({ amount_minor: "10000", previous_amount_minor: null, price_changed_at: null })
    const n = feeder("TBZ", "SAW", "18:00", "21:30", { minor: 9_000, number: "3000" })
    const second = await c.write.writeSlot({ slotId: slot, offers: [feeder("TBZ", "SAW", "08:00", "11:30", { minor: 11_000 }), n], fetchedAt: new Date(), notices: [] })
    expect(second!.version).toBe(2)
    rows = await results(slot)
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.identity_key === b.source.providerOfferId)!.is_current).toBe(false)
    expect(rows.filter((r) => r.is_current)).toHaveLength(2)
    expect(await pricing(aRow.id)).toMatchObject({ amount_minor: "11000", previous_amount_minor: "10000" })
    expect((await pricing(aRow.id)).price_changed_at).toBeInstanceOf(Date)
    expect((await snapshot(slot))!.payload).toHaveLength(2)
    expect((await snapshot(slot))!.payload.map((p) => p.flightNumbers[0]).sort()).toEqual(["TK0800", "TK3000"])

    // Same price again: the history is kept, not overwritten.
    const changedAt = (await pricing(aRow.id)).price_changed_at
    await c.write.writeSlot({ slotId: slot, offers: [feeder("TBZ", "SAW", "08:00", "11:30", { minor: 11_000 }), n], fetchedAt: new Date(), notices: [] })
    expect(await pricing(aRow.id)).toMatchObject({ amount_minor: "11000", previous_amount_minor: "10000", price_changed_at: changedAt })
    expect((await slotRow(slot)).version).toBe(3)
    expect(await c.redis.get(`cat:${slot}:latest`)).toBe("3")
  })

  it("an empty answer is stored: results leave the snapshot, the slot backs off and the empty streak grows", async () => {
    const slot = (await slotId(ids.a!, D))!
    await c.write.writeSlot({ slotId: slot, offers: [feeder("TBZ", "SAW", "08:00", "11:30")], fetchedAt: new Date(), notices: [] })
    await c.write.writeSlot({ slotId: slot, offers: [], fetchedAt: new Date(), notices: ["Fewer results"] })
    expect(await slotRow(slot)).toMatchObject({ status: "EMPTY", consecutive_empty: 1, recent_counts: [0, 1], last_result_count: 0 })
    expect((await snapshot(slot))!.payload).toEqual([])
    expect((await results(slot))[0]!.is_current).toBe(false)
    await c.write.writeSlot({ slotId: slot, offers: [], fetchedAt: new Date(), notices: [] })
    expect((await slotRow(slot)).consecutive_empty).toBe(2)
    // The third empty answer is past the back-off threshold: the next refresh is due later than the plain tier interval.
    const plain = new Date(Date.now() + 8 * 3_600_000).getTime()
    expect(new Date((await slotRow(slot)).next_due_at).getTime()).toBeGreaterThan(plain + 3_600_000)
  })

  it("an error-only answer marks the slot ERROR and leaves the previous results on display", async () => {
    const slot = (await slotId(ids.a!, D))!
    await c.write.writeSlot({ slotId: slot, offers: [feeder("TBZ", "SAW", "08:00", "11:30")], fetchedAt: new Date(), notices: [] })
    await c.write.writeSlot({ slotId: slot, offers: [], fetchedAt: new Date(), notices: [], errored: "Route TBZ-SAW: lookup failed" })
    expect(await slotRow(slot)).toMatchObject({ consecutive_errors: 1, last_error: "Route TBZ-SAW: lookup failed" })
    expect((await snapshot(slot))!.payload).toHaveLength(1)
  })
})

describe("compliance (policies are data and are applied before anything is stored)", () => {
  it("a blocked carrier never reaches the database; a lane on REVIEW flags the row, its detail and its snapshot", async () => {
    const slot = (await slotId(ids.a!, D))!
    c.policy.blockedCarriers.add("W5")
    c.policy.reviewLanes.add("IR:*")
    const out = await c.write.writeSlot({ slotId: slot, offers: [feeder("TBZ", "SAW", "08:00", "11:30"), feeder("TBZ", "SAW", "09:00", "12:30", { carrier: "W5", number: "5000" })], fetchedAt: new Date(), notices: [] })
    expect(out).toMatchObject({ kept: 1, dropped: 1 })
    const rows = await results(slot)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.identity_key.startsWith("W5")).toBe(false)
    expect(rows[0]).toMatchObject({ compliance_review: true })
    expect(rows[0]!.detail.complianceReview).toBe(true)
    expect((await snapshot(slot))!.payload[0]).toMatchObject({ complianceReview: true })
    // The count follows what Apify returned (what was billed), not what policy let through.
    expect((await slotRow(slot)).last_result_count).toBe(2)
  })

  it("a lane on BLOCK drops every row; nothing is stored", async () => {
    const slot = (await slotId(ids.a!, D))!
    c.policy.blockedLanes.add("IR:*")
    const out = await c.write.writeSlot({ slotId: slot, offers: [feeder("TBZ", "SAW", "08:00", "11:30")], fetchedAt: new Date(), notices: [] })
    expect(out).toMatchObject({ kept: 0, dropped: 1 })
    expect(await results(slot)).toEqual([])
    expect((await snapshot(slot))!.payload).toEqual([])
  })

  it("tightening a policy later (snapshots.rebuild, no Apify cost) removes stored rows and the combinations built on them", async () => {
    const a = (await slotId(ids.a!, D))!
    const b = (await slotId(ids.b!, D))!
    const comb = (await slotId(ids.combined!, D))!
    await c.write.writeSlot({ slotId: a, offers: [feeder("TBZ", "SAW", "08:00", "11:30")], fetchedAt: new Date(), notices: [] })
    await c.write.writeSlot({ slotId: b, offers: [feeder("SAW", "MAN", "16:30", "18:45", { number: "7000" })], fetchedAt: new Date(), notices: [] })
    expect((await snapshot(comb))!.payload).toHaveLength(1)
    const v = (await snapshot(a))!.version
    c.policy.blockedCarriers.add("TK")
    const r = await c.write.rebuildAll([ids.a!, ids.b!])
    expect(r.removed).toBe(2)
    expect(await results(a)).toEqual([])
    expect((await snapshot(a))!.payload).toEqual([])
    expect((await snapshot(a))!.version).toBe(v + 1)
    expect((await snapshot(comb))!.payload).toEqual([])
    // A review lane added later flags what is stored without a new fetch.
    c.policy.blockedCarriers.clear()
    await c.write.writeSlot({ slotId: a, offers: [feeder("TBZ", "SAW", "08:00", "11:30")], fetchedAt: new Date(), notices: [] })
    c.policy.reviewLanes.add("IR:*")
    expect((await c.write.rebuildAll([ids.a!, ids.b!])).flagged).toBeGreaterThanOrEqual(1)
    expect((await snapshot(a))!.payload[0]).toMatchObject({ complianceReview: true })
  })
})

describe("self-transfer connections (built at write time, never at read time)", () => {
  const A_FETCH = new Date(Date.now() - 3 * 3_600_000)
  const put = async (route: "a" | "b", date: string, offers: ReturnType<typeof feeder>[], fetchedAt = new Date()) => c.write.writeSlot({ slotId: (await slotId(ids[route]!, date))!, offers, fetchedAt, notices: [] })
  const combined = async (date = D) => { const s = (await slotId(ids.combined!, date))!; return { slot: s, rows: await results(s), snap: await snapshot(s) } }

  it("joins a feeder pair into a combined result: separate tickets, layover, price sum for staff only, older leg decides freshness", async () => {
    await put("a", D, [feeder("TBZ", "SAW", "08:00", "11:30", { minor: 10_000, fetchedAt: A_FETCH })], A_FETCH)
    expect((await combined()).rows).toEqual([]) // one leg is not enough
    await put("b", D, [feeder("SAW", "MAN", "16:30", "18:45", { minor: 7_500, number: "7000" })])
    const { slot, rows, snap } = await combined()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ self_transfer: true, is_current: true })
    expect(await pricing(rows[0]!.id)).toMatchObject({ amount_minor: "17500" })
    const legs = await dbQuery<{ position: number; leg_result_id: string }>("select position, leg_result_id from flight_result_legs where result_id = $1 order by position", [rows[0]!.id])
    expect(legs).toHaveLength(2)
    expect(snap!.payload[0]).toMatchObject({ origin: "TBZ", destination: "MAN", selfTransfer: true, stops: 1, flightNumbers: ["TK0800", "TK7000"], layovers: [{ at: "SAW", minutes: 300 }] })
    expect(snap!.payload[0].riskFlags).toContain("SEPARATE_TICKETS")
    expect(new Date(snap!.payload[0].fetchedAt).getTime()).toBe(A_FETCH.getTime())
    expect(snap!.fetched_at!.getTime()).toBe((await slotRow(slot)).last_fetched_at.getTime())
    expect(JSON.stringify(snap!.payload)).not.toMatch(/amount|price|currency|17500|10000/i)
    // First build of the combined slot: the first leg alone built nothing.
    expect(snap!.version).toBe(1)
  })

  it("enforces the layover window exactly: 240 and 360 minutes pass, 239 and 361 do not", async () => {
    await put("a", D, [feeder("TBZ", "SAW", "08:00", "11:00")])
    // Arrival 11:00 at SAW; departures at 14:59 (239), 15:00 (240), 17:00 (360), 17:01 (361).
    await put("b", D, [feeder("SAW", "MAN", "14:59", "17:00", { number: "1" }), feeder("SAW", "MAN", "15:00", "17:01", { number: "2" }), feeder("SAW", "MAN", "17:00", "19:00", { number: "3" }), feeder("SAW", "MAN", "17:01", "19:01", { number: "4" })])
    expect((await combined()).snap!.payload.map((p) => p.flightNumbers[1]).sort()).toEqual(["TK2", "TK3"])
    expect((await combined()).snap!.payload.map((p) => p.layovers[0].minutes).sort((x, y) => x - y)).toEqual([240, 360])
  })

  it("the layover window is read from the settings each time, so widening it in the admin takes effect on the next write", async () => {
    await put("a", D, [feeder("TBZ", "SAW", "08:00", "11:00")])
    await put("b", D, [feeder("SAW", "MAN", "17:01", "19:01", { number: "4" })])
    expect((await combined()).snap!.payload).toEqual([])
    c.cfg.settings = { ...c.cfg.settings, connections: { ...c.cfg.settings.connections, maxLayoverMin: 480 } }
    await put("b", D, [feeder("SAW", "MAN", "17:01", "19:01", { number: "4" })])
    expect((await combined()).snap!.payload).toHaveLength(1)
  })

  it("a night-time layover is refused unless overnight is allowed", async () => {
    // Lands 22:00 at SAW and flies at 03:00 the next day: 5 h, but across the night.
    await put("a", D, [feeder("TBZ", "SAW", "18:00", "22:00")])
    await put("b", D1, [feeder("SAW", "MAN", "03:00", "05:15", { date: D1, number: "9" })])
    expect((await combined()).snap!.payload).toEqual([])
    c.cfg.settings = { ...c.cfg.settings, connections: { ...c.cfg.settings.connections, allowOvernight: true } }
    await put("b", D1, [feeder("SAW", "MAN", "03:00", "05:15", { date: D1, number: "9" })])
    const out = (await combined()).snap!.payload
    expect(out).toHaveLength(1)
    expect(out[0].riskFlags).toEqual(expect.arrayContaining(["SEPARATE_TICKETS", "OVERNIGHT"]))
  })

  it("the day offset decides which departure dates of the second leg are joined: +1 only when the settings list it", async () => {
    await put("a", D, [feeder("TBZ", "SAW", "18:00", "22:00")])
    c.cfg.settings = { ...c.cfg.settings, connections: { ...c.cfg.settings.connections, allowOvernight: true, dayOffsets: [0] } }
    await put("b", D1, [feeder("SAW", "MAN", "03:00", "05:15", { date: D1, number: "9" })])
    expect((await combined()).snap?.payload ?? []).toEqual([])
    c.cfg.settings = { ...c.cfg.settings, connections: { ...c.cfg.settings.connections, dayOffsets: [0, 1] } }
    // The write of the second leg's slot (date D+1) rebuilds the combined slot of date D.
    await put("b", D1, [feeder("SAW", "MAN", "03:00", "05:15", { date: D1, number: "9" })])
    expect((await combined(D)).snap!.payload).toHaveLength(1)
    expect((await combined(D1)).snap?.payload ?? []).toEqual([])
  })

  it("a combination is dropped as soon as a leg stops being listed, and the snapshot version moves", async () => {
    await put("a", D, [feeder("TBZ", "SAW", "08:00", "11:30")])
    await put("b", D, [feeder("SAW", "MAN", "16:30", "18:45", { number: "7000" })])
    const before = await combined()
    expect(before.snap!.payload).toHaveLength(1)
    await put("b", D, [feeder("SAW", "MAN", "12:00", "14:15", { number: "8000" })]) // the 16:30 flight is gone; the new one lands inside the window of nothing
    const after = await combined()
    expect(after.snap!.payload).toEqual([])
    expect(after.snap!.version).toBeGreaterThan(before.snap!.version)
    expect(after.rows.every((r) => !r.is_current)).toBe(true)
    expect(await c.redis.get(`cat:${after.slot}:latest`)).toBe(String(after.snap!.version))
  })

  it("combined routes are never sent to Apify: the pacer sees only direct slots", async () => {
    const { slots } = await (c.refresh as unknown as { dueSlots(now: Date): Promise<{ slots: { routeId: string }[] }> }).dueSlots(new Date())
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.some((s) => s.routeId === ids.combined)).toBe(false)
  })
})
