import { describe, expect, it } from "vitest"

import { ACTIVITY_SCREENS, ActivityBody, CustomerListQuery } from "./activity"

describe("activity telemetry body (ADR-0018)", () => {
  it("accepts a known screen with or without a reference", () => {
    expect(ActivityBody.safeParse({ screen: "billing" }).success).toBe(true)
    expect(ActivityBody.safeParse({ screen: "request_detail", ref: "UT-F-ABC234" }).success).toBe(true)
  })
  it("rejects unknown screens, free text refs, extra fields (no content can ride along)", () => {
    for (const bad of [{ screen: "checkout" }, { screen: "home", ref: "my passport is 123" }, { screen: "home", note: "x" }, { screen: "home", ref: "a" }, {}]) {
      expect(ActivityBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
  it("the allow-list holds only lower snake-case names", () => {
    for (const s of ACTIVITY_SCREENS) expect(s).toMatch(/^[a-z]+(?:_[a-z]+)*$/)
  })
})

describe("customer list query", () => {
  it("defaults the page size and parses the verified flag", () => {
    expect(CustomerListQuery.parse({})).toMatchObject({ limit: 25 })
    expect(CustomerListQuery.parse({ verified: "true" }).verified).toBe(true)
    expect(CustomerListQuery.parse({ verified: "false" }).verified).toBe(false)
    expect(CustomerListQuery.safeParse({ limit: "500" }).success).toBe(false)
  })
})
