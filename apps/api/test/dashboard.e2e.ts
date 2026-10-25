import { beforeAll, describe, expect, it } from "vitest"

import { DashboardMetrics } from "@unitravel/contracts"

import { ADMIN_HOST, type Session, STAFF, staffSession } from "./client"

/** Admin dashboard aggregates: real counts only, permission-shaped sections, money only with pricing.read.internal (ADR-0004). */
describe("Admin dashboard metrics", () => {
  let admin: Session, compliance: Session, cargo: Session
  beforeAll(async () => {
    admin = await staffSession(STAFF.admin, ADMIN_HOST)
    compliance = await staffSession(STAFF.compliance, ADMIN_HOST)
    cargo = await staffSession(STAFF.cargo, ADMIN_HOST)
  })

  it("returns a zero-filled daily series in Europe/London for the requested window", async () => {
    const r = await admin.get("/v1/admin/dashboard/metrics?days=14")
    expect(r.status).toBe(200)
    const m = DashboardMetrics.parse(r.body)
    expect(m.range).toMatchObject({ days: 14, timezone: "Europe/London" })
    expect(m.submissions).toHaveLength(14)
    expect(m.submissions[0]!.date).toBe(m.range.from)
    expect(m.submissions.at(-1)!.date).toBe(m.range.to)
    expect(m.submissions.every((d) => typeof d.flight === "number" && d.cargo === null)).toBe(true) // admin has no cargo read
    expect(m.flightStatus).not.toBeNull()
    expect(m.cargoStatus).toBeNull()
    expect(m.firstContact).not.toBeNull()
  })

  it("shows invoice money only to pricing.read.internal holders", async () => {
    const withMoney = DashboardMetrics.parse((await admin.get("/v1/admin/dashboard/metrics")).body)
    expect(withMoney.invoices?.outstanding).not.toBeNull()
    const noMoney = DashboardMetrics.parse((await compliance.get("/v1/admin/dashboard/metrics")).body)
    expect(noMoney.invoices).not.toBeNull()
    expect(noMoney.invoices!.outstanding).toBeNull()
    expect(noMoney.invoices!.paidInRange).toBeNull()
  })

  it("hides flight sections from cargo-only staff and rejects bad windows", async () => {
    const m = DashboardMetrics.parse((await cargo.get("/v1/admin/dashboard/metrics")).body)
    expect(m.flightStatus).toBeNull()
    expect(m.firstContact).toBeNull()
    expect(m.cargoStatus).not.toBeNull()
    expect(m.submissions.every((d) => d.flight === null && typeof d.cargo === "number")).toBe(true)
    expect((await admin.get("/v1/admin/dashboard/metrics?days=400")).status).toBe(400)
  })

  it("is not available to staff without request access", async () => {
    const dev = await staffSession(STAFF.developer, ADMIN_HOST)
    expect((await dev.get("/v1/admin/dashboard/metrics")).status).toBe(403)
  })
})
