import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { markVerifiedForTest, randomPhone, Session, signIn, STAFF, staffSession, ADMIN_HOST } from "./client"
import { iso, receivedShipment } from "./cargo-fixture"

const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })

describe("ADR-0008 workflow fixes", () => {
  let cargoStaff: Session
  // One staff sign-in for the file: the OTP resend cooldown is per phone and other suites share these demo users.
  beforeAll(async () => {
    for (let i = 0; i < 4; i++) {
      try { cargoStaff = await staffSession(STAFF.cargo, ADMIN_HOST); return } catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 15_000)) }
    }
  }, 120_000)

  it("W6: the submitted travellers must match the searched passenger mix", async () => {
    const c = new Session("MOBILE")
    await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Neda", surnameLatin: "Mix" })
    const me = (await c.get("/v1/me")).body
    const mk = async (given: string) => { const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: given, surname: "Mix", dateOfBirth: "1990-05-02", genderOnDocument: "F", nationality: "IR", relationship: "OTHER", document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2030-01-01" } }); expect(t.status).toBe(201); await markVerifiedForTest(t.body.id); return t.body.id as string }
    const [a, b] = [await mk("Neda"), await mk("Sara")]
    const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
    const body = (travellers: { travellerId: string; passengerType: string }[]) => ({
      kind: "MANUAL", contactIdentityId: phone.id, travellers,
      query: { tripType: "ONE_WAY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
      manual: { airlinesAvoid: [], airlinesPrefer: [], overlandAcceptable: false }, seatPreference: "NONE", acknowledgements: { notABooking: true, privacy: true },
    })
    const bad = await c.post("/v1/flight-requests", body([{ travellerId: a, passengerType: "ADT" }, { travellerId: b, passengerType: "ADT" }]), { "idempotency-key": randomUUID() })
    expect(bad.status).toBe(400)
    expect(JSON.stringify(bad.body)).toContain("PASSENGER_MIX_MISMATCH")
    const ok = await c.post("/v1/flight-requests", body([{ travellerId: a, passengerType: "ADT" }]), { "idempotency-key": randomUUID() })
    expect(ok.status).toBe(201)
  })

  it("W4 + W2: tracking follows the request state; cargo offline payments are recorded, screened and settle the status", async () => {
    const { admin, ref } = await receivedShipment("MOBILE", cargoStaff)
    const event = (eventCode: string) => admin.post(`/v1/admin/cargo/requests/${ref}/tracking-events`, { eventCode, location: "Heathrow", occurredAt: iso(5) })
    const early = await event("DELIVERED")
    expect(early.status).toBe(409)
    expect(JSON.stringify(early.body)).toContain("OUT_FOR_DELIVERY")
    expect((await event("ARRIVED")).status).toBe(409)
    expect((await event("NOTE")).status).toBeLessThan(300)

    let d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    expect(d.body.paymentRecording).toMatchObject({ allowed: true, suggestedAmount: GBP(5000) })
    const pay = await admin.post(`/v1/admin/cargo/requests/${ref}/payments`, { amount: GBP(5000), method: "BANK_TRANSFER", receivedAt: iso(-10), externalReference: `BANK-${Date.now()}`, payerName: "Leila Shipper" }, { "idempotency-key": randomUUID() })
    expect(pay.status).toBe(201)
    if (pay.body.needsSecondVerifier) {
      const own = await admin.post(`/v1/admin/payments/${pay.body.paymentId}/verify`, {})
      expect(own.status).toBe(409)
      const owner = await staffSession(STAFF.owner, ADMIN_HOST)
      expect((await owner.post(`/v1/admin/payments/${pay.body.paymentId}/verify`, {})).status).toBe(200)
    }
    d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    expect(d.body.paymentStatus).toBe("PAID")
    expect(d.body.payments).toHaveLength(1)
    expect(d.body.paymentRecording.suggestedAmount.amountMinor).toBe(0)
  })

  it("W1: the cargo action list offers dialog commands before any input", async () => {
    const { admin, ref } = await receivedShipment("MOBILE", cargoStaff)
    const d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    const byName = Object.fromEntries((d.body.actions as { command: string; allowed: boolean }[]).map((a) => [a.command, a]))
    expect(byName.cancel).toBeUndefined() // cancel is only before RECEIVED
    expect(byName.raise_exception).toMatchObject({ allowed: true })
    expect(byName.depart).toMatchObject({ allowed: true })
  })
})
