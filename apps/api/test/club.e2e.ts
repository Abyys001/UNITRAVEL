import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, DEV_HOST, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

/** ADR-0016 customer club; spec docs/CONTENT-MENU-LIVE-DATA.md §4.4, decision O12. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const FLAGS = ["loyalty.enabled", "services.visa.enabled"] as const
const anon = new Session("WEB")
let dev: Session, admin: Session, owner: Session
const initial: Record<string, boolean> = {}

async function setFlag(key: (typeof FLAGS)[number], enabled: boolean) {
  expect((await dev.put(`/v1/dev/feature-flags/${key}`, { enabled })).status).toBe(200)
  const menuKey = key === "loyalty.enabled" ? "club" : "visa"
  await until(async () => (await anon.get("/v1/site")).body.menu[menuKey], (v) => v === enabled)
}

async function customer(name: string) {
  const c = new Session("WEB")
  const phone = randomPhone("+4477009")
  await signIn(c, phone, { givenNamesLatin: name, surnameLatin: "Member" })
  const me = (await c.get("/v1/me")).body
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: name, surname: "Member", dateOfBirth: "1991-04-05", genderOnDocument: "F", nationality: "GB", relationship: "SELF" })
  expect(t.status).toBe(201)
  return { c, phone, userId: me.id as string, contactIdentityId: me.identities[0].id as string, travellerId: t.body.id as string }
}
type Cust = Awaited<ReturnType<typeof customer>>
const window = () => ({ validFrom: new Date(Date.now() - 60_000).toISOString(), validTo: new Date(Date.now() + 30 * 86400_000).toISOString() })
const desc = (en: string) => ({ en, fa: `${en} (fa)` })

beforeAll(async () => {
  dev = await staffSession(STAFF.developer, DEV_HOST)
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  owner = await staffSession(STAFF.owner, ADMIN_HOST)
  const menu = (await anon.get("/v1/site")).body.menu
  initial["loyalty.enabled"] = menu.club
  initial["services.visa.enabled"] = menu.visa
})
afterAll(async () => {
  for (const k of FLAGS) await dev.put(`/v1/dev/feature-flags/${k}`, { enabled: initial[k] ?? false })
})

describe("Customer club (ADR-0016)", () => {
  let tierId: string
  let u: Cust

  it("the customer page says the club is off (200, enabled false) and shows non-members an empty club when on", async () => {
    await setFlag("loyalty.enabled", false)
    u = await customer("Parisa")
    const off = await u.c.get("/v1/me/club")
    expect(off.status).toBe(200)
    expect(off.body).toEqual({ enabled: false, member: null, benefits: [], creditBalance: [] })
    await setFlag("loyalty.enabled", true)
    expect((await u.c.get("/v1/me/club")).body).toEqual({ enabled: true, member: null, benefits: [], creditBalance: [] })
    // Staff routes are not customer routes.
    expect((await u.c.get("/v1/admin/club/members")).status).toBe(403)
  })

  it("staff create a tier, find the customer and enrol them; the customer sees the tier and gets a welcome notice", async () => {
    const code = `GOLD_${Date.now().toString(36).toUpperCase()}`
    const t = await admin.post("/v1/admin/club/tiers", { code, nameEn: "Gold", nameFa: "طلایی" })
    expect(t.status).toBe(201)
    tierId = t.body.id
    expect((await admin.post("/v1/admin/club/tiers", { code, nameEn: "Again", nameFa: "دوباره" })).status).toBe(400)

    const found = await admin.get(`/v1/admin/club/candidates?q=${encodeURIComponent(u.phone.slice(-6))}`)
    expect(found.status).toBe(200)
    expect(found.body.find((x: { userId: string }) => x.userId === u.userId)).toMatchObject({ member: false })

    const add = await admin.post("/v1/admin/club/members", { userId: u.userId, tierId, note: "Frequent traveller" })
    expect(add.status).toBe(201)
    expect(add.body).toMatchObject({ userId: u.userId, status: "ACTIVE", tier: { code }, creditBalance: [] })
    expect((await admin.post("/v1/admin/club/members", { userId: u.userId, tierId })).status).toBe(400)
    // Staff accounts cannot be enrolled.
    const staffUser = (await admin.get("/v1/me")).body.id
    expect((await admin.post("/v1/admin/club/members", { userId: staffUser, tierId })).status).toBe(400)

    expect((await u.c.get("/v1/me/club")).body.member).toMatchObject({ status: "ACTIVE", tier: { code, nameEn: "Gold", nameFa: "طلایی" } })
    const inbox = await until(() => u.c.get("/v1/notifications"), (r) => (r.body.items ?? r.body).some((n: { eventType: string }) => n.eventType === "loyalty.member_added"))
    expect((inbox.body.items ?? inbox.body).some((n: { eventType: string }) => n.eventType === "loyalty.member_added")).toBe(true)
  })

  it("benefits: small ones are active at once; larger ones need a second approver (four eyes)", async () => {
    const fixed = await admin.post("/v1/admin/club/benefits", { kind: "DISCOUNT_FIXED", value: 2000, currency: "GBP", appliesTo: "SERVICE", userId: u.userId, description: desc("£20 off"), ...window() })
    expect(fixed.status).toBe(201)
    expect(fixed.body).toMatchObject({ status: "ACTIVE", needsApproval: false })
    const pct = await admin.post("/v1/admin/club/benefits", { kind: "DISCOUNT_PERCENT", value: 15, appliesTo: "ANY", tierId, description: desc("15% off"), ...window() })
    expect(pct.body).toMatchObject({ status: "PENDING_APPROVAL", needsApproval: true })
    expect((await admin.post(`/v1/admin/club/benefits/${pct.body.id}/approve`)).body.code).toBe("FOUR_EYES_REQUIRED")
    const approved = await owner.post(`/v1/admin/club/benefits/${pct.body.id}/approve`)
    expect(approved.status).toBe(200)
    expect(approved.body.status).toBe("ACTIVE")
    // A tier benefit for a tier and a member at once is refused; bonus credit is for one member only.
    expect((await admin.post("/v1/admin/club/benefits", { kind: "PERK", value: 0, appliesTo: "ANY", tierId, userId: u.userId, description: desc("Lounge"), ...window() })).status).toBe(400)
    expect((await admin.post("/v1/admin/club/benefits", { kind: "BONUS_CREDIT", value: 500, currency: "GBP", appliesTo: "ANY", tierId, description: desc("Credit"), ...window() })).status).toBe(400)

    const usable = await admin.get(`/v1/admin/club/benefits?usableBy=${u.userId}`)
    expect(usable.body.map((b: { id: string }) => b.id).sort()).toEqual([fixed.body.id, pct.body.id].sort())
    expect((await u.c.get("/v1/me/club")).body.benefits).toHaveLength(2)
  })

  it("bonus credit goes through the insert-only ledger and never below zero", async () => {
    const credit = await admin.post("/v1/admin/club/benefits", { kind: "BONUS_CREDIT", value: 1000, currency: "GBP", appliesTo: "ANY", userId: u.userId, description: desc("Welcome credit"), ...window() })
    expect(credit.body.status).toBe("ACTIVE")
    expect((await u.c.get("/v1/me/club")).body.creditBalance).toEqual([GBP(1000)])
    expect((await admin.post("/v1/admin/club/ledger", { userId: u.userId, kind: "USED", amount: GBP(100), reason: "Used on a booking" })).status).toBe(400)
    const over = await admin.post("/v1/admin/club/ledger", { userId: u.userId, kind: "REVERSED", amount: GBP(5000), reason: "Mistaken grant" })
    expect(JSON.stringify(over.body)).toContain("INSUFFICIENT_CREDIT")
    expect((await admin.post("/v1/admin/club/ledger", { userId: u.userId, kind: "GRANTED", amount: GBP(200_000), reason: "Too large for one person" })).body.code).toBe("FOUR_EYES_REQUIRED")
    const rev = await admin.post("/v1/admin/club/ledger", { userId: u.userId, kind: "REVERSED", amount: GBP(400), reason: "Partly mistaken grant" })
    expect(rev.status).toBe(201)
    expect(rev.body.map((e: { kind: string }) => e.kind)).toEqual(["REVERSED", "GRANTED"])
    expect((await admin.get(`/v1/admin/club/members/${u.userId}`)).body.creditBalance).toEqual([GBP(600)])
    // Revoking the credit reverses only what is left.
    expect((await admin.post(`/v1/admin/club/benefits/${credit.body.id}/revoke`, { reason: "Offer withdrawn" })).body.status).toBe("REVOKED")
    expect((await u.c.get("/v1/me/club")).body.creditBalance).toEqual([])
  })

  it("a service quote accepts a valid club discount line and refuses one that is too large, repeated or someone else's", async () => {
    await setFlag("services.visa.enabled", true)
    const sub = await u.c.post("/v1/service-requests", { type: "VISA", contactIdentityId: u.contactIdentityId, acknowledgements: { notABooking: true, privacy: true }, details: { destinationCountry: "TR", purpose: "TOURISM", travellerIds: [u.travellerId], intendedTravelDate: "2027-03-01" } })
    expect(sub.status).toBe(201)
    const ref = sub.body.ref as string
    let d = await until(() => admin.get(`/v1/admin/service-requests/${ref}`), (r) => r.status === 200 && r.body.status === "SUBMITTED")
    d = await admin.post(`/v1/admin/service-requests/${ref}/transition`, { command: "claim", expectedVersion: d.body.version, input: {} })
    const fixed = (await admin.get(`/v1/admin/club/benefits?userId=${u.userId}&status=ACTIVE`)).body.find((b: { kind: string }) => b.kind === "DISCOUNT_FIXED")
    const lines = (discount: number, benefitId = fixed.id, twice = false) => {
      const club = { kind: "CLUB_DISCOUNT", label: "Customer club discount", amount: GBP(discount), benefitId }
      return { lines: [{ kind: "SERVICE_FEE", label: "Service fee", amount: GBP(5000) }, { kind: "THIRD_PARTY_FEE", label: "Consulate fee", amount: GBP(2000) }, club, ...(twice ? [club] : [])], validUntil: new Date(Date.now() + 86400_000).toISOString() }
    }
    const send = (input: Record<string, unknown>) => admin.post(`/v1/admin/service-requests/${ref}/transition`, { command: "send_quote", expectedVersion: d.body.version, input })
    expect(JSON.stringify((await send(lines(2500))).body)).toContain("DISCOUNT_TOO_LARGE")
    expect(JSON.stringify((await send(lines(1000, fixed.id, true))).body)).toContain("BENEFIT_REPEATED")
    const other = await customer("Sara")
    await admin.post("/v1/admin/club/members", { userId: other.userId, tierId })
    const theirs = await admin.post("/v1/admin/club/benefits", { kind: "DISCOUNT_FIXED", value: 3000, currency: "GBP", appliesTo: "SERVICE", userId: other.userId, description: desc("£30 off"), ...window() })
    expect(JSON.stringify((await send(lines(1000, theirs.body.id))).body)).toContain("BENEFIT_NOT_THEIRS")
    const ok = await send(lines(2000))
    expect(ok.status).toBe(200)
    expect(ok.body.quote.total).toEqual(GBP(5000))
    expect((await u.c.get(`/v1/service-requests/${ref}`)).body.quote.total).toEqual(GBP(5000))
  })

  it("suspending a member hides their benefits and blocks new discount lines", async () => {
    const s = await admin.patch(`/v1/admin/club/members/${u.userId}`, { status: "SUSPENDED", reason: "Paused at the customer's request" })
    expect(s.body.status).toBe("SUSPENDED")
    expect((await u.c.get("/v1/me/club")).body).toMatchObject({ enabled: true, member: { status: "SUSPENDED" }, benefits: [], creditBalance: [] })
    expect((await admin.get(`/v1/admin/club/benefits?usableBy=${u.userId}`)).body).toEqual([])
  })
})
