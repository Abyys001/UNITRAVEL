import { ADMIN_HOST, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const party = (name: string, country: string) => ({ name, address: { line1: "1 Test Street", city: country === "GB" ? "London" : "Istanbul", postcode: "N1 1AA", country }, phone: "+447700900555" })
/** Minutes after now: the RECEIVED scan is stamped at the time of the command, so later events must follow it. */
export const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

async function customer(client: "MOBILE" | "WEB") {
  const c = new Session(client)
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Leila", surnameLatin: "Shipper" })
  const me = (await c.get("/v1/me")).body
  const lanes = (await c.get("/v1/cargo/lanes")).body as { id: string; originCountry: string; destinationCountry: string }[]
  return { c, phoneId: me.identities[0].id as string, laneId: lanes.find((l) => l.originCountry === "GB" && l.destinationCountry === "TR")!.id }
}

/** A GB → TR parcel taken to RECEIVED through the real staff commands. */
/**
 * `staff` is a phone (signed in through the API) or an already signed-in cargo-capable staff session. A browser suite
 * passes a session built from its own signed-in page so that no second OTP request spends the phone's resend cooldown.
 */
export async function receivedShipment(client: "MOBILE" | "WEB" = "MOBILE", staff: string | Session = STAFF.cargo) {
  const { c, phoneId, laneId } = await customer(client)
  const sub = await c.post("/v1/cargo-requests", {
    service: "PARCEL", laneId, shipperIdentityId: phoneId, shipper: party("Leila Shipper", "GB"), consignee: party("Mina Receiver", "TR"), readyDate: "2026-11-02", handoverMode: "PICKUP",
    pieces: [{ lengthCm: 20, widthCm: 20, heightCm: 20, weightKg: 8 }], items: [{ description: "Winter clothes", category: "CLOTHING", quantity: 1, unitValue: GBP(5000), originCountry: "GB", purpose: "PERSONAL_EFFECTS" }],
    declarations: { batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: false }, declaredTotal: GBP(5000), consents: { accuracy: true, prohibitedItems: true, privacy: true },
  })
  if (sub.status !== 201) throw new Error(`cargo request ${sub.status} ${JSON.stringify(sub.body)}`)
  const ref = sub.body.ref as string
  const admin = typeof staff === "string" ? await staffSession(staff, ADMIN_HOST) : staff
  let d: any
  for (let i = 0; i < 40; i++) { d = await admin.get(`/v1/admin/cargo/requests/${ref}`); if (d.body.status === "NEW") break; await new Promise((r) => setTimeout(r, 300)) }
  const v = () => ({ "if-match": String(d.body.version) })
  d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/claim`, {}, v())
  const partner = d.body.eligiblePartners.find((p: { complianceStatus: string }) => p.complianceStatus === "CLEARED")
  const lines = { freight: { ratePerKg: GBP(450), chargeableKg: 8, amount: GBP(3600) }, fuelSurcharge: GBP(600), securitySurcharge: GBP(300), handling: GBP(500), customsBrokerage: GBP(0), dutiesTaxes: "PAYABLE_BY_CONSIGNEE", dutiesEstimate: true, insurance: GBP(0), pickup: GBP(0), delivery: GBP(0), total: GBP(5000) }
  const q = await admin.post(`/v1/admin/cargo/requests/${ref}/quotes`, { partnerId: partner.id, lines, transitNote: "3–6 working days" })
  d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/send_quote`, { quoteId: q.body.id }, v())
  await c.post(`/v1/cargo-requests/${ref}/quotes/${q.body.id}/accept`)
  d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
  d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/record_booking`, { partnerId: partner.id, partnerReference: "DCP-90210", awbNumber: "176-12345675" }, v())
  d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/schedule_handover`, { note: "Courier pickup" }, v())
  d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/receive`, { verifiedWeights: [{ pieceId: d.body.pieces[0].id, weightKg: 8 }], location: "London hub" }, v())
  if (d.body.status !== "RECEIVED") throw new Error(`expected RECEIVED, got ${d.body.status}`)
  return { c, admin, ref, id: d.body.id as string }
}

