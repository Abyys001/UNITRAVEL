import { describe, expect, it } from "vitest"

import { canonicalJson, chainHash } from "./audit.service"

const base = { actorKind: "STAFF" as const, action: "x.y", entityType: "t", occurredAt: "2026-10-24T10:00:00.000Z" }

describe("audit hash canonicalisation", () => {
  it("is independent of key order at every depth, as after a jsonb round trip", () => {
    const a = { b: 1, a: { z: [1, { y: 2, x: 3 }], c: null } }
    const b = { a: { c: null, z: [1, { x: 3, y: 2 }] }, b: 1 }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(chainHash("0".repeat(64), { ...base, before: null, after: a })).toBe(chainHash("0".repeat(64), { ...base, before: null, after: b }))
  })

  it("still detects changed content and keeps array order significant", () => {
    const h = (after: unknown) => chainHash("p", { ...base, before: null, after })
    expect(h({ a: 1 })).not.toBe(h({ a: 2 }))
    expect(h({ a: [1, 2] })).not.toBe(h({ a: [2, 1] }))
  })

  it("legacy version 1 depends on key order, which is why those rows are reported separately", () => {
    const h = (after: unknown) => chainHash("p", { ...base, before: null, after }, 1)
    expect(h({ a: 1, b: 2 })).not.toBe(h({ b: 2, a: 1 }))
  })
})
