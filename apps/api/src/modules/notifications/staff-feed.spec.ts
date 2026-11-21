import { describe, expect, it } from "vitest"

import { MarkStaffNotificationsBody, STAFF_FEED_EVENTS } from "@unitravel/contracts"

import { EVENT_ROUTES } from "../platform/outbox.dispatcher"
import { feedItemFor } from "./staff-feed.service"

const ev = (type: string, payload: Record<string, unknown>) => ({ type, payload })

describe("staff feed mapping (ADR-0039 D1)", () => {
  it("turns customer activity into feed items with the matching read permission and console link", () => {
    expect(feedItemFor(ev("flight_request.submitted", { ref: "UT-F-ABC123", routeLabel: "IKA → LHR" }))).toEqual({
      event: "staff.request_submitted", permissions: ["flight_request.read.any"], vars: { ref: "UT-F-ABC123", route: "IKA → LHR" }, ref: "UT-F-ABC123", consolePath: "/requests/UT-F-ABC123",
    })
    expect(feedItemFor(ev("cargo_request.submitted", { ref: "UT-C-ABC123" }))?.consolePath).toBe("/cargo/UT-C-ABC123")
    expect(feedItemFor(ev("service_request.submitted", { ref: "UT-S-ABC123", service_en: "Visa", service_fa: "ویزا" }))).toMatchObject({ event: "staff.service_submitted", permissions: ["service_request.read.any"], vars: { service_en: "Visa", service_fa: "ویزا" } })
    expect(feedItemFor(ev("support.ticket_created", { ref: "UT-T-ABC123", topic: "BOOKING_CHANGE" }))).toMatchObject({ event: "staff.support_ticket", permissions: ["support.read"], vars: { topic: "booking change" }, consolePath: "/support/UT-T-ABC123" })
    expect(feedItemFor(ev("support.customer_replied", { ref: "UT-T-ABC123" }))?.event).toBe("staff.support_reply")
    expect(feedItemFor(ev("invoice.paid", { invoiceId: "11111111-1111-4111-8111-111111111111", number: "INV-2026-000001" }))).toMatchObject({ event: "staff.invoice_paid", ref: "INV-2026-000001", consolePath: "/invoices/11111111-1111-4111-8111-111111111111" })
    expect(feedItemFor(ev("identity.submitted", { documentId: "d1", travellerName: "NEDA KARIMI" }))).toMatchObject({ event: "staff.identity_submitted", permissions: ["identity.verify"], ref: "d1", consolePath: "/verifications/d1" })
  })

  it("ignores what staff did themselves: staff messages and staff-recorded acceptances", () => {
    expect(feedItemFor(ev("flight_request.message", { ref: "UT-F-1", direction: "TO_CUSTOMER" }))).toBeNull()
    expect(feedItemFor(ev("service_request.message", { ref: "UT-S-1", direction: "TO_CUSTOMER" }))).toBeNull()
    expect(feedItemFor(ev("cargo_request.message", { ref: "UT-C-1", direction: "FROM_CUSTOMER" }))?.event).toBe("staff.customer_message")
    expect(feedItemFor(ev("quote.accepted", { ref: "UT-F-1", via: "STAFF_RECORDED" }))).toBeNull()
    expect(feedItemFor(ev("quote.accepted", { ref: "UT-F-1", via: "APP" }))?.event).toBe("staff.quote_accepted")
    expect(feedItemFor(ev("invoice.issued", { ref: "UT-F-1" }))).toBeNull()
  })

  it("every event the mapping handles is routed to notify.staff, and every feed event has a category", () => {
    for (const type of ["flight_request.submitted", "flight_request.message", "quote.accepted", "invoice.paid", "cargo_request.submitted", "cargo_request.message", "service_request.submitted", "service_request.message", "support.ticket_created", "support.customer_replied", "identity.submitted"]) {
      expect(EVENT_ROUTES[type], type).toContain("notify.staff")
    }
    for (const e of Object.keys(STAFF_FEED_EVENTS)) expect(e.startsWith("staff.")).toBe(true)
  })

  it("mark-read takes exactly one selector", () => {
    expect(MarkStaffNotificationsBody.safeParse({ all: true }).success).toBe(true)
    expect(MarkStaffNotificationsBody.safeParse({ ref: "UT-F-ABC123" }).success).toBe(true)
    expect(MarkStaffNotificationsBody.safeParse({}).success).toBe(false)
    expect(MarkStaffNotificationsBody.safeParse({ all: true, category: "REQUEST" }).success).toBe(false)
  })
})
