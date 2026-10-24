import { describe, expect, it } from "vitest"

import { TRACKING_EVENT_CODES, TRACKING_EVENT_LABELS } from "@unitravel/contracts"

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
})
