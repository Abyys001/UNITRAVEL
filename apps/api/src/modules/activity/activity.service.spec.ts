import { describe, expect, it } from "vitest"

import { trackingDeclined } from "./activity.service"

describe("activity tracking opt-out (ADR-0018)", () => {
  it("tracks when nothing is declined", () => {
    expect(trackingDeclined({}, null)).toBe(false)
    expect(trackingDeclined({ dnt: "0" }, { activity_tracking: true })).toBe(false)
    expect(trackingDeclined({}, { marketing: false })).toBe(false)
  })
  it("Do Not Track, Global Privacy Control and the customer's own setting each stop it", () => {
    expect(trackingDeclined({ dnt: "1" }, null)).toBe(true)
    expect(trackingDeclined({ gpc: "1" }, null)).toBe(true)
    expect(trackingDeclined({}, { activity_tracking: false })).toBe(true)
  })
})
