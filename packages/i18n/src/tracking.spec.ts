import { describe, expect, it } from "vitest"

import { CARGO_MILESTONE_LABELS, CARGO_MILESTONES, TRACKING_EVENT_CODES, TRACKING_EVENT_LABELS } from "@unitravel/contracts"

import { en, fa } from "./index"

describe("tracking event labels (Phase E)", () => {
  it("every event code has an en and fa label, equal to the contract labels the API uses, and never the raw code", () => {
    expect(Object.keys(en.tracking.events).sort()).toEqual([...TRACKING_EVENT_CODES].sort())
    expect(Object.keys(fa.tracking.events).sort()).toEqual([...TRACKING_EVENT_CODES].sort())
    for (const code of TRACKING_EVENT_CODES) {
      expect(en.tracking.events[code]).toBe(TRACKING_EVENT_LABELS[code].en)
      expect(fa.tracking.events[code]).toBe(TRACKING_EVENT_LABELS[code].fa)
      expect(en.tracking.events[code]).not.toBe(code)
      expect(/[؀-ۿ]/.test(fa.tracking.events[code])).toBe(true)
    }
  })

  it("every cargo milestone (ADR-0042) has the contract's en and fa label", () => {
    expect(Object.keys(en.cargoTracking.milestones).sort()).toEqual([...CARGO_MILESTONES].sort())
    expect(Object.keys(fa.cargoTracking.milestones).sort()).toEqual([...CARGO_MILESTONES].sort())
    for (const m of CARGO_MILESTONES) {
      expect(en.cargoTracking.milestones[m]).toBe(CARGO_MILESTONE_LABELS[m].en)
      expect(fa.cargoTracking.milestones[m]).toBe(CARGO_MILESTONE_LABELS[m].fa)
    }
  })
})
