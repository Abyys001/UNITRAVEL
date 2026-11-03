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

  it("the indicative-source routes declare their permissions (ADR-0029)", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    expect(find("POST", "/v1/admin/itineraries/:id/recheck")).toMatchObject({ permissions: ["pricing.read.internal"], staff: true })
    expect(find("GET", "/v1/admin/itineraries/:id/recheck/:jobId")).toMatchObject({ permissions: ["pricing.read.internal"], staff: true })
    expect(find("GET", "/v1/dev/providers/:id/usage")).toMatchObject({ permissions: ["provider.config.read"], staff: true, dev: true })
    expect(find("GET", "/v1/dev/providers/:id/runs")).toMatchObject({ permissions: ["provider.config.read"], staff: true, dev: true })
    // Metering changes go through the PATCH (provider.config.write, privileged, fresh step-up checked in the handler and audited).
    expect(find("PATCH", "/v1/dev/providers/:id")).toMatchObject({ permissions: ["provider.config.write"] })
  })

  it("the Apify Developer Panel routes (ADR-0032 B2): test connection writes, credential metadata reads", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    expect(find("POST", "/v1/dev/providers/apify-google-flights/test")).toMatchObject({ permissions: ["provider.config.write"], staff: true, dev: true })
    expect(find("GET", "/v1/dev/providers/:id")).toMatchObject({ permissions: ["provider.config.read"], staff: true, dev: true })
    expect(find("PUT", "/v1/dev/providers/:id/credentials")).toMatchObject({ permissions: ["provider.config.write"], staff: true, dev: true })
    // The Admin Panel dashboard's usage card reads the same view without the dev host (ADR-0032 B7).
    expect(find("GET", "/v1/admin/providers/apify-google-flights/usage")).toMatchObject({ permissions: ["provider.config.read"], staff: true, dev: false })
    // The live aircraft board is gone (ADR-0032 B6).
    expect(routes.some((r) => r.path.startsWith("/v1/live-flights"))).toBe(false)
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

  it("content system (ADR-0017): public reads are public; staff read, write and publish are separate permissions", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    for (const p of ["/v1/cms/entries", "/v1/cms/entries/:kind/:slug", "/v1/cms/resolve/:kind/:slug", "/v1/cms/glossary", "/v1/cms/sitemap"]) expect({ p, pub: find("GET", p)?.isPublic, staff: find("GET", p)?.staff }).toEqual({ p, pub: true, staff: false })
    for (const p of ["/v1/admin/cms/entries", "/v1/admin/cms/entries/:id", "/v1/admin/cms/entries/:id/revisions", "/v1/admin/cms/glossary"]) expect({ p, perms: find("GET", p)?.permissions, staff: find("GET", p)?.staff }).toEqual({ p, perms: ["cms.read"], staff: true })
    for (const [m, p] of [["POST", "/v1/admin/cms/entries"], ["PATCH", "/v1/admin/cms/entries/:id"], ["POST", "/v1/admin/cms/glossary"], ["PATCH", "/v1/admin/cms/glossary/:slug"]] as const) expect({ p, perms: find(m, p)?.permissions, staff: find(m, p)?.staff }).toEqual({ p, perms: ["cms.write"], staff: true })
    for (const p of ["/v1/admin/cms/entries/:id/transition", "/v1/admin/cms/glossary/:slug/transition"]) expect({ p, perms: find("POST", p)?.permissions, staff: find("POST", p)?.staff }).toEqual({ p, perms: ["cms.write", "cms.publish"], staff: true })
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

  it("service requests (ADR-0015): customer routes are own-scoped, admin routes need service_request.read.any / write, the site is public, track lookups need sign-in (ADR-0025)", () => {
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
    for (const p of ["/v1/track/lookup", "/v1/track/verify"]) expect(find("POST", p)).toMatchObject({ permissions: ["flight_request.read.own"], staff: false })
  })

  it("customer activity (ADR-0018): telemetry is for any signed-in user, the customer list and activity timeline need customer.read", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    expect(find("POST", "/v1/me/activity")).toMatchObject({ authenticated: true, permissions: [], staff: false })
    for (const p of ["/v1/admin/customers", "/v1/admin/customers/:id/activity"]) expect({ p, perms: find("GET", p)?.permissions, staff: find("GET", p)?.staff }).toEqual({ p, perms: ["customer.read"], staff: true })
    // The existing full-contact view stays behind the PII permission; the list does not widen it.
    expect(find("GET", "/v1/admin/customers/:id")).toMatchObject({ permissions: ["customer.read.pii"], staff: true })
  })

  it("support and calls (ADR-0019): the form is public, the customer thread is own-scoped, staff need support.read / support.reply / call.log, the webhook is public but signed", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    expect(find("POST", "/v1/support/tickets")).toMatchObject({ isPublic: true, staff: false })
    for (const [m, p] of [["GET", "/v1/support/tickets"], ["GET", "/v1/support/tickets/:ref"], ["POST", "/v1/support/tickets/:ref/messages"]] as const) expect({ p, auth: find(m, p)?.authenticated, staff: find(m, p)?.staff }).toEqual({ p, auth: true, staff: false })
    for (const p of ["/v1/admin/support/tickets", "/v1/admin/support/tickets/:ref"]) expect({ p, perms: find("GET", p)?.permissions, staff: find("GET", p)?.staff }).toEqual({ p, perms: ["support.read"], staff: true })
    for (const p of ["/v1/admin/support/tickets/:ref/replies", "/v1/admin/support/tickets/:ref/commands"]) expect({ p, perms: find("POST", p)?.permissions, staff: find("POST", p)?.staff }).toEqual({ p, perms: ["support.reply"], staff: true })
    for (const [m, p] of [["GET", "/v1/admin/calls"], ["POST", "/v1/admin/calls"], ["POST", "/v1/admin/calls/click-to-call"]] as const) expect({ p, perms: find(m, p)?.permissions, staff: find(m, p)?.staff }).toEqual({ p, perms: ["call.log"], staff: true })
    expect(find("POST", "/v1/webhooks/bonline")).toMatchObject({ isPublic: true, staff: false, dev: false })
  })

  it("assigned services and the payment page (ADR-0020): assigning needs service.assign; the page and the purchasable list are own-scoped", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    expect(find("POST", "/v1/admin/customers/:id/assignments")).toMatchObject({ permissions: ["service.assign"], staff: true })
    for (const p of ["/v1/billing/purchasable", "/v1/billing/invoices/:number/payment-page"]) expect({ p, perms: find("GET", p)?.permissions, staff: find("GET", p)?.staff }).toEqual({ p, perms: ["flight_request.read.own", "cargo_request.read.own"], staff: false })
  })

  it("direct invoices (ADR-0028): creating and editing need invoice.direct; offline payment on an invoice needs payment.record", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    for (const [m, p] of [["POST", "/v1/admin/invoices"], ["PUT", "/v1/admin/invoices/:id"]] as const) expect(find(m, p)).toMatchObject({ permissions: ["invoice.direct"], staff: true })
    expect(find("POST", "/v1/admin/invoices/:id/payments")).toMatchObject({ permissions: ["payment.record"], staff: true })
  })

  it("listings (ADR-0021): public reads are public, staff curation needs listings.write", () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)
    for (const p of ["/v1/listings/flights", "/v1/listings/:vertical"]) expect({ p, pub: find("GET", p)?.isPublic, staff: find("GET", p)?.staff }).toEqual({ p, pub: true, staff: false })
    // `flights` is registered before `:vertical`, so it is never read as a vertical.
    expect(routes.findIndex((r) => r.path === "/v1/listings/flights")).toBeLessThan(routes.findIndex((r) => r.path === "/v1/listings/:vertical"))
    for (const [m, p] of [["GET", "/v1/admin/listings"], ["GET", "/v1/admin/listings/:id"], ["POST", "/v1/admin/listings"], ["PATCH", "/v1/admin/listings/:id"]] as const) expect({ p, perms: find(m, p)?.permissions, staff: find(m, p)?.staff }).toEqual({ p, perms: ["listings.write"], staff: true })
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
