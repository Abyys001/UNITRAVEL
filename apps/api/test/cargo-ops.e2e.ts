import { randomUUID } from "node:crypto"
import { deflateSync } from "node:zlib"

import { describe, expect, it } from "vitest"

import { ADMIN_HOST, API, dbQuery, randomPhone, Session, signIn, STAFF, staffSession } from "./client"
import { iso } from "./cargo-fixture"

const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const party = (name: string, country: string, line1: string) => ({ name, address: { line1, city: country === "GB" ? "London" : "Istanbul", postcode: country === "GB" ? "N1 1AA" : "34000", country }, phone: "+447700900555", email: "receiver@example.com" })

/** A valid 8×8 PNG (red square) built in memory: enough for the metadata stripper and the scan. */
function png(): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 0).fill(Buffer.from([255, 0, 0]))])))
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64")}`
}

async function consoleTestSignIn(email: string) {
  const s = new Session("CONSOLE", ADMIN_HOST)
  const r = await s.post("/v1/auth/test-sign-in", { email, deviceId: s.deviceId, client: "CONSOLE" })
  if (r.status !== 200) throw new Error(`test sign-in ${r.status} ${JSON.stringify(r.body)}`)
  return s
}

const waitFor = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, tries = 60) => {
  let v = await fn()
  for (let i = 0; i < tries && !ok(v); i++) { await new Promise((r) => setTimeout(r, 250)); v = await fn() }
  return v
}

