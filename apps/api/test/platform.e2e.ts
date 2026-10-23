import { Queue } from "bullmq"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}

const u = new URL(process.env.REDIS_URL ?? "redis://localhost:6390")
const connection = { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined }
const timers = new Queue("timers.sla", { connection })
const maintenance = new Queue("maintenance", { connection })
afterAll(async () => { await timers.close(); await maintenance.close() })

async function newRequest() {
  const c = new Session("MOBILE")
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Timer", surnameLatin: "Rebuild" })
  const me = (await c.get("/v1/me")).body
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: "Timer", surname: "Rebuild", dateOfBirth: "1997-03-04", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X22345678", issuingCountry: "IR", expiryDate: "2030-01-01" } })
  const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
  const r = await c.post("/v1/flight-requests", {
    kind: "MANUAL", contactIdentityId: phone.id, travellers: [{ travellerId: t.body.id, passengerType: "ADT" }],
    query: { tripType: "ONE_WAY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
    manual: { flexibility: "Any day", budget: { amountMinor: 60000, currency: "GBP" }, overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] },
    seatPreference: "WINDOW", acknowledgements: { notABooking: true, privacy: true },
  })
  expect(r.status).toBe(201)
  await until(() => c.get(`/v1/flight-requests/${r.body.ref}`), (x) => x.body.status === "NEW")
  return r.body.ref as string
}

describe("Platform resilience and staff live data (ch. 26.2, 29.2)", () => {
  // One staff session for the file: every staffSession() call is a TOTP verify, and those are rate limited per user.
  let admin: Session
  beforeAll(async () => { admin = await staffSession(STAFF.admin, ADMIN_HOST) })

  it("SLA timers are rebuilt from the database after Valkey loses them, under the same job ids", async () => {
    const ref = await newRequest()
    const id = (await admin.get(`/v1/admin/flight-requests/${ref}`)).body.id as string
    const ids = [`fr-${id}--fr.unassigned`, `fr-${id}--fr.unassigned_escalate`]
    const present = async () => (await Promise.all(ids.map((j) => timers.getJob(j)))).filter(Boolean).length
    expect(await until(present, (n) => n === ids.length)).toBe(ids.length)

    for (const j of ids) await (await timers.getJob(j))?.remove()
    expect(await present()).toBe(0)

    await maintenance.add("timers.reconcile", {})
    expect(await until(present, (n) => n === ids.length)).toBe(ids.length)

    // A second reconcile is a no-op for this request: same ids, nothing duplicated.
    const before = (await timers.getJobs(["delayed", "waiting", "active", "completed"])).filter((j) => j.id?.startsWith(`fr-${id}--`)).length
    await maintenance.add("timers.reconcile", {})
    await wait(1500)
    const after = (await timers.getJobs(["delayed", "waiting", "active", "completed"])).filter((j) => j.id?.startsWith(`fr-${id}--`)).length
    expect(after).toBe(before)
  })

  it("the staff directory lists active staff without contact details; customers cannot read it", async () => {
    const r = await admin.get("/v1/admin/staff")
    expect(r.status).toBe(200)
    expect(r.body.items.length).toBeGreaterThanOrEqual(5)
    for (const s of r.body.items) expect(Object.keys(s).sort()).toEqual(["displayName", "id", "onDuty", "roles"])
    expect(r.body.items.some((s: { roles: string[] }) => s.roles.includes("customer") && s.roles.length === 1)).toBe(false)
    // A fresh customer: the demo customers' OTP resend cooldown belongs to the other suites.
    const c = new Session("WEB")
    await signIn(c, randomPhone("+4477009"))
    expect((await c.get("/v1/admin/staff")).status).toBe(403)
  })

  it("staff request detail carries after-sales cases and credit overrides", async () => {
    const ref = await newRequest()
    const d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    expect(d.body.afterSales).toEqual([])
    expect(d.body.creditOverrides).toEqual([])
    const o = await admin.post(`/v1/admin/flight-requests/${ref}/credit-override`, { reason: "Corporate account, pays on invoice" })
    expect(o.status).toBeLessThan(300)
    const again = await admin.get(`/v1/admin/flight-requests/${ref}`)
    expect(again.body.creditOverrides).toEqual([expect.objectContaining({ id: o.body.id, reason: "Corporate account, pays on invoice", requestedByMe: true, approvedAt: null })])
  })

  it("GET /v1/admin/events streams queue counts and request-changed events", async () => {
    const ac = new AbortController()
    const res = await admin.stream("/v1/admin/events", ac.signal)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const reader = res.body!.getReader()
    const events: { event: string; data: any }[] = []
    let buf = ""
    const pump = (async () => {
      const dec = new TextDecoder()
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }))
        if (done) return
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2)
          const ev = /^event: (.+)$/m.exec(block)?.[1]
          const data = /^data: (.+)$/m.exec(block)?.[1]
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) })
        }
      }
    })()
    await until(async () => events.length, (n) => n > 0, 5000)
    expect(events[0]!.event).toBe("queue-counts")
    expect(typeof events[0]!.data.new).toBe("number")
    const ref = await newRequest()
    const changed = await until(async () => events.find((e) => e.event === "request-changed" && e.data.ref === ref), Boolean, 10000)
    expect(changed?.data).toEqual(expect.objectContaining({ requestType: "FLIGHT", ref, version: expect.any(Number) }))
    ac.abort()
    await pump
  })
})
