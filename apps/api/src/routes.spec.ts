import { Controller, Get } from "@nestjs/common"
import { describe, expect, it } from "vitest"

import { API_CONTROLLERS } from "./app.module"
import { enumerateRoutes } from "./core/http/route-table"
import { BUSINESS_CONTROLLERS } from "./modules/business.module"

describe("fail-closed route declarations", () => {
  const routes = enumerateRoutes([...API_CONTROLLERS, ...BUSINESS_CONTROLLERS])

  it("every route declares @Public, @Authenticated or @RequirePermission", () => {
    expect(routes.length).toBeGreaterThan(30)
    expect(routes.filter((r) => !r.declared).map((r) => `${r.controller}.${r.handler} ${r.path}`)).toEqual([])
  })

  it("every /v1/dev route is restricted to the dev host and staff MFA; every /v1/admin route needs staff MFA", () => {
    for (const r of routes.filter((x) => x.path.startsWith("/v1/dev/"))) expect({ path: r.path, dev: r.dev, staff: r.staff }).toEqual({ path: r.path, dev: true, staff: true })
    for (const r of routes.filter((x) => x.path.startsWith("/v1/admin/"))) expect({ path: r.path, staff: r.staff }).toEqual({ path: r.path, staff: true })
  })

  it("price surfaces are staff-only and declare the pricing permissions (ADR-0004)", () => {
    const perms = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)?.permissions
    expect(routes.filter((r) => r.path.includes("price-check")).map((r) => r.path)).toEqual(["/v1/admin/itineraries/:id/price-check"])
    expect(perms("POST", "/v1/admin/itineraries/:id/price-check")).toEqual(["pricing.read.internal"])
    expect(perms("GET", "/v1/admin/flight-requests/:ref/quotes/from-snapshot")).toEqual(["pricing.read.internal"])
    expect(perms("POST", "/v1/admin/flight-requests/:ref/quotes")).toEqual(["pricing.write"])
    expect(perms("PATCH", "/v1/admin/flight-requests/:ref/quotes/:id")).toEqual(["pricing.write"])
    expect(perms("POST", "/v1/admin/flight-requests/:ref/commands/:command")).toContain("commercial_document.issue")
  })

  it("identity verification and identity documents are gated (ADR-0005)", () => {
    const perms = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)?.permissions
    expect(perms("GET", "/v1/admin/verifications")).toEqual(["identity.verify"])
    expect(perms("GET", "/v1/admin/verifications/:id")).toEqual(["identity.verify"])
    expect(perms("POST", "/v1/admin/verifications/:id/decide")).toEqual(["identity.verify"])
    expect(perms("GET", "/v1/admin/verifications/:id/scan")).toEqual(["identity.verify"])
    expect(perms("POST", "/v1/admin/customers/travellers/:travellerId/reveal-document")).toEqual(["customer.read.documents"])
    // Customer routes are authenticated and ownership-checked in the handler, never staff-gated.
    for (const [m, p] of [["GET", "/v1/me/details"], ["PATCH", "/v1/me/details"], ["POST", "/v1/me/travellers/:id/identity/scan"], ["POST", "/v1/me/travellers/:id/identity/confirm"]] as const) {
      const r = routes.find((x) => x.method === m && x.path === p)
      expect({ p, declared: r?.declared, staff: r?.staff }).toEqual({ p, declared: true, staff: false })
    }
    for (const r of routes.filter((x) => x.path.startsWith("/v1/admin/verifications"))) expect(r.staff).toBe(true)
  })

  it("cargo tracking: customer shipments are own-scoped, corrections and the estimate need the cargo staff permission (Phase E)", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    for (const p of ["/v1/shipments", "/v1/shipments/summary", "/v1/shipments/:ref"]) expect({ p, perms: find("GET", p)?.permissions, staff: find("GET", p)?.staff }).toEqual({ p, perms: ["cargo_request.read.own"], staff: false })
    expect(find("POST", "/v1/admin/cargo/requests/:ref/tracking-corrections")).toMatchObject({ permissions: ["cargo_request.transition"], staff: true })
    expect(find("PUT", "/v1/admin/cargo/requests/:ref/estimated-delivery")).toMatchObject({ permissions: ["cargo_request.transition"], staff: true })
  })

  it("invoices: customer billing is own-scoped, issuing and cancelling need commercial_document.issue, reads follow the request permissions (ADR-0006)", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    for (const p of ["/v1/billing/documents", "/v1/billing/invoices/:number"]) expect({ p, perms: find("GET", p)?.permissions, staff: find("GET", p)?.staff }).toEqual({ p, perms: ["flight_request.read.own", "cargo_request.read.own"], staff: false })
    for (const [m, p] of [["POST", "/v1/admin/requests/:ref/invoices"], ["POST", "/v1/admin/invoices/:id/issue"], ["POST", "/v1/admin/invoices/:id/cancel"]] as const) expect({ p, perms: find(m, p)?.permissions, staff: find(m, p)?.staff }).toEqual({ p, perms: ["commercial_document.issue"], staff: true })
    for (const p of ["/v1/admin/invoices", "/v1/admin/invoices/:id", "/v1/admin/requests/:ref/invoices"]) expect({ p, perms: find("GET", p)?.permissions }).toEqual({ p, perms: ["flight_request.read.any", "cargo_request.read.any", "service_request.read.any", "commercial_document.issue"] })
  })

  it("customer club (ADR-0016): the customer reads only their own club; staff reads, changes and four-eyes approval are separate permissions", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    expect(find("GET", "/v1/me/club")).toMatchObject({ permissions: ["loyalty.read.own"], staff: false })
    for (const p of ["/v1/admin/club/tiers", "/v1/admin/club/members", "/v1/admin/club/members/:userId", "/v1/admin/club/benefits", "/v1/admin/club/ledger"]) expect({ p, perms: find("GET", p)?.permissions, staff: find("GET", p)?.staff }).toEqual({ p, perms: ["loyalty.read"], staff: true })
    for (const [m, p] of [["POST", "/v1/admin/club/tiers"], ["PATCH", "/v1/admin/club/tiers/:id"], ["GET", "/v1/admin/club/candidates"], ["POST", "/v1/admin/club/members"], ["PATCH", "/v1/admin/club/members/:userId"], ["POST", "/v1/admin/club/benefits"], ["POST", "/v1/admin/club/benefits/:id/revoke"], ["POST", "/v1/admin/club/ledger"]] as const) expect({ p, perms: find(m, p)?.permissions, staff: find(m, p)?.staff }).toEqual({ p, perms: ["loyalty.manage"], staff: true })
    expect(find("POST", "/v1/admin/club/benefits/:id/approve")).toMatchObject({ permissions: ["loyalty.benefit.approve"], staff: true })
  })

  it("online payment (ADR-0007): the webhook is public, everything else declares a permission, live mode and refunds are gated", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    expect(find("POST", "/v1/webhooks/stripe")).toMatchObject({ isPublic: true, staff: false, dev: false })
    for (const p of ["/v1/billing/invoices/:number/payment", "/v1/billing/invoices/:number/checkout-session"]) expect({ p, perms: routes.find((r) => r.path === p)?.permissions }).toEqual({ p, perms: ["flight_request.read.own", "cargo_request.read.own"] })
    expect(find("POST", "/v1/admin/invoices/:id/refunds")).toMatchObject({ permissions: ["payment.refund.request"], staff: true })
    for (const p of ["/v1/admin/refunds/:id/approve", "/v1/admin/refunds/:id/reject"]) expect(find("POST", p)).toMatchObject({ permissions: ["payment.refund.approve"], staff: true })
    expect(find("POST", "/v1/admin/invoices/:id/payment-link/resend")).toMatchObject({ permissions: ["commercial_document.issue"], staff: true })
    expect(find("GET", "/v1/admin/invoices/:id/payments")).toMatchObject({ permissions: ["flight_request.read.any", "cargo_request.read.any", "commercial_document.issue"], staff: true })
    expect(find("PUT", "/v1/dev/payments/credentials")).toMatchObject({ permissions: ["payments.configure"], dev: true, staff: true })
    expect(find("PATCH", "/v1/dev/payments/config")).toMatchObject({ permissions: ["payments.configure"], dev: true })
    expect(find("POST", "/v1/dev/payments/mode-requests")).toMatchObject({ permissions: ["payments.configure"], dev: true })
    expect(find("POST", "/v1/dev/payments/mode-requests/approve")).toMatchObject({ permissions: ["payments.mode.approve"], dev: true })
    expect(find("GET", "/v1/dev/payments")).toMatchObject({ permissions: ["provider.config.read"], dev: true })
    // The only other public payment routes are the local-only FAKE simulator, which answers 404 outside APP_ENV=local.
    expect(routes.filter((r) => r.path.includes("payments") && r.isPublic).map((r) => r.path).sort()).toEqual(["/v1/dev-sink/payments/:sessionId/deliver", "/v1/dev-sink/payments/:sessionId/sign"])
  })

  it("service requests (ADR-0015): customer routes are own-scoped, admin routes need service_request.read.any / write, site and track lookups are public", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    expect(find("POST", "/v1/service-requests")).toMatchObject({ permissions: ["service_request.create.own"], staff: false })
    for (const [m, p] of [["GET", "/v1/service-requests"], ["GET", "/v1/service-requests/:ref"], ["POST", "/v1/service-requests/:ref/cancel"], ["POST", "/v1/service-requests/:ref/messages"], ["POST", "/v1/service-requests/:ref/quote/accept"]] as const) {
      expect({ m, p, perms: find(m, p)?.permissions, staff: find(m, p)?.staff }).toEqual({ m, p, perms: ["service_request.read.own"], staff: false })
    }
    for (const [m, p] of [["GET", "/v1/admin/service-requests"], ["GET", "/v1/admin/service-requests/:ref"]] as const) expect(find(m, p)).toMatchObject({ permissions: ["service_request.read.any"], staff: true })
    expect(find("POST", "/v1/admin/service-requests/:ref/transition")).toMatchObject({ permissions: ["service_request.write", "compliance.case.decide"], staff: true })
    expect(find("POST", "/v1/admin/service-requests/:ref/messages")).toMatchObject({ permissions: ["service_request.write"], staff: true })
    expect(find("GET", "/v1/site")).toMatchObject({ isPublic: true, staff: false })
    expect(find("GET", "/v1/track")).toMatchObject({ permissions: ["flight_request.read.own"], staff: false })
    for (const p of ["/v1/track/lookup", "/v1/track/verify"]) expect(find("POST", p)).toMatchObject({ isPublic: true, staff: false })
  })

  it("flags a route that lacks a declaration (the check fails the build)", () => {
    @Controller("v1/oops")
    class Undeclared {
      @Get() leak() { return "secret" }
    }
    const bad = enumerateRoutes([Undeclared]).filter((r) => !r.declared)
    expect(bad).toHaveLength(1)
    expect(bad[0]!.path).toBe("/v1/oops")
  })
})