describe("STAGE-33 / ADR-0042 — cargo operations end to end", () => {
  it("request → confirm → tracking number → label → agent collection → delivery attempts → POD; public tracking and milestone emails", async () => {
    // 1. Customer submits from the form (phone sign-in, plus a verified email so milestone notices go by email).
    const c = new Session("WEB")
    await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Leila", surnameLatin: "Shipper" })
    const me = (await c.get("/v1/me")).body
    const email = `cust-${randomUUID().slice(0, 8)}@example.com`
    await dbQuery("insert into user_identities (id, user_id, type, value_normalised, verified_at, is_primary) values ($1, $2, 'EMAIL', $3, now(), false)", [randomUUID(), me.id, email])
    const lanes = (await c.get("/v1/cargo/lanes")).body as { id: string; originCountry: string; destinationCountry: string }[]
    const laneId = lanes.find((l) => l.originCountry === "GB" && l.destinationCountry === "TR")!.id
    const bad = await c.post("/v1/cargo-requests", { service: "PARCEL", laneId, shipperIdentityId: me.identities[0].id, shipper: party("Leila Shipper", "GB", "1 Secret Street"), consignee: party("Mina Receiver", "TR", "9 Hidden Road"), readyDate: "2026-12-02", preferredDeliveryDate: "2026-12-01", handoverMode: "PICKUP", pieces: [{ lengthCm: 20, widthCm: 20, heightCm: 20, weightKg: 8 }], items: [{ description: "Winter clothes", category: "CLOTHING", quantity: 1, unitValue: GBP(5000), originCountry: "GB", purpose: "PERSONAL_EFFECTS" }], declarations: { batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: false }, declaredTotal: GBP(5000), consents: { accuracy: true, prohibitedItems: true, privacy: true } })
    expect(bad.status).toBe(400)
    const sub = await c.post("/v1/cargo-requests", {
      service: "PARCEL", laneId, shipperIdentityId: me.identities[0].id, shipper: party("Leila Shipper", "GB", "1 Secret Street"), consignee: party("Mina Receiver", "TR", "9 Hidden Road"),
      readyDate: "2026-12-02", preferredDeliveryDate: "2026-12-09", handlingInstructions: "Fragile, keep upright", handoverMode: "PICKUP",
      pieces: [{ lengthCm: 20, widthCm: 20, heightCm: 20, weightKg: 8 }, { lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 4 }],
      items: [{ description: "Winter clothes", category: "CLOTHING", quantity: 1, unitValue: GBP(5000), originCountry: "GB", purpose: "PERSONAL_EFFECTS" }],
      declarations: { batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: false }, declaredTotal: GBP(5000), consents: { accuracy: true, prohibitedItems: true, privacy: true },
    })
    expect(sub.status).toBe(201)
    const ref = sub.body.ref as string
    const mine = (await c.get(`/v1/cargo-requests/${ref}`)).body
    expect(mine).toMatchObject({ preferredDeliveryDate: "2026-12-09", handlingInstructions: "Fragile, keep upright", milestone: "REQUEST_RECEIVED", trackingNumber: null })

    // 2. It appears in the admin operations list (pending), searchable by name.
    const admin = await staffSession(STAFF.cargo, ADMIN_HOST)
    const pending = await waitFor(() => admin.get(`/v1/admin/cargo/ops/requests?tab=pending&q=Mina%20Receiver`), (r) => r.body.items?.some((x: { ref: string }) => x.ref === ref))
    expect(pending.body.items.find((x: { ref: string }) => x.ref === ref)).toMatchObject({ milestone: "REQUEST_RECEIVED", pieces: 2, weightKg: 12 })
    const stats = await admin.get("/v1/admin/cargo/ops/stats")
    expect(stats.body.pending).toBeGreaterThan(0)

    // 3. Approve: review, quote, the customer accepts → tracking number issued automatically.
    let d: any
    d = await waitFor(() => admin.get(`/v1/admin/cargo/requests/${ref}`), (r) => r.body.status === "NEW")
    const v = () => ({ "if-match": String(d.body.version) })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/claim`, {}, v())
    const partner = d.body.eligiblePartners.find((p: { complianceStatus: string }) => p.complianceStatus === "CLEARED")
    const lines = { freight: { ratePerKg: GBP(450), chargeableKg: 12, amount: GBP(5400) }, fuelSurcharge: GBP(600), securitySurcharge: GBP(300), handling: GBP(500), customsBrokerage: GBP(0), dutiesTaxes: "PAYABLE_BY_CONSIGNEE", dutiesEstimate: true, insurance: GBP(0), pickup: GBP(1000), delivery: GBP(0), total: GBP(7800) }
    const q = await admin.post(`/v1/admin/cargo/requests/${ref}/quotes`, { partnerId: partner.id, lines, transitNote: "3–6 working days" })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/send_quote`, { quoteId: q.body.id }, v())
    expect((await c.post(`/v1/cargo-requests/${ref}/quotes/${q.body.id}/accept`)).status).toBe(200)
    let ops = (await admin.get(`/v1/admin/cargo/requests/${ref}/operations`)).body
    expect(ops.trackingNumber).toMatch(/^UT\d{11}$/)
    expect(ops.milestone).toBe("REQUEST_CONFIRMED")
    const tn = ops.trackingNumber as string
    // Issuing again is idempotent.
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-number`)).body.trackingNumber).toBe(tn)

    // 4. Book with the partner; a label needs the tracking number and has one page per piece.
    d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/record_booking`, { partnerId: partner.id, partnerReference: "DCP-90210" }, v())
    for (const format of ["4x6", "A6", "A4"]) {
      const lab = await admin.post(`/v1/admin/cargo/requests/${ref}/labels`, { format })
      expect(lab.status).toBe(201)
      const pdf = Buffer.from(await (await fetch(lab.body.url)).arrayBuffer())
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
      const { PDFDocument } = await import("pdf-lib")
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(format === "A4" ? 1 : 2)
      if (process.env.LABEL_OUT) (await import("node:fs")).writeFileSync(`${process.env.LABEL_OUT}/label-${format}.pdf`, pdf)
    }
    ops = (await admin.get(`/v1/admin/cargo/requests/${ref}/operations`)).body
    expect(ops.labels).toHaveLength(3)
    expect(ops.labels.filter((l: { voidedAt: string | null }) => !l.voidedAt)).toHaveLength(1)

    // 5. Public tracking: no sign-in, signed QR verifies, nothing private, typos 404.
    const anon = new Session("WEB")
    let pub = await anon.get(`/v1/public/cargo-tracking/${tn.slice(0, 6)} ${tn.slice(6)}`)
    expect(pub.status).toBe(200)
    expect(pub.body).toMatchObject({ trackingNumber: tn, milestone: "AWAITING_COLLECTION", origin: { city: "London" }, destination: { city: "Istanbul" }, labelVerified: null })
    const wire = JSON.stringify(pub.body)
    for (const secret of ["Leila", "Mina", "Secret Street", "Hidden Road", "+447700900555", "receiver@example.com", "N1 1AA", ref]) expect(wire).not.toContain(secret)
    const typo = tn.slice(0, 12) + String((Number(tn[12]) + 1) % 10)
    expect((await anon.get(`/v1/public/cargo-tracking/${typo}`)).status).toBe(404)
    expect((await anon.get(`/v1/public/cargo-tracking/${tn}?s=forged`)).body.labelVerified).toBe(false)

    // 6. Agent Management: create an agent by email, assign the collection job.
    const agentEmail = `agent-${randomUUID().slice(0, 8)}@example.com`
    const drv = await admin.post("/v1/admin/cargo/agents", { displayName: "Dara Moradi", email: agentEmail, phone: "+447700900777", vehicle: "Van LX24 ABC", agentType: "DRIVER", responsibilities: ["COLLECTION", "DELIVERY"], publicName: "Dara M." })
    expect(drv.status).toBe(201)
    const other = await admin.post("/v1/admin/cargo/agents", { displayName: "Omid Other", agentType: "COURIER", responsibilities: ["DELIVERY"], email: `other-${randomUUID().slice(0, 8)}@example.com` })
    const asg = await admin.post(`/v1/admin/cargo/requests/${ref}/assignments`, { agentIds: [drv.body.id], kind: "COLLECTION", scheduledFor: iso(60), location: "London" })
    expect(asg.status).toBe(201)
    // A delivery agent cannot be assigned before the shipment is received.
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/assignments`, { agentIds: [other.body.id], kind: "DELIVERY", location: "Istanbul" })).status).toBe(409)

    // 7. The agent signs in on the admin host and sees only their own job.
    const agent = await consoleTestSignIn(agentEmail)
    const otherAgent = await consoleTestSignIn(other.body.email)
    const jobs = (await agent.get("/v1/agent/jobs")).body
    expect(jobs.jobs).toHaveLength(1)
    const job = jobs.jobs[0]
    expect(job).toMatchObject({ ref, kind: "COLLECTION", trackingNumber: tn, milestone: "COLLECTION_SCHEDULED", handlingInstructions: "Fragile, keep upright" })
    expect(job.pickup.address).toContain("1 Secret Street")
    expect((await otherAgent.get(`/v1/agent/jobs/${job.assignmentId}`)).status).toBe(404)
    expect((await otherAgent.post(`/v1/agent/jobs/${job.assignmentId}/actions/collected`, { location: "London", handedOverBy: "Leila Shipper" })).status).toBe(404)
    // Agents have no admin permissions.
    expect((await agent.get("/v1/admin/cargo/ops/requests")).status).toBe(403)
    expect((await agent.post(`/v1/admin/cargo/requests/${ref}/commands/receive`, {})).status).toBe(403)
    expect((await agent.get(`/v1/admin/cargo/requests/${ref}`)).status).toBe(403)

    // 8. Collection with a signature; a delivery action is refused on a collection job.
    expect((await agent.post(`/v1/agent/jobs/${job.assignmentId}/actions/delivered`, { location: "London", receiverName: "X Y", photoDocumentIds: [] })).status).toBe(400)
    const signature = await agent.post(`/v1/agent/jobs/${job.assignmentId}/files`, { filename: "signature.png", data: png(), purpose: "SIGNATURE" })
    expect(signature.status).toBe(201)
    const col = await agent.post(`/v1/agent/jobs/${job.assignmentId}/actions/collected`, { location: "London", handedOverBy: "Leila Shipper", signatureDocumentId: signature.body.documentId })
    expect(col.status).toBe(200)
    expect(col.body).toMatchObject({ status: "COMPLETED", milestone: "CARGO_COLLECTED" })
    expect((await anon.get(`/v1/public/cargo-tracking/${tn}`)).body.milestone).toBe("CARGO_COLLECTED")

    // 9. Hub: schedule handover, weigh, sort, depart. Then a delivery agent.
    d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/schedule_handover`, { note: "Collected by agent" }, v())
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/receive`, { verifiedWeights: d.body.pieces.map((p: { id: string; weightKg: number }) => ({ pieceId: p.id, weightKg: p.weightKg })), location: "London hub" }, v())
    expect(d.body.status).toBe("RECEIVED")
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-events`, { eventCode: "SORTING_FACILITY", location: "London sorting centre", occurredAt: iso(1) })).status).toBe(201)
    expect((await anon.get(`/v1/public/cargo-tracking/${tn}`)).body.milestone).toBe("AT_SORTING_FACILITY")
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/depart`, { location: "LHR", occurredAt: iso(2) }, v())
    expect(d.body.status).toBe("IN_TRANSIT")
    const del = await admin.post(`/v1/admin/cargo/requests/${ref}/assignments`, { agentIds: [drv.body.id], kind: "DELIVERY", location: "Istanbul" })
    expect(del.status).toBe(201)
    const djob = (await agent.get("/v1/agent/jobs")).body.jobs.find((j: { kind: string }) => j.kind === "DELIVERY")
    expect(djob.actions).toEqual(["out_for_delivery", "report_problem", "note"])

    // 10. Out for delivery, a failed attempt, a second attempt, delivered with photo and signature.
    let r = await agent.post(`/v1/agent/jobs/${djob.assignmentId}/actions/out_for_delivery`, { location: "Istanbul" })
    expect(r.status).toBe(200)
    expect(r.body.cargoStatus).toBe("OUT_FOR_DELIVERY")
    r = await agent.post(`/v1/agent/jobs/${djob.assignmentId}/actions/delivery_failed`, { location: "Istanbul", reason: "NO_ONE_AVAILABLE", description: "Card left" })
    expect(r.body).toMatchObject({ milestone: "DELIVERY_FAILED", attempts: 1, status: "ASSIGNED" })
    pub = await anon.get(`/v1/public/cargo-tracking/${tn}`)
    expect(pub.body.milestone).toBe("DELIVERY_FAILED")
    expect(JSON.stringify(pub.body)).not.toContain("Card left")
    const failedTab = (await admin.get(`/v1/admin/cargo/ops/requests?tab=failed&q=${ref}`)).body
    expect(failedTab.items.map((x: { ref: string }) => x.ref)).toContain(ref)
    r = await agent.post(`/v1/agent/jobs/${djob.assignmentId}/actions/out_for_delivery`, { location: "Istanbul" })
    expect(r.body.milestone).toBe("OUT_FOR_DELIVERY")
    const photo = await agent.post(`/v1/agent/jobs/${djob.assignmentId}/files`, { filename: "door.png", data: png(), purpose: "PHOTO" })
    const sig2 = await agent.post(`/v1/agent/jobs/${djob.assignmentId}/files`, { filename: "sig.png", data: png(), purpose: "SIGNATURE" })
    // Proof is required.
    expect((await agent.post(`/v1/agent/jobs/${djob.assignmentId}/actions/delivered`, { location: "Istanbul", receiverName: "Mina Receiver" })).status).toBe(400)
    r = await agent.post(`/v1/agent/jobs/${djob.assignmentId}/actions/delivered`, { location: "Istanbul", receiverName: "Mina Receiver", signatureDocumentId: sig2.body.documentId, photoDocumentIds: [photo.body.documentId] })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ cargoStatus: "DELIVERED", milestone: "DELIVERED", status: "COMPLETED" })
    expect((await agent.get("/v1/agent/jobs?scope=done")).body.jobs).toHaveLength(2)

    pub = await anon.get(`/v1/public/cargo-tracking/${tn}`, { "accept-language": "fa" })
    expect(pub.body).toMatchObject({ milestone: "DELIVERED", delivered: { receivedBy: "M. R." } })
    // ADR-0043: agent updates are labelled and attributed by the agent's public name only.
    const byAgent = pub.body.timeline.filter((t: { agent: string | null }) => t.agent)
    expect(byAgent.length).toBeGreaterThan(3)
    expect(byAgent.every((t: { agent: string }) => t.agent === "Dara M.")).toBe(true)
    expect(JSON.stringify(pub.body)).not.toMatch(/Moradi|agent-|\+447700900777/)
    expect(pub.body.milestoneLabel).toBe("تحویل داده شد")
    expect(JSON.stringify(pub.body)).not.toContain("Mina")
    ops = (await admin.get(`/v1/admin/cargo/requests/${ref}/operations`)).body
    expect(ops.proofs.map((p: { kind: string }) => p.kind).sort()).toEqual(["COLLECTION", "DELIVERY"])

    // 11. One notice per milestone, each emailed once (never twice for the same status).
    const keys = await waitFor(() => dbQuery<{ key: string }>("select key from cargo_notifications where cargo_request_id = (select id from cargo_requests where ref = $1) order by created_at", [ref]), (rows) => rows.some((x) => x.key === "DELIVERED"))
    const k = keys.map((x) => x.key)
    for (const want of ["REQUEST_RECEIVED", "REQUEST_CONFIRMED", "TRACKING_NUMBER", "AGENT_ASSIGNED:COLLECTION", "COLLECTION_SCHEDULED", "CARGO_COLLECTED", "AT_SORTING_FACILITY", "IN_TRANSIT", "AGENT_ASSIGNED:DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"]) expect(k).toContain(want)
    expect(k.filter((x) => x.startsWith("DELIVERY_FAILED:"))).toHaveLength(1)
    expect(new Set(k).size).toBe(k.length)
    const customerKeys = k.filter((x) => !x.startsWith("RECIPIENT:"))
    const emails = await waitFor(() => dbQuery<{ status: string; destination: string }>(`select d.status, d.destination from notification_deliveries d join notifications n on n.id = d.notification_id where d.channel = 'EMAIL' and n.user_id = $1 and n.event_type like 'cargo.milestone%'`, [me.id]), (rows) => rows.length >= customerKeys.length && rows.every((x) => x.status === "SENT"))
    expect(emails.length).toBe(customerKeys.length)
    expect(emails.every((x) => x.status === "SENT" && x.destination.startsWith(email.slice(0, 4)))).toBe(true)
    const sink = (await (await fetch(`${API}/v1/dev-sink/email`)).json()) as { to: string; subject: string; body: string }[]
    const delivered = sink.find((m) => m.to === email && m.subject.includes("Delivered"))
    expect(delivered?.body).toContain(tn)
    expect(delivered?.body).toContain(`/en/tracking/${tn}`)
    expect(delivered?.body).toContain(ref)

    // 12. Audit trail.
    const audit = await dbQuery<{ action: string }>("select action from audit_log where context_ref = $1", [ref])
    const actions = audit.map((a) => a.action)
    for (const want of ["cargo_request.tracking_number_issued", "cargo_request.label_generated", "cargo_request.agent_assigned", "cargo_request.agent_collected", "cargo_request.agent_delivery_failed", "cargo_request.agent_delivered"]) expect(actions).toContain(want)
  }, 180_000)
})
