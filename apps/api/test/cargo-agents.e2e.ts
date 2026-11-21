import { randomUUID } from "node:crypto"
import { deflateSync } from "node:zlib"

import { describe, expect, it } from "vitest"

import { ADMIN_HOST, dbQuery, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const key = () => ({ "idempotency-key": randomUUID() })

function png(): string {
  const t = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const h = Buffer.alloc(13); h.writeUInt32BE(8, 0); h.writeUInt32BE(8, 4); h[8] = 8; h[9] = 2
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 90)])))
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", h), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64")}`
}
async function agentSession(email: string) {
  const s = new Session("CONSOLE", ADMIN_HOST)
  const r = await s.post("/v1/auth/test-sign-in", { email, deviceId: s.deviceId, client: "CONSOLE" })
  if (r.status !== 200) throw new Error(`sign-in ${r.status}`)
  return s
}

describe("ADR-0043 — Agent Management, assignment, dashboard and identity", () => {
  it("agents: IDs, types, photo, acceptance, decline, several agents, handling, problem reports, public names, performance", async () => {
    const admin = await staffSession(STAFF.cargo, ADMIN_HOST)
    const mk = (name: string, agentType: string, responsibilities: string[], extra: Record<string, unknown> = {}) =>
      admin.post("/v1/admin/cargo/agents", { displayName: name, email: `${name.split(" ")[0]!.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`, agentType, responsibilities, ...extra })
    const collector = await mk("Arash Collector", "COLLECTION_AGENT", ["COLLECTION"], { requiresAcceptance: true, publicName: "Arash (UT courier)" })
    const declining = await mk("Bita Courier", "COURIER", ["COLLECTION", "DELIVERY"], { requiresAcceptance: true })
    const handler = await mk("Cyrus Logistics", "LOGISTICS_REPRESENTATIVE", ["HANDLING"])
    const deliverer = await mk("Dina Delivery", "DELIVERY_AGENT", ["DELIVERY"])
    const backup = await mk("Elham Driver", "DRIVER", ["DELIVERY"])
    for (const a of [collector, declining, handler, deliverer, backup]) { expect(a.status).toBe(201); expect(a.body.agentCode).toMatch(/^AG-\d{5}$/) }
    expect(new Set([collector, declining, handler, deliverer, backup].map((a) => a.body.agentCode)).size).toBe(5)
    expect(declining.body.publicName).toBe(`Agent ${declining.body.agentCode}`)
    expect((await admin.post("/v1/admin/cargo/agents", { displayName: "No Type", email: "x@example.com", responsibilities: ["COLLECTION"] })).status).toBe(400)

    // Profile photo: stored, served to staff from the same origin only once scanned clean.
    expect((await admin.post(`/v1/admin/cargo/agents/${collector.body.id}/photo`, { filename: "me.png", data: png() })).status).toBe(201)
    let photo: { status: number } = { status: 0 }
    for (let i = 0; i < 40 && photo.status !== 200; i++) { photo = await admin.get(`/v1/admin/cargo/agents/${collector.body.id}/photo`); if (photo.status !== 200) await new Promise((r) => setTimeout(r, 250)) }
    expect(photo.status).toBe(200)

    // A booked shipment (staff intake keeps this short).
    const c = new Session("WEB")
    const phone = randomPhone("+98912")
    await signIn(c, phone, { givenNamesLatin: "Mahsa", surnameLatin: "Sender" })
    const cust = (await admin.get(`/v1/admin/cargo/customers?q=${encodeURIComponent(phone)}`)).body[0]
    const lanes = (await admin.get("/v1/cargo/lanes")).body as { id: string; originCountry: string; destinationCountry: string }[]
    const laneId = lanes.find((l) => l.originCountry === "GB" && l.destinationCountry === "TR")!.id
    const sub = await admin.post("/v1/admin/cargo/requests", {
      service: "PARCEL", laneId, readyDate: "2026-12-02", handoverMode: "PICKUP", customer: { userId: cust.userId }, customerConfirmed: true, channel: "PHONE",
      shipper: { name: "Mahsa Sender", address: { line1: "2 Agent Way", city: "Manchester", postcode: "M1 1AA", country: "GB" }, phone: "+447700900111" },
      consignee: { name: "Kian Receiver", address: { line1: "Moda Cd. 5", city: "Istanbul", country: "TR" }, phone: "+905550001122" },
      pieces: [{ lengthCm: 20, widthCm: 20, heightCm: 20, weightKg: 4 }], items: [{ description: "Spices", category: "FOOD_NON_PERISHABLE", quantity: 2, unitValue: GBP(1000), originCountry: "GB", purpose: "GIFT" }],
      declarations: { batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: false }, declaredTotal: GBP(2000),
    }, key())
    const ref = sub.body.ref as string
    let d: any
    for (let i = 0; i < 40; i++) { d = await admin.get(`/v1/admin/cargo/requests/${ref}`); if (d.body.status === "NEW") break; await new Promise((r) => setTimeout(r, 300)) }
    const v = () => ({ "if-match": String(d.body.version) })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/claim`, {}, v())
    const partner = d.body.eligiblePartners.find((p: { complianceStatus: string }) => p.complianceStatus === "CLEARED")
    const lines = { freight: { ratePerKg: GBP(450), chargeableKg: 4, amount: GBP(1800) }, fuelSurcharge: GBP(0), securitySurcharge: GBP(0), handling: GBP(0), customsBrokerage: GBP(0), dutiesTaxes: "PAYABLE_BY_CONSIGNEE", dutiesEstimate: true, insurance: GBP(0), pickup: GBP(0), delivery: GBP(0), total: GBP(1800) }
    const q = await admin.post(`/v1/admin/cargo/requests/${ref}/quotes`, { partnerId: partner.id, lines })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/send_quote`, { quoteId: q.body.id }, v())
    await c.post(`/v1/cargo-requests/${ref}/quotes/${q.body.id}/accept`)
    d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/record_booking`, { partnerId: partner.id, partnerReference: "DCP-7" }, v())
    const tn = (await admin.get(`/v1/admin/cargo/requests/${ref}/operations`)).body.trackingNumber

    // Responsibilities are enforced; two collection agents at once, both must accept.
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/assignments`, { agentIds: [handler.body.id], kind: "COLLECTION", location: "Manchester" })).status).toBe(400)
    const two = await admin.post(`/v1/admin/cargo/requests/${ref}/assignments`, { agentIds: [collector.body.id, declining.body.id], kind: "COLLECTION", scheduledFor: at(60), location: "Manchester" })
    expect(two.status).toBe(201)
    expect(two.body.map((x: { status: string }) => x.status)).toEqual(["OFFERED", "OFFERED"])
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/assignments`, { agentIds: [collector.body.id], kind: "COLLECTION", location: "Manchester" })).status).toBe(400)

    const A = await agentSession(collector.body.email)
    const B = await agentSession(declining.body.email)
    expect((await A.get("/v1/agent/me")).body).toMatchObject({ agentCode: collector.body.agentCode, agentType: "COLLECTION_AGENT", hasPhoto: true })
    expect((await A.get("/v1/agent/me/photo")).status).toBe(200)
    const offered = (await A.get("/v1/agent/jobs")).body.jobs[0]
    expect(offered).toMatchObject({ status: "OFFERED", actions: ["accept", "decline"] })
    // Contacts stay hidden until the job is accepted.
    expect(offered.pickup.phone).toBe("")
    expect(offered.pickup.address).not.toContain("Agent Way")
    expect((await A.post(`/v1/agent/jobs/${offered.assignmentId}/actions/collected`, { location: "Manchester", handedOverBy: "Mahsa" })).status).toBe(409)

    // B declines with a reason; the assigning staff member is told.
    const bJob = (await B.get("/v1/agent/jobs")).body.jobs[0]
    expect((await B.post(`/v1/agent/jobs/${bJob.assignmentId}/actions/decline`, { reason: "Van in the garage" })).status).toBe(200)
    // A accepts: now the contacts show and the public timeline says the collection agent is assigned, by public name.
    const acc = await A.post(`/v1/agent/jobs/${offered.assignmentId}/actions/accept`, {})
    expect(acc.body).toMatchObject({ status: "ASSIGNED" })
    expect(acc.body.pickup.address).toContain("Agent Way")
    const anon = new Session("WEB")
    let pub = await anon.get(`/v1/public/cargo-tracking/${tn}`)
    expect(pub.body.timeline[0]).toMatchObject({ eventCode: "COLLECTION_SCHEDULED", agent: "Arash (UT courier)" })
    expect(pub.body.timeline.find((t: { eventCode: string }) => t.eventCode === "COLLECTION_AGENT_ASSIGNED")).toMatchObject({ label: "Assigned to collection agent", agent: "Arash (UT courier)" })

    // Problem report reaches staff as an internal note.
    expect((await A.post(`/v1/agent/jobs/${offered.assignmentId}/actions/report_problem`, { category: "ACCESS".replace("ACCESS", "ADDRESS"), description: "Flat number missing" })).status).toBe(200)
    const sig = await A.post(`/v1/agent/jobs/${offered.assignmentId}/files`, { filename: "s.png", data: png(), purpose: "SIGNATURE" })
    expect((await A.post(`/v1/agent/jobs/${offered.assignmentId}/actions/collected`, { location: "Manchester", handedOverBy: "Mahsa Sender", signatureDocumentId: sig.body.documentId })).body.status).toBe("COMPLETED")
    pub = await anon.get(`/v1/public/cargo-tracking/${tn}`)
    expect(pub.body.timeline[0]).toMatchObject({ eventCode: "PICKED_UP", label: "Cargo collected by agent", agent: "Arash (UT courier)" })

    // Hub receives; a handling agent records transport; two delivery agents, the first to deliver closes the other's job.
    d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/schedule_handover`, { note: "Collected" }, v())
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/receive`, { verifiedWeights: [{ pieceId: d.body.pieces[0].id, weightKg: 4 }], location: "Manchester hub" }, v())
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/assignments`, { agentIds: [handler.body.id], kind: "HANDLING", location: "Manchester" })).status).toBe(201)
    const H = await agentSession(handler.body.email)
    const hJob = (await H.get("/v1/agent/jobs")).body.jobs[0]
    expect(hJob.actions).toContain("handled")
    expect((await H.post(`/v1/agent/jobs/${hJob.assignmentId}/actions/handled`, { location: "M6 linehaul" })).status).toBe(200)
    expect((await H.post(`/v1/agent/jobs/${hJob.assignmentId}/actions/at_sorting_facility`, { location: "London sorting centre" })).status).toBe(200)
    expect((await H.post(`/v1/agent/jobs/${hJob.assignmentId}/actions/handling_done`, {})).body.status).toBe("COMPLETED")
    pub = await anon.get(`/v1/public/cargo-tracking/${tn}`)
    expect(pub.body.milestone).toBe("AT_SORTING_FACILITY")
    expect(pub.body.timeline.find((t: { eventCode: string }) => t.eventCode === "HANDLED")).toMatchObject({ label: "Cargo handled by agent", agent: handler.body.publicName })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/depart`, { location: "LHR", occurredAt: at(1) }, v())
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/assignments`, { agentIds: [deliverer.body.id, backup.body.id], kind: "DELIVERY", location: "Istanbul" })).status).toBe(201)
    const D = await agentSession(deliverer.body.email)
    const E = await agentSession(backup.body.email)
    const dJob = (await D.get("/v1/agent/jobs")).body.jobs[0]
    const eJob = (await E.get("/v1/agent/jobs")).body.jobs[0]
    expect(dJob.otherAgents.map((o: { agentCode: string }) => o.agentCode)).toContain(backup.body.agentCode)
    await D.post(`/v1/agent/jobs/${dJob.assignmentId}/actions/out_for_delivery`, { location: "Istanbul" })
    const ph = await D.post(`/v1/agent/jobs/${dJob.assignmentId}/files`, { filename: "door.png", data: png(), purpose: "PHOTO" })
    expect((await D.post(`/v1/agent/jobs/${dJob.assignmentId}/actions/delivered`, { location: "Istanbul", receiverName: "Kian Receiver", photoDocumentIds: [ph.body.documentId] })).body.cargoStatus).toBe("DELIVERED")
    expect((await E.get(`/v1/agent/jobs/${eJob.assignmentId}`)).status).toBe(404)
    pub = await anon.get(`/v1/public/cargo-tracking/${tn}`)
    expect(pub.body.timeline.find((t: { eventCode: string }) => t.eventCode === "DELIVERED")).toMatchObject({ label: "Delivered by agent", agent: deliverer.body.publicName })
    expect(JSON.stringify(pub.body)).not.toMatch(/Arash Collector|Dina Delivery|Cyrus|@example\.com/)

    // Every agent update records the agent's identity.
    const rows = await dbQuery<{ code: string; agent_code: string | null }>("select t.event_code code, a.agent_code from tracking_events t left join cargo_agents a on a.id = t.agent_id where t.cargo_request_id = (select id from cargo_requests where ref = $1) order by t.created_at", [ref])
    for (const [code, who] of [["PICKED_UP", collector], ["HANDLED", handler], ["SORTING_FACILITY", handler], ["OUT_FOR_DELIVERY", deliverer], ["DELIVERED", deliverer]] as const) expect(rows.find((r) => r.code === code)?.agent_code).toBe(who.body.agentCode)
    const notes = (await admin.get(`/v1/admin/cargo/requests/${ref}`)).body.notes.map((n: { body: string }) => n.body).join("\n")
    expect(notes).toContain(`[Problem · ADDRESS · agent ${collector.body.agentCode}`)

    // Profile: jobs, performance and activity.
    const prof = (await admin.get(`/v1/admin/cargo/agents/${collector.body.id}`)).body
    expect(prof.performance).toMatchObject({ totalJobs: 1, completed: 1, declined: 0, completionRate: 100 })
    expect(prof.jobs[0]).toMatchObject({ ref, trackingNumber: tn, kind: "COLLECTION", status: "COMPLETED" })
    expect(prof.activity.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(["accept", "collected", "report_problem"]))
    expect((await admin.get(`/v1/admin/cargo/agents/${declining.body.id}`)).body.performance.declined).toBe(1)
    const ops = (await admin.get(`/v1/admin/cargo/requests/${ref}/operations`)).body
    expect(ops.assignments.find((x: { agentCode: string }) => x.agentCode === declining.body.agentCode)).toMatchObject({ status: "DECLINED", declineReason: "Van in the garage" })
    expect(ops.assignments.find((x: { agentCode: string }) => x.agentCode === backup.body.agentCode)).toMatchObject({ status: "CANCELLED" })

    // Agents cannot manage agents or see each other; deactivation needs no open jobs and removes access.
    expect((await A.get("/v1/admin/cargo/agents")).status).toBe(403)
    expect((await A.get(`/v1/agent/jobs/${dJob.assignmentId}`)).status).toBe(404)
    expect((await admin.patch(`/v1/admin/cargo/agents/${collector.body.id}`, { active: false })).body.active).toBe(false)
    expect((await A.get("/v1/agent/jobs")).status).toBeGreaterThanOrEqual(401)
  }, 240_000)
})
