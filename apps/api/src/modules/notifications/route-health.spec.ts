import { describe, expect, it } from "vitest"

import { degradedRoutes } from "./route-health"

describe("degradedRoutes (ch. 30.7 SMS route failure)", () => {
  it("flags a route under 80% with a meaningful sample", () => {
    expect(degradedRoutes([
      { route: "kavenegar", status: "SENT", n: 10 },
      { route: "kavenegar", status: "DELIVERED", n: 5 },
      { route: "kavenegar", status: "FAILED", n: 4 },
      { route: "kavenegar", status: "UNDELIVERABLE", n: 2 },
    ])).toEqual([{ route: "kavenegar", rate: 71, sample: 21 }])
  })

  it("ignores healthy routes, small samples and non-attempts", () => {
    expect(degradedRoutes([
      { route: "twilio", status: "DELIVERED", n: 16 },
      { route: "twilio", status: "FAILED", n: 4 },
      { route: "small", status: "FAILED", n: 19 },
      { route: "queued", status: "QUEUED", n: 50 },
      { route: "queued", status: "SKIPPED", n: 50 },
      { route: "queued", status: "FAILED", n: 1 },
    ])).toEqual([])
  })

  it("treats exactly the threshold as healthy", () => {
    expect(degradedRoutes([{ route: "a", status: "SENT", n: 8 }, { route: "a", status: "FAILED", n: 2 }], 10)).toEqual([])
  })
})
