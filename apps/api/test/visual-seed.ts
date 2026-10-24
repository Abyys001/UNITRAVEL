import { randomUUID } from "node:crypto"

import { iso, receivedShipment } from "./cargo-fixture"
import { ADMIN_HOST, markVerifiedForTest, type Session, STAFF, staffSession } from "./client"

const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const seg = (from: string, to: string, depLocal: string, depUtc: string, arrLocal: string, arrUtc: string, fromTz: string, toTz: string) => ({
  marketing: { carrier: "BA", flightNumber: "675" }, operating: { carrier: "BA", flightNumber: "675" }, origin: { iata: from, terminal: "1" }, destination: { iata: to, terminal: "2" },
  departure: { local: depLocal, utc: depUtc, tz: fromTz }, arrival: { local: arrLocal, utc: arrUtc, tz: toTz }, cabin: "ECONOMY", technicalStops: [],
})
const SLICES = [{ origin: "IST", destination: "LHR", durationMin: 285, segments: [seg("IST", "LHR", "2026-12-14T13:50", "2026-12-14T10:50:00Z", "2026-12-14T15:35", "2026-12-14T15:35:00Z", "Europe/Istanbul", "Europe/London")] }]

/**
 * One customer with everything the web screens show: a received cargo shipment with a corrected tracking timeline and an
 * estimate, an issued invoice, and a manual flight request with a sent quote. Used only to record the visual cassettes
 * (apps/web/e2e/visual-capture.spec.ts); the recorded JSON is what the snapshot tests replay.
 */
export async function seedVisualWorld(ownerSession?: Session) {
  const owner = ownerSession ?? (await staffSession(STAFF.owner, ADMIN_HOST))
  const { c, ref: cargoRef } = await receivedShipment("WEB", owner)
  await owner.post(`/v1/admin/cargo/requests/${cargoRef}/tracking-events`, { eventCode: "DEPARTED", location: "LHR", occurredAt: iso(1) })
  const detail = await owner.get(`/v1/admin/cargo/requests/${cargoRef}`)
  const departed = detail.body.tracking.find((t: { eventCode: string }) => t.eventCode === "DEPARTED")
  await owner.post(`/v1/admin/cargo/requests/${cargoRef}/tracking-corrections`, { correctsEventId: departed.id, eventCode: "AT_CUSTOMS", location: "IST customs", occurredAt: iso(3), reason: "Wrong scan" })
  await owner.put(`/v1/admin/cargo/requests/${cargoRef}/estimated-delivery`, { estimatedDeliveryAt: new Date(Date.now() + 3 * 86_400_000).toISOString() })

  const draft = await owner.post(`/v1/admin/requests/${cargoRef}/invoices`)
  const issued = await owner.post(`/v1/admin/invoices/${draft.body.id}/issue`)
  if (issued.status !== 200) throw new Error(`invoice issue ${issued.status} ${JSON.stringify(issued.body)}`)

  const me = (await c.get("/v1/me")).body
  const phoneId = me.identities.find((i: { type: string }) => i.type === "PHONE").id as string
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: "Leila", surname: "Shipper", dateOfBirth: "1998-05-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2030-01-01" } })
  if (t.status !== 201) throw new Error(`traveller ${t.status} ${JSON.stringify(t.body)}`)
  await markVerifiedForTest(t.body.id)
  const sub = await c.post("/v1/flight-requests", {
    kind: "MANUAL", contactIdentityId: phoneId, travellers: [{ travellerId: t.body.id, passengerType: "ADT" }],
    query: { tripType: "ONE_WAY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
    manual: { flexibility: "Any day that week", budget: GBP(60000), overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] },
    seatPreference: "WINDOW", bestTimeToCall: "10:00–14:00 Tehran", note: "Student, first time travelling to the UK", acknowledgements: { notABooking: true, privacy: true },
  }, { "idempotency-key": randomUUID() })
  if (sub.status !== 201) throw new Error(`flight request ${sub.status} ${JSON.stringify(sub.body)}`)
  const flightRef = sub.body.ref as string
  let d: any
  for (let i = 0; i < 40; i++) { d = await owner.get(`/v1/admin/flight-requests/${flightRef}`); if (d.body.status === "NEW") break; await new Promise((r) => setTimeout(r, 300)) }
  d = await owner.post(`/v1/admin/flight-requests/${flightRef}/commands/claim`, {}, { "if-match": String(d.body.version) })
  const option = {
    label: "BA via Istanbul", source: "MANUAL", slices: SLICES, components: [],
    priceBreakdown: { fare: GBP(30000), taxes: GBP(9000), serviceFee: GBP(2500), total: GBP(41500) },
    baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } }, cabin: { status: "KNOWN", value: true } }],
    conditions: { change: { status: "KNOWN", value: { allowed: true, penalty: GBP(5000) } }, refund: { status: "KNOWN", value: { allowed: false } } },
    ticketingModel: "SINGLE_TICKET", internalCostMinor: 38000,
  }
  const q = await owner.post(`/v1/admin/flight-requests/${flightRef}/quotes`, { currency: "GBP", options: [option] })
  const sent = await owner.post(`/v1/admin/flight-requests/${flightRef}/commands/send_quote`, { quoteId: q.body.id }, { "if-match": String(d.body.version) })
  if (sent.status !== 200) throw new Error(`send_quote ${sent.status} ${JSON.stringify(sent.body)}`)
  return { c, owner, customerId: me.id as string, cargoRef, flightRef, invoiceNumber: issued.body.number as string, invoiceId: draft.body.id as string }
}
