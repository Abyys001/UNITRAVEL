import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, DEV_HOST, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

/** ADR-0040 customer portal: overview, unread counts, inbox filters, support read state, purchase tracking, TrackingMore settings. Needs the API restarted on this change and migration 0031 applied. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
const anon = new Session("WEB")
let dev: Session, admin: Session
const FLAGS = ["services.tours.enabled", "loyalty.enabled"] as const
const initial: Record<string, boolean> = {}
const MENU = { "services.tours.enabled": "tours", "loyalty.enabled": "club" } as const

async function setFlag(key: (typeof FLAGS)[number], enabled: boolean) {
  expect((await dev.put(`/v1/dev/feature-flags/${key}`, { enabled })).status).toBe(200)
  await until(async () => (await anon.get("/v1/site")).body.menu[MENU[key]], (v) => v === enabled)
}

async function customer(name: string) {
  const c = new Session("WEB")
  const phone = randomPhone("+98912")
  await signIn(c, phone, { givenNamesLatin: name, surnameLatin: "Portal" })
  const me = (await c.get("/v1/me")).body
  return { c, userId: me.id as string, contactIdentityId: me.identities[0].id as string, phone }
}
type Cust = Awaited<ReturnType<typeof customer>>
const tour = (u: Cust) => ({ type: "TOUR_CALLBACK", contactIdentityId: u.contactIdentityId, acknowledgements: { notABooking: true, privacy: true }, details: { destination: "Istanbul", approxDates: "April 2027", travellersCount: 2, bestTimeToCall: "evenings" } })
const ticket = (c: Session) => c.post("/v1/support/tickets", { name: "Portal Tester", email: "portal-tester@example.com", topic: "BOOKING", message: "Where is my confirmation, please?", deviceId: c.deviceId }, { "idempotency-key": randomUUID() })

beforeAll(async () => {
  dev = await staffSession(STAFF.developer, DEV_HOST)
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  const menu = (await anon.get("/v1/site")).body.menu
  for (const k of FLAGS) initial[k] = menu[MENU[k]]
  for (const k of FLAGS) if (!initial[k]) await setFlag(k, true)
})
afterAll(async () => {
  for (const k of FLAGS) await dev.put(`/v1/dev/feature-flags/${k}`, { enabled: initial[k] ?? false })
})

describe("portal overview and tracking (ADR-0040 D1, D4)", () => {
  let a: Cust, b: Cust, ref: string

  it("lists only the signed-in customer's items, with named steps and the status label", async () => {
    a = await customer("Aria"); b = await customer("Bita")
    const sub = await a.c.post("/v1/service-requests", tour(a))
    expect(sub.status).toBe(201)
    ref = sub.body.ref
    const mine = await a.c.get("/v1/me/overview")
    expect(mine.status).toBe(200)
    const item = mine.body.active.find((i: { ref: string }) => i.ref === ref)
    expect(item).toMatchObject({ kind: "SERVICE", status: "SUBMITTED", active: true })
    expect(item.steps.filter((s: { state: string }) => s.state === "CURRENT")).toHaveLength(1)
    expect(mine.body.travelCard).toEqual({ status: "COMING_SOON" })
    const theirs = await b.c.get("/v1/me/overview")
    expect(JSON.stringify(theirs.body)).not.toContain(ref)
  })

  it("reflects a status change made by staff", async () => {
    const d = await admin.get(`/v1/admin/service-requests/${ref}`)
    const moved = await admin.post(`/v1/admin/service-requests/${ref}/transition`, { command: "claim", expectedVersion: d.body.version, input: {} })
    expect([200, 201]).toContain(moved.status)
    const after = await until(() => a.c.get("/v1/me/overview"), (r) => r.body.active.find((i: { ref: string }) => i.ref === ref)?.status === "IN_PROGRESS")
    expect(after.body.active.find((i: { ref: string }) => i.ref === ref).status).toBe("IN_PROGRESS")
  })

  it("track detail is the owner's; anyone else gets 404, and search finds only own references", async () => {
    const own = await a.c.get(`/v1/track/${ref}`)
    expect(own.status).toBe(200)
    expect(own.body).toMatchObject({ kind: "SERVICE", ref, detailHref: `/services/${ref}`, shipment: null })
    expect(own.body.events.length).toBeGreaterThan(0)
    expect((await b.c.get(`/v1/track/${ref}`)).status).toBe(404)
    expect((await a.c.get(`/v1/track/search?q=${ref}`)).body).toEqual({ ref })
    expect((await b.c.get(`/v1/track/search?q=${ref}`)).body).toEqual({ ref: null })
    expect((await anon.get(`/v1/track/${ref}`)).status).toBe(401)
    expect((await anon.get("/v1/me/overview")).status).toBe(401)
  })
})

describe("inbox (ADR-0040 D2)", () => {
  it("filters unread and important, pages by cursor, and cannot mark another user's messages", async () => {
    const a = await customer("Cyrus"), b = await customer("Dara")
    await a.c.post("/v1/service-requests", tour(a))
    const page = await until(() => a.c.get("/v1/notifications?filter=unread&limit=1"), (r) => r.body.items.length > 0)
    expect(page.body).toMatchObject({ unread: expect.any(Number) })
    expect(page.body.items.every((i: { readAt: string | null }) => i.readAt === null)).toBe(true)
    expect(page.body.nextCursor).toBe(page.body.nextBefore)
    const important = await a.c.get("/v1/notifications?filter=important")
    expect(important.body.items.every((i: { critical: boolean }) => i.critical)).toBe(true)
    const id = page.body.items[0].id as string
    expect((await b.c.post("/v1/notifications/read", { ids: [id] })).status).toBe(204)
    expect((await a.c.get("/v1/notifications?filter=unread")).body.items.some((i: { id: string }) => i.id === id)).toBe(true)
    expect((await a.c.get("/v1/me/unread")).body.inbox).toBeGreaterThan(0)
    expect((await a.c.post("/v1/notifications/read", { ids: [id] })).status).toBe(204)
    expect((await a.c.get("/v1/notifications?filter=unread")).body.items.some((i: { id: string }) => i.id === id)).toBe(false)
  })
})

describe("support read state (ADR-0040 D3)", () => {
  it("flips to unread on a staff reply, clears on open, and is private to the owner", async () => {
    const a = await customer("Ela"), b = await customer("Farid")
    const t = await ticket(a.c)
    expect(t.status).toBe(201)
    const ref = t.body.ref as string
    expect((await a.c.get("/v1/support/tickets")).body.find((x: { ref: string }) => x.ref === ref).unread).toBe(false)
    expect((await admin.post(`/v1/admin/support/tickets/${ref}/replies`, { body: "We have it in hand.", internal: false })).status).toBe(200)
    const list = await a.c.get("/v1/support/tickets")
    expect(list.body.find((x: { ref: string }) => x.ref === ref).unread).toBe(true)
    expect((await a.c.get("/v1/me/unread")).body.support).toBe(1)
    const overview = (await a.c.get("/v1/me/overview")).body
    expect(overview.pendingActions.some((p: { kind: string; ref: string }) => p.kind === "SUPPORT_REPLY" && p.ref === ref)).toBe(true)
    const note = await until(() => a.c.get("/v1/notifications"), (r) => r.body.items.some((i: { eventType: string }) => i.eventType === "support.reply"))
    expect(note.body.items.find((i: { eventType: string }) => i.eventType === "support.reply").data.ref).toBe(ref)
    expect((await b.c.get(`/v1/support/tickets/${ref}`)).status).toBe(404)
    expect((await a.c.get("/v1/support/tickets")).body.find((x: { ref: string }) => x.ref === ref).unread).toBe(true)
    expect((await a.c.get(`/v1/support/tickets/${ref}`)).status).toBe(200)
    expect((await a.c.get("/v1/support/tickets")).body.find((x: { ref: string }) => x.ref === ref).unread).toBe(false)
    expect((await a.c.get("/v1/me/unread")).body.support).toBe(0)
  })
})

describe("club in the portal (ADR-0040 D6)", () => {
  it("an admin adds a member, the customer sees it in /me/club and the overview, and cannot call club mutations", async () => {
    const u = await customer("Gita")
    const code = `PT${Date.now().toString(36).toUpperCase().slice(-6)}`
    const tier = await admin.post("/v1/admin/club/tiers", { code, nameEn: "Portal tier", nameFa: "سطح پورتال" })
    expect(tier.status).toBe(201)
    expect((await admin.post("/v1/admin/club/members", { userId: u.userId, tierId: tier.body.id })).status).toBe(201)
    const club = await u.c.get("/v1/me/club")
    expect(club.body.member.tier.code).toBe(code)
    const ov = (await u.c.get("/v1/me/overview")).body.club
    expect(ov).toMatchObject({ enabled: true, member: { tierNameEn: "Portal tier", status: "ACTIVE" } })
    // ADR-0039: staff-managed points reach the club page and the overview, without the internal reason or the actor.
    const grant = await admin.post(`/v1/admin/club/members/${u.userId}/points`, { kind: "GRANTED", points: 120, reason: "Portal e2e internal reason", customerNote: "Welcome gift" })
    expect(grant.status).toBe(201)
    const pts = (await u.c.get("/v1/me/club")).body.points
    expect(pts.balance).toBe(120)
    expect(pts.history[0]).toMatchObject({ kind: "GRANTED", note: "Welcome gift" })
    expect(JSON.stringify(pts)).not.toMatch(/internal reason|actor/i)
    expect((await u.c.get("/v1/me/overview")).body.club.points).toBe(120)
    const other = await customer("Iman")
    expect(JSON.stringify((await other.c.get("/v1/me/club")).body)).not.toContain("Welcome gift")
    expect((await other.c.get("/v1/me/overview")).body.club?.points ?? null).toBeNull()
    expect([403, 404]).toContain((await other.c.post(`/v1/admin/club/members/${u.userId}/points`, { kind: "GRANTED", points: 5, reason: "Not allowed" })).status)
    for (const [m, p] of [["post", "/v1/admin/club/members"], ["post", "/v1/admin/club/tiers"], ["get", "/v1/admin/club/members"]] as const) {
      expect((await (m === "post" ? u.c.post(p, {}) : u.c.get(p))).status).toBe(403)
    }
  })
})

describe("TrackingMore settings (ADR-0040 D5)", () => {
  it("is a Developer Panel setting: never returns the key, refuses customers and the Admin Panel", async () => {
    const view = await dev.get("/v1/dev/cargo-tracking")
    expect(view.status).toBe(200)
    expect(view.body).toMatchObject({ provider: "TRACKINGMORE", enabled: expect.any(Boolean), keyConfigured: expect.any(Boolean), dpiaApproved: expect.any(Boolean) })
    expect(JSON.stringify(view.body)).not.toMatch(/apiKey|secret/i)
    const u = await customer("Hana")
    // Dev routes answer 404 to anyone off the developer surface (matrix.e2e.ts); the Admin Panel route is a plain 403.
    expect((await u.c.get("/v1/dev/cargo-tracking")).status).toBe(404)
    expect((await u.c.put("/v1/dev/cargo-tracking", { enabled: true })).status).toBe(404)
    expect((await admin.get("/v1/dev/cargo-tracking")).status).toBe(404)
    expect((await u.c.post("/v1/admin/cargo/requests/UT-C-AAAAAA/carrier-sync")).status).toBe(403)
  })
})
