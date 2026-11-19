import { describe, expect, it } from "vitest"

import { CreateFlightRequestBody } from "./requests"
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOGUE } from "./permissions"
import { CapturedBaggage, FlightBuilderCaptureInput, FlightBuilderSettings, PublicFare, UsageObservationInput } from "./flight-builder"

const unknownBag = { segmentIndex: 0, checked: { status: "UNKNOWN" }, cabin: { status: "UNKNOWN" } }
const fare = (over: Record<string, unknown> = {}) => ({
  cabin: "ECONOMY", bookingClasses: ["Y"], seats: ["4"], fareBasis: ["YOW"], fareType: "PUB", totalMinor: 12000, currency: "GBP",
  baggage: [unknownBag], change: { state: "UNKNOWN" }, refund: { state: "NOT_ALLOWED" }, ...over,
})
const seg = { carrier: "TK", flightNumber: "1980", from: "LHR", to: "IST", departLocal: "2026-12-01T09:00", arriveLocal: "2026-12-01T14:50" }
const input = (over: Record<string, unknown> = {}) => ({ observedAt: "2026-11-19T10:00:00Z", segments: [seg], fares: [fare()], ...over })

describe("flight builder capture input (ADR-0037)", () => {
  it("accepts a valid capture", () => {
    expect(FlightBuilderCaptureInput.safeParse(input()).success).toBe(true)
  })
  it("requires base + taxes = total when both given", () => {
    expect(FlightBuilderCaptureInput.safeParse(input({ fares: [fare({ baseMinor: 10000, taxesMinor: 2000 })] })).success).toBe(true)
    expect(FlightBuilderCaptureInput.safeParse(input({ fares: [fare({ baseMinor: 10000, taxesMinor: 1999 })] })).success).toBe(false)
    expect(FlightBuilderCaptureInput.safeParse(input({ fares: [fare({ baseMinor: 10000 })] })).success).toBe(true)
  })
  it("rejects negative amounts", () => {
    expect(FlightBuilderCaptureInput.safeParse(input({ fares: [fare({ totalMinor: -1 })] })).success).toBe(false)
    expect(FlightBuilderCaptureInput.safeParse(input({ fares: [fare({ change: { state: "KNOWN_ALLOWED", penaltyMinor: -5 } })] })).success).toBe(false)
  })
  it("requires per-segment arrays to match the segment count", () => {
    expect(FlightBuilderCaptureInput.safeParse(input({ fares: [fare({ seats: ["4", "5"] })] })).success).toBe(false)
    expect(FlightBuilderCaptureInput.safeParse(input({ fares: [fare({ bookingClasses: ["Y", "Y"] })] })).success).toBe(false)
    expect(FlightBuilderCaptureInput.safeParse(input({ fares: [fare({ baggage: [unknownBag, unknownBag] })] })).success).toBe(false)
    expect(FlightBuilderCaptureInput.safeParse(input({ fares: [fare({ fareBasis: ["A", "B"] })] })).success).toBe(false)
  })
  it("needs at least one segment and one fare", () => {
    expect(FlightBuilderCaptureInput.safeParse(input({ segments: [] })).success).toBe(false)
    expect(FlightBuilderCaptureInput.safeParse(input({ fares: [] })).success).toBe(false)
  })
})

describe("flight builder public contracts", () => {
  it("PublicFare is strict: a price cannot ride along", () => {
    const pub = {
      id: "6f1c1a0e-1b2c-4d3e-8f90-123456789abc", cabin: "ECONOMY", bookingClasses: ["Y"], seats: [{ raw: "9", count: null, atCap: true }],
      baggage: [unknownBag], conditions: { change: { state: "UNKNOWN" }, refund: { state: "NOT_ALLOWED" } }, ticketingDeadline: null,
      deadlineWarning: false, observedAt: "2026-11-19T10:00:00Z", freshness: "FRESH",
    }
    expect(PublicFare.safeParse(pub).success).toBe(true)
    expect(PublicFare.safeParse({ ...pub, totalMinor: 1 }).success).toBe(false)
    expect(PublicFare.safeParse({ ...pub, conditions: { ...pub.conditions, change: { state: "KNOWN_ALLOWED", penaltyMinor: 5 } } }).success).toBe(false)
  })
  it("settings default to DISABLED and reject unsafe panel URLs", () => {
    expect(FlightBuilderSettings.parse({}).syncMode).toBe("DISABLED")
    expect(FlightBuilderSettings.safeParse({ panelUrl: "http://panel.example" }).success).toBe(false)
    expect(FlightBuilderSettings.safeParse({ panelUrl: "https://u:p@panel.example" }).success).toBe(false)
    expect(FlightBuilderSettings.safeParse({ panelUrl: "https://panel.example/x" }).success).toBe(true)
  })
  it("usage observation defaults thresholds 45/50 and rejects warning above critical", () => {
    const o = UsageObservationInput.parse({ observedAt: "2026-11-19T10:00:00Z", bookings: 2, scanHits: 10 })
    expect([o.warningThreshold, o.criticalThreshold, o.source]).toEqual([45, 50, "MANUAL"])
    expect(UsageObservationInput.safeParse({ observedAt: "2026-11-19T10:00:00Z", bookings: 1, scanHits: 1, warningThreshold: 60 }).success).toBe(false)
  })
  it("CATALOG requests need the catalog block", () => {
    const base = { kind: "CATALOG", travellers: [{ travellerId: "6f1c1a0e-1b2c-4d3e-8f90-123456789abc", passengerType: "ADT" }], contactIdentityId: "6f1c1a0e-1b2c-4d3e-8f90-123456789abc", acknowledgements: { notABooking: true, privacy: true } }
    expect(CreateFlightRequestBody.safeParse(base).success).toBe(false)
    expect(CreateFlightRequestBody.safeParse({ ...base, catalog: { resultId: "6f1c1a0e-1b2c-4d3e-8f90-123456789abc", fareId: "6f1c1a0e-1b2c-4d3e-8f90-123456789abd" } }).success).toBe(true)
  })
  it("permissions: capture is non-privileged for admin/owner; authorisation is privileged and owner-only", () => {
    expect(PERMISSION_CATALOGUE["catalog.capture"].privileged).toBe(false)
    expect(PERMISSION_CATALOGUE["provider.authorisation.record"].privileged).toBe(true)
    expect(DEFAULT_ROLE_PERMISSIONS.admin).toContain("catalog.capture")
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toContain("catalog.capture")
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toContain("provider.authorisation.record")
    for (const r of ["admin", "developer", "customer", "cargo_admin", "compliance_officer"] as const) expect(DEFAULT_ROLE_PERMISSIONS[r]).not.toContain("provider.authorisation.record")
  })
})

describe("customer-visible baggage wording", () => {
  const bag = (sourceText: string) => ({ segmentIndex: 0, passengerType: "ADT", checked: { status: "UNKNOWN" }, cabin: { status: "UNKNOWN" }, sourceText })
  it("accepts the panel's wording", () => {
    expect(CapturedBaggage.safeParse(bag("1PC 23KG")).success).toBe(true)
    expect(CapturedBaggage.safeParse(bag("No baggage included")).success).toBe(true)
  })
  it("rejects money so a typed price cannot reach a customer", () => {
    for (const t of ["£40 extra bag", "1PC + 35 GBP", "USD 20", "€15"]) expect(CapturedBaggage.safeParse(bag(t)).success).toBe(false)
  })
})
