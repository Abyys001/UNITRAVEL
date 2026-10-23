import { describe, expect, it } from "vitest"

import { ADMIN_HOST, API, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const BLOCKED = ["IR", "W5", "EP", "QB", "Y9", "B9", "I3", "HH", "ZV", "JI", "VR", "IV", "NV", "IS"]

async function runSearch(s: Session, from: string, to: string, date = "2026-11-14", extra: Record<string, unknown> = {}, path = "/v1/flight-searches") {
  const started = Date.now()
  const r = await s.post(path, { tripType: "ONE_WAY", slices: [{ from: from.length === 3 && ["THR", "LON", "IST", "PAR"].includes(from) ? { city: from } : { airport: from }, to: ["LON", "PAR", "IST"].includes(to) ? { city: to } : { airport: to }, date }], passengers: [{ type: "ADT" }], ...extra })
  expect(r.status).toBe(202)
  expect(Date.now() - started).toBeLessThan(1500)
  let firstResultsMs: number | null = null
  let st = await s.get(`${path}/${r.body.id}?limit=60`)
  while (st.body.status === "RUNNING") {
    if (firstResultsMs === null && st.body.total > 0) firstResultsMs = Date.now() - started
    await wait(300)
    st = await s.get(`${path}/${r.body.id}?limit=60`)
  }
  return { id: r.body.id as string, state: st.body, firstResultsMs: firstResultsMs ?? Date.now() - started }
}

function carriersOf(it: { components: { slices: { segments: { marketing: { carrier: string }; operating: { carrier: string } }[] }[] }[] }) {
  return it.components.flatMap((c) => c.slices.flatMap((s) => s.segments.flatMap((g) => [g.marketing.carrier, g.operating.carrier])))
}

describe("Stage 3 — search and itinerary engine (ch. 31.5)", () => {
  // Benchmark queries (ch. 32.4): expected properties, not exact results.
  for (const [from, to] of [["THR", "LON"], ["TBZ", "MAN"], ["MHD", "FRA"], ["EVN", "LON"]] as const) {
    it(`benchmark ${from} → ${to}: gateway results for Iran origins, no blocked carriers, self-transfers flagged, layovers within bounds, first results < 8 s`, async () => {
      const s = new Session("WEB")
      const { state, firstResultsMs } = await runSearch(s, from, to)
      expect(["COMPLETE", "PARTIAL"]).toContain(state.status)
      expect(firstResultsMs).toBeLessThan(8000)
      for (const it of state.results) {
        expect(carriersOf(it).filter((c: string) => BLOCKED.includes(c))).toEqual([])
        for (const c of it.connections) {
          if (!c.protected) {
            expect(c.flags).toContain("SEPARATE_TICKETS")
            expect(c.layoverMin).toBeGreaterThanOrEqual(c.requiredMin)
          }
          expect(c.layoverMin).toBeLessThanOrEqual(720)
        }
        expect(it.truth.length).toBe(it.components.length)
        expect(it.components[0].slices[0].segments[0].fareBasis).toBeUndefined()
      }
      // Every benchmark must produce options; Iran origins must include at least one gateway start (ch. 32.4).
      expect(state.results.length).toBeGreaterThan(0)
      if (from !== "EVN") expect(state.results.some((x: { construction: string }) => x.construction === "GATEWAY")).toBe(true)
      if (from === "THR") {
        expect(state.notices).toContain("POLICY_HIDDEN")
        const hub = state.results.find((x: { construction: string; connections: { at: string }[] }) => x.construction === "SELF_TRANSFER" && x.connections[0]?.at === "MCT")
        expect(hub).toBeTruthy()
        expect(hub.connections[0].layoverMin).toBe(370) // 6 h 10 m, just outside the preferred window (ch. 22.11)
        expect(hub.explain.layoverFit).toBeGreaterThan(0)
      }
    })
  }

  it("itinerary → price check → request with self-transfer acknowledgement → immutable snapshot → quote option from snapshot keeps UNKNOWN baggage", async () => {
    const c = new Session("MOBILE")
    await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Omid", surnameLatin: "Searcher" })
    const me = (await c.get("/v1/me")).body
    const trav = (await c.post("/v1/me/travellers", { title: "MR", givenNames: "Omid", surname: "Searcher", dateOfBirth: "1999-02-02", genderOnDocument: "M", nationality: "IR" })).body
    const { id, state } = await runSearch(c, "THR", "LON")
    const st = state.results.find((x: { ticketing: string }) => x.ticketing === "SEPARATE_TICKETS")
    expect(st).toBeTruthy()
    const detail = await c.get(`/v1/itineraries/${st.id}`)
    expect(detail.body.itinerary.id).toBe(st.id)
    const pc = await c.post(`/v1/itineraries/${st.id}/price-check`)
    expect(["CONFIRMED", "PRICE_CHANGED"]).toContain(pc.body.outcome)
    if (pc.body.outcome === "PRICE_CHANGED") expect(pc.body.currentTotal.amountMinor).not.toBe(pc.body.previousTotal.amountMinor)
    const body = { kind: "ITINERARY", searchId: id, itineraryId: st.id, contactIdentityId: me.identities[0].id, travellers: [{ travellerId: trav.id, passengerType: "ADT" }], seatPreference: "AISLE", acknowledgements: { notABooking: true, privacy: true } }
    const noAck = await c.post("/v1/flight-requests", body)
    expect(noAck.body.errors?.[0]?.path).toBe("acknowledgements.selfTransfer")
    // The customer has just seen the re-checked price, so submitting must not ask them to confirm it again.
    const sub = await c.post("/v1/flight-requests", { ...body, acknowledgements: { notABooking: true, privacy: true, selfTransfer: true } })
    expect(sub.status).toBe(201)
    const view = (await c.get(`/v1/flight-requests/${sub.body.ref}`)).body
    expect(view.snapshot.itinerary.id).toBe(st.id)
    expect(view.snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(view.snapshot.ruleVersion).toBeGreaterThanOrEqual(1)
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    for (let i = 0; i < 30 && (await c.get(`/v1/flight-requests/${sub.body.ref}`)).body.status === "SUBMITTED"; i++) await wait(300)
    const opt = await admin.get(`/v1/admin/flight-requests/${sub.body.ref}/quotes/from-snapshot`)
    expect(opt.body.source).toBe("SNAPSHOT")
    expect(opt.body.ticketingModel).toBe("SEPARATE_TICKETS")
    expect(opt.body.conditions.change.status).toBe("UNKNOWN") // separate tickets: staff confirm conditions per ticket
  })

  it("a price the customer already re-checked is honoured at submit; an unseen change still asks first", async () => {
    const c = new Session("MOBILE")
    await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Leila", surnameLatin: "Pricecheck" })
    const me = (await c.get("/v1/me")).body
    const trav = (await c.post("/v1/me/travellers", { title: "MS", givenNames: "Leila", surname: "Pricecheck", dateOfBirth: "1994-05-05", genderOnDocument: "F", nationality: "IR" })).body
    // One FAKE offer in six re-prices on revalidation; walk a few dates so both paths are exercised.
    let checked = 0, unseen = 0
    for (const date of Array.from({ length: 12 }, (_, i) => `2026-11-${String(21 + i).padStart(2, "0")}`)) {
      if (checked && unseen) break
      const { id, state } = await runSearch(c, "THR", "LON", date)
      const base = (itineraryId: string, separate: boolean) => ({ kind: "ITINERARY", searchId: id, itineraryId, contactIdentityId: me.identities[0].id, travellers: [{ travellerId: trav.id, passengerType: "ADT" }], acknowledgements: { notABooking: true, privacy: true, selfTransfer: separate || undefined } })
      for (const it of state.results as { id: string; ticketing: string }[]) {
        const separate = it.ticketing === "SEPARATE_TICKETS"
        if (checked === 0) {
          const pc = await c.post(`/v1/itineraries/${it.id}/price-check`)
          if (pc.body.outcome !== "PRICE_CHANGED") continue
          const sub = await c.post("/v1/flight-requests", base(it.id, separate))
          expect(sub.status).toBe(201)
          expect((await c.get(`/v1/flight-requests/${sub.body.ref}`)).body.snapshot.itinerary.price.total).toEqual(pc.body.currentTotal)
          checked++
        } else if (unseen === 0) {
          const sub = await c.post("/v1/flight-requests", base(it.id, separate))
          if (sub.status === 201) continue
          expect(sub.body.code).toBe("PRICE_CHANGED")
          unseen++
        }
      }
    }
    expect(checked).toBe(1)
    expect(unseen).toBe(1)
  })

  it("streams progress, results and done over server-sent events", async () => {
    const s = new Session("WEB")
    const r = await s.post("/v1/flight-searches", { tripType: "ONE_WAY", slices: [{ from: { airport: "IST" }, to: { city: "LON" }, date: "2026-11-20" }], passengers: [{ type: "ADT" }] })
    const res = await fetch(`${API}/v1/flight-searches/${r.body.id}/events`, { headers: s.headers() })
    const text = await res.text()
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    expect(text).toContain("event: progress")
    expect(text).toContain("event: done")
  })

  it("view-only seat maps appear only when enabled and the supplier returns them; rows are drawn as supplied", async () => {
    const dev = await staffSession(STAFF.developer)
    const c = new Session("MOBILE")
    await signIn(c, randomPhone("+98912"))
    const { state } = await runSearch(c, "IST", "LON", "2026-11-21")
    const it = state.results.find((x: { components: { seatMapAvailable: boolean }[] }) => x.components.every((k) => k.seatMapAvailable))
    expect((await c.get(`/v1/itineraries/${it.id}/seat-maps`)).body).toMatchObject({ available: false, reason: "SEATMAPS_DISABLED" })
    await dev.put("/v1/dev/feature-flags/seatmaps.enabled", { enabled: true })
    await wait(1500)
    const sm = await c.get(`/v1/itineraries/${it.id}/seat-maps`)
    expect(sm.body.available).toBe(true)
    const rows = sm.body.maps[0].cabins[0].rows
    const designators = rows.map((r: { sections: { elements: { designator?: string }[] }[] }) => r.sections[0].elements.find((e) => e.designator)?.designator)
    expect(designators.some((d: string) => d.startsWith("13"))).toBe(false)
    expect(sm.body.maps[0].source.fetchedAt).toBeTruthy()
    await dev.put("/v1/dev/feature-flags/seatmaps.enabled", { enabled: false })
  })

  it("staff search shows staff fields; the rule simulator uses cached responses only", async () => {
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    const { id, state } = await runSearch(admin, "THR", "LON", "2026-11-14", {}, "/v1/admin/flight-searches")
    expect(state.results[0].components[0].slices[0].segments[0].fareBasis).toBeTruthy()
    const dev = await staffSession(STAFF.developer)
    const rules = (await dev.get("/v1/dev/config/ENGINE_RULES/versions")).body.find((v: { status: string }) => v.status === "PUBLISHED").payload
    const sim = await dev.post("/v1/dev/config/ENGINE_RULES/simulate", { searchId: id, payload: { ...rules, global: { ...rules.global, selfTransferMinMin: 400 } } })
    expect(sim.status).toBe(200)
    expect(sim.body.supplierCallsMade).toBe(0)
    const st = (r: { top: { ticketing: string }[] }) => r.top.filter((x) => x.ticketing === "SEPARATE_TICKETS").length
    expect(st(sim.body.draft)).toBeLessThan(st(sim.body.published))
  })

  it("disabling a provider takes effect within seconds", async () => {
    const dev = await staffSession(STAFF.developer)
    expect((await dev.patch("/v1/dev/providers/fake", { enabled: false })).body.enabled).toBe(false)
    await wait(1500)
    const { state } = await runSearch(new Session("WEB"), "IST", "LON", "2026-11-22")
    expect(state.notices).toContain("NO_SOURCES")
    expect((await dev.patch("/v1/dev/providers/fake", { enabled: true })).body.enabled).toBe(true)
    const test = await dev.post("/v1/dev/providers/fake/test")
    expect(test.body.ok).toBe(true)
  })
})
