import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, dbQuery, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

/**
 * ADR-0033 visa checker. Uses made-up destination codes (ZY, ZX) so no real page is fetched and nothing touches real rows.
 * Locally the research step is the sandbox extractor (no key), so research alone always ends UNCONFIRMED; confirmed
 * answers here come from staff overrides, which is the path that needs the API guarantees (reason, official URL, audit).
 * Run alone: `pnpm vitest run --project e2e test/visa.e2e.ts`.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(500); v = await fn() }
  return v
}

let admin: Session, compliance: Session, cust: Session
const anon = new Session("WEB")
const DEST = "ZY", TRANSIT = "ZX"
const check = (s: Session, over: Record<string, unknown> = {}) => s.post("/v1/visa/checks", {
  documentType: "GB_REFUGEE_TRAVEL_DOC", issuingCountry: "GB", destination: DEST, departureDate: "2026-12-10", purpose: "TOURISM", ...over,
})
const cleanup = async () => {
  await dbQuery("delete from visa_research_runs where destination in ($1, $2)", [DEST, TRANSIT])
  await dbQuery("delete from visa_rules where destination in ($1, $2)", [DEST, TRANSIT])
}

beforeAll(async () => {
  await cleanup()
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  compliance = await staffSession(STAFF.compliance, ADMIN_HOST)
  cust = new Session("WEB")
  await signIn(cust, randomPhone("+4477009"), { givenNamesLatin: "Visa", surnameLatin: "Checker" })
})
afterAll(cleanup)

describe("document types and input rules", () => {
  it("lists the seeded document types, UK-issued ones with a fixed issuer", async () => {
    const r = await anon.get("/v1/visa/document-types")
    expect(r.status).toBe(200)
    const codes = r.body.map((d: { code: string }) => d.code)
    for (const c of ["GB_CITIZEN_PASSPORT", "GB_BNO_PASSPORT", "GB_REFUGEE_TRAVEL_DOC", "GB_CERTIFICATE_OF_TRAVEL", "GB_STATELESS_TRAVEL_DOC", "NATIONAL_PASSPORT"]) expect(codes).toContain(c)
    expect(r.body.find((d: { code: string }) => d.code === "GB_REFUGEE_TRAVEL_DOC").issuingCountry).toBe("GB")
    expect(r.body.find((d: { code: string }) => d.code === "NATIONAL_PASSPORT").issuingCountry).toBeNull()
  })
  it("refuses a UK refugee document said to be issued elsewhere, and a 'national passport' issued by the UK", async () => {
    expect((await check(anon, { issuingCountry: "FR" })).status).toBe(400)
    expect((await check(anon, { documentType: "NATIONAL_PASSPORT", issuingCountry: "GB" })).status).toBe(400)
  })
  it("refuses a transit country equal to the destination and a return before departure", async () => {
    expect((await check(anon, { transits: [{ country: DEST, mode: "AIRSIDE" }] })).status).toBe(400)
    expect((await check(anon, { returnDate: "2026-12-01" })).status).toBe(400)
  })
  it("a fresh verification needs sign-in", async () => {
    expect((await check(anon, { fresh: true })).status).toBe(401)
  })
})

describe("research and the customer view", () => {
  let checkId: string
  it("a first check queues research per leg and ends grey (unconfirmed) with the right notices", async () => {
    const r = await check(anon, { residenceCountry: "GB", transits: [{ country: TRANSIT, mode: "CHANGE_AIRPORT" }] })
    expect(r.status).toBe(201)
    checkId = r.body.id
    const done = await until(() => anon.get(`/v1/visa/checks/${checkId}`), (x) => x.body.complete === true)
    expect(done.body.complete).toBe(true)
    expect(done.body.overall).toBe("GREY")
    const [dest, transit] = done.body.legs
    expect(dest).toMatchObject({ role: "DESTINATION", country: DEST, colour: "GREY", facts: { status: "UNCONFIRMED" } })
    expect(dest.notices).toEqual(expect.arrayContaining(["GOVUK_BRITISH_CITIZEN_ONLY", "RESIDENCE_NOT_CITIZENSHIP"]))
    expect(transit).toMatchObject({ role: "TRANSIT", transitMode: "CHANGE_AIRPORT" })
    expect(transit.notices).toContain("TRANSIT_LEAVES_AIRSIDE")
    const runs = await dbQuery<{ purpose: string; status: string }>("select purpose, status from visa_research_runs where destination in ($1,$2) order by destination", [TRANSIT, DEST])
    // Changing airports means entering the transit country: its VISIT rule is researched, not the airside TRANSIT rule.
    expect(runs.map((x) => x.purpose)).toEqual(["VISIT", "VISIT"])
    // Made-up countries have no GOV.UK page and no trusted source: the run fails honestly and the rule stays unconfirmed.
    expect(runs.every((x) => x.status === "FAILED")).toBe(true)
    expect(dest.notices).toContain("RESEARCH_FAILED")
  })
  it("an unknown check id is 404", async () => {
    expect((await anon.get("/v1/visa/checks/00000000-0000-4000-8000-000000000000")).status).toBe(404)
  })
})

describe("staff database", () => {
  let ruleId: string, version: number
  it("customers cannot reach it; compliance can read but not write", async () => {
    expect((await cust.get("/v1/admin/visa/rules")).status).toBe(403)
    expect((await compliance.get("/v1/admin/visa/overview")).status).toBe(200)
    const list = await compliance.get(`/v1/admin/visa/rules?destination=${DEST}`)
    ruleId = list.body.items[0].id
    version = list.body.items[0].version
    expect(list.body.items[0]).toMatchObject({ verification: "UNVERIFIED", facts: { status: "UNCONFIRMED" } })
    expect((await compliance.patch(`/v1/admin/visa/rules/${ruleId}`, { version, verification: "OVERRIDDEN" })).status).toBe(403)
  })
  it("an override needs a reason and an official URL", async () => {
    const base = { version, facts: { status: "EVISA", maxStay: "30 days", applyOnline: true } }
    expect((await admin.patch(`/v1/admin/visa/rules/${ruleId}`, base)).status).toBe(400)
    expect((await admin.patch(`/v1/admin/visa/rules/${ruleId}`, { ...base, reason: "Embassy confirmed in writing" })).status).toBe(400)
    const ok = await admin.patch(`/v1/admin/visa/rules/${ruleId}`, { ...base, reason: "Embassy confirmed in writing, ref 2026/114", officialUrls: ["https://embassy.gov.zy/visa"] })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ verification: "OVERRIDDEN", facts: { status: "EVISA", maxStay: "30 days" }, overrideReason: expect.stringContaining("Embassy") })
    expect(ok.body.evidence.some((e: { origin: string; url: string }) => e.origin === "STAFF" && e.url === "https://embassy.gov.zy/visa")).toBe(true)
    version = ok.body.version
    expect((await admin.patch(`/v1/admin/visa/rules/${ruleId}`, { ...base, version: version - 1, reason: "stale write test", officialUrls: ["https://x.gov.zy"] })).status).toBe(409)
  })
  it("the customer now sees the override, blue, with the staff source and its date", async () => {
    const r = await check(anon)
    const leg = r.body.legs[0]
    expect(leg).toMatchObject({ colour: "BLUE", verification: "OVERRIDDEN", facts: { status: "EVISA", maxStay: "30 days" }, state: "READY" })
    expect(typeof leg.verifiedAt).toBe("string")
    expect(leg.sources.map((s: { url: string }) => s.url)).toContain("https://embassy.gov.zy/visa")
  })
  it("research never overwrites an override", async () => {
    const r = await admin.post("/v1/admin/visa/research", { destination: DEST, documentType: "GB_REFUGEE_TRAVEL_DOC", issuingCountry: "GB", purpose: "VISIT" })
    expect(r.status).toBe(202)
    await until(() => dbQuery<{ status: string }>("select status from visa_research_runs where id = $1", [r.body.runId]), (x) => x[0]?.status === "DONE" || x[0]?.status === "FAILED")
    expect((await admin.get(`/v1/admin/visa/rules/${ruleId}`)).body).toMatchObject({ verification: "OVERRIDDEN", facts: { status: "EVISA" } })
  })
  it("withdrawing returns the customer to unconfirmed, and every change is in the audit trail", async () => {
    const w = await admin.patch(`/v1/admin/visa/rules/${ruleId}`, { version, verification: "UNVERIFIED", reason: "Embassy reference withdrawn" })
    expect(w.status).toBe(200)
    expect(w.body.facts.status).toBe("UNCONFIRMED")
    expect((await check(anon)).body.legs[0].colour).toBe("GREY")
    const audit = await admin.get("/v1/admin/visa/audit?limit=20")
    const actions = audit.body.items.filter((a: { entityId: string }) => a.entityId === ruleId).map((a: { action: string }) => a.action)
    expect(actions).toEqual(expect.arrayContaining(["visa_rule.overridden", "visa_rule.withdrawn"]))
  })
  it("trusted sources must be https and are audited", async () => {
    expect((await admin.post("/v1/admin/visa/sources", { country: DEST, url: "http://immigration.gov.zy", title: "Immigration", kind: "DESTINATION_IMMIGRATION" })).status).toBe(400)
    const s = await admin.post("/v1/admin/visa/sources", { country: DEST, url: "https://immigration.gov.zy/entry", title: "Immigration service", kind: "DESTINATION_IMMIGRATION" })
    expect(s.status).toBe(201)
    expect(s.body).toMatchObject({ tier: 2, official: true, active: true })
    const off = await admin.patch(`/v1/admin/visa/sources/${s.body.id}`, { version: s.body.version, active: false })
    expect(off.body.active).toBe(false)
    await dbQuery("delete from visa_trusted_sources where id = $1", [s.body.id])
  })
})
