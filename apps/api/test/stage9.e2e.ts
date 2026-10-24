import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { TRACKING_EVENT_LABELS } from "@unitravel/contracts"

import { iso, receivedShipment } from "./cargo-fixture"
import { dbQuery, randomPhone, Session, signIn } from "./client"

describe("Phase E — cargo tracking (booklet ch. 14.5, 14.8, 32.2)", () => {
  it("record → correct → customer sees the corrected, translated state; staff see the history; audited; ETA is an estimate", async () => {
    const { c, admin, ref, id } = await receivedShipment()

    const rec = await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-events`, { eventCode: "DEPARTED", location: "LHR", occurredAt: iso(1) })
    expect(rec.status).toBe(201)
    let list = await c.get("/v1/shipments")
    let s = list.body.find((x: { ref: string }) => x.ref === ref)
    expect(s.lastEvent).toMatchObject({ eventCode: "DEPARTED", label: TRACKING_EVENT_LABELS.DEPARTED.en, corrected: false })
    expect(s.awbNumber).toBe("176-12345675")
    expect(s.estimatedDeliveryAt).toBeNull()

    let detail = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    const departed = detail.body.tracking.find((t: { eventCode: string }) => t.eventCode === "DEPARTED")
    // Corrections need a reason, a real event of this request, and the cargo staff permission.
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-corrections`, { correctsEventId: departed.id, eventCode: "AT_CUSTOMS", location: "IST customs", occurredAt: iso(3), reason: "" })).status).toBe(400)
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-corrections`, { correctsEventId: "00000000-0000-4000-8000-000000000000", eventCode: "AT_CUSTOMS", location: "IST customs", occurredAt: iso(3), reason: "Wrong event" })).status).toBe(404)
    expect((await c.post(`/v1/admin/cargo/requests/${ref}/tracking-corrections`, { correctsEventId: departed.id, eventCode: "AT_CUSTOMS", location: "x", occurredAt: iso(3), reason: "no" })).status).toBe(403)
    const fix = await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-corrections`, { correctsEventId: departed.id, eventCode: "AT_CUSTOMS", location: "IST customs", occurredAt: iso(3), reason: "Partner entered the wrong scan" })
    expect(fix.status).toBe(201)

    list = await c.get("/v1/shipments", { "accept-language": "fa" })
    s = list.body.find((x: { ref: string }) => x.ref === ref)
    expect(s.lastEvent).toMatchObject({ eventCode: "AT_CUSTOMS", label: TRACKING_EVENT_LABELS.AT_CUSTOMS.fa, location: "IST customs", corrected: true })
    expect(s.timeline.map((e: { eventCode: string }) => e.eventCode)).toEqual(["NOTE", "RECEIVED", "AT_CUSTOMS"])
    const wire = JSON.stringify(list.body.filter((x: { ref: string }) => x.ref === ref))
    expect(wire).not.toMatch(/DEPARTED|Partner entered|correct(s|ion)|source|externalEventId|createdBy/)
    // The request view and the per-shipment route agree.
    expect(JSON.stringify((await c.get(`/v1/cargo-requests/${ref}`)).body.tracking)).not.toContain("DEPARTED")
    expect((await c.get(`/v1/shipments/${ref}`)).body.lastEvent.eventCode).toBe("AT_CUSTOMS")

    detail = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    const orig = detail.body.tracking.find((t: { id: string }) => t.id === departed.id)
    const corr = detail.body.tracking.find((t: { id: string }) => t.id === fix.body.id)
    expect(orig).toMatchObject({ eventCode: "DEPARTED", location: "LHR", effective: false, correctsEventId: null })
    expect(corr).toMatchObject({ eventCode: "AT_CUSTOMS", effective: true, correctsEventId: departed.id, correctionReason: "Partner entered the wrong scan", source: "STAFF" })
    expect(corr.createdBy).toBeTruthy()

    const audit = await dbQuery<{ action: string; before: { eventCode: string }; after: { reason: string } }>("select action, before, after from audit_log where action = 'cargo_request.tracking_corrected' and entity_id = $1", [id])
    expect(audit).toHaveLength(1)
    expect(audit[0]!.before.eventCode).toBe("DEPARTED")
    expect(audit[0]!.after.reason).toBe("Partner entered the wrong scan")

    // Rows are append-only even for the table owner.
    await expect(dbQuery("update tracking_events set location = 'X' where id = $1", [departed.id])).rejects.toThrow()

    // A retraction removes an event from the customer's timeline without deleting it.
    const note = await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-events`, { eventCode: "NOTE", location: "Hub", occurredAt: iso(2) })
    expect(note.status).toBe(201)
    detail = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    const noteRow = detail.body.tracking.find((t: { eventCode: string; location: string }) => t.eventCode === "NOTE" && t.location === "Hub")
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-corrections`, { correctsEventId: noteRow.id, eventCode: "RETRACTED", location: "Hub", occurredAt: iso(2), reason: "Entered on the wrong shipment" })).status).toBe(201)
    expect((await c.get(`/v1/shipments/${ref}`)).body.timeline.map((e: { eventCode: string }) => e.eventCode)).toEqual(["NOTE", "RECEIVED", "AT_CUSTOMS"])

    // The estimate: staff set and clear it; customers cannot; it is returned as data for the client to label as an estimate.
    const eta = new Date(Date.now() + 3 * 86_400_000).toISOString()
    expect((await c.put(`/v1/admin/cargo/requests/${ref}/estimated-delivery`, { estimatedDeliveryAt: eta })).status).toBe(403)
    expect((await admin.put(`/v1/admin/cargo/requests/${ref}/estimated-delivery`, { estimatedDeliveryAt: "tomorrow" })).status).toBe(400)
    expect((await admin.put(`/v1/admin/cargo/requests/${ref}/estimated-delivery`, { estimatedDeliveryAt: eta })).status).toBe(200)
    expect((await c.get(`/v1/shipments/${ref}`)).body.estimatedDeliveryAt).toBe(eta)
    expect((await c.get(`/v1/cargo-requests/${ref}`)).body.estimatedDeliveryAt).toBe(eta)
    const sum = (await c.get("/v1/shipments/summary")).body
    expect(sum).toMatchObject({ total: 1, inTransit: 1, delivered: 0 })
    expect(sum.next).toMatchObject({ ref, estimatedDeliveryAt: eta })
    expect((await admin.put(`/v1/admin/cargo/requests/${ref}/estimated-delivery`, { estimatedDeliveryAt: null })).status).toBe(200)
    expect((await c.get(`/v1/shipments/${ref}`)).body.estimatedDeliveryAt).toBeNull()
    const trail = await dbQuery("select 1 from audit_log where action = 'cargo_request.eta_set' and entity_id = $1", [id])
    expect(trail).toHaveLength(2)
  })

  it("a replayed partner event is a no-op; a staff entry carries no external id; a non-owner gets 404", async () => {
    const { c, admin, ref, id } = await receivedShipment()
    const e1 = `prt-${randomUUID()}`
    const e2 = `prt-${randomUUID()}`
    const insert = "insert into tracking_events (id, cargo_request_id, event_code, location, occurred_at, source, external_event_id) values (gen_random_uuid(), $1, 'ARRIVED', 'IST', now(), 'PARTNER_API', $2) on conflict do nothing returning id"
    expect(await dbQuery(insert, [id, e1])).toHaveLength(1)
    expect(await dbQuery(insert, [id, e1])).toHaveLength(0)
    expect(await dbQuery(insert, [id, e2])).toHaveLength(1)
    const rows = (await admin.get(`/v1/admin/cargo/requests/${ref}`)).body.tracking
    expect(rows.filter((t: { source: string }) => t.source === "PARTNER_API").map((t: { externalEventId: string }) => t.externalEventId).sort()).toEqual([e1, e2].sort())
    expect(rows.filter((t: { source: string }) => t.source === "STAFF").every((t: { externalEventId: unknown }) => t.externalEventId === null)).toBe(true)
    expect((await c.get(`/v1/shipments/${ref}`)).body.timeline.filter((e: { eventCode: string }) => e.eventCode === "ARRIVED")).toHaveLength(2)

    const other = new Session("MOBILE")
    await signIn(other, randomPhone("+98912"), { givenNamesLatin: "Other", surnameLatin: "Person" })
    expect((await other.get(`/v1/shipments/${ref}`)).status).toBe(404)
    expect((await other.get(`/v1/cargo-requests/${ref}`)).status).toBe(404)
    expect((await other.get("/v1/shipments")).body).toEqual([])
    expect((await other.get("/v1/shipments/summary")).body).toEqual({ total: 0, inTransit: 0, delivered: 0, next: null })
    expect((await new Session("WEB").get("/v1/shipments")).status).toBe(401)
  })
})
