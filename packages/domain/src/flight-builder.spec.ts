import { describe, expect, it } from "vitest"

import { authorisationActive, deadlineWarning, fareFreshness, fbConnectionState, type FbConnectionFacts, seatsReported, syncGate, usageSummary } from "./flight-builder"

const now = new Date("2026-11-19T12:00:00Z")
const auth = { revokedAt: null, expiresAt: null }
const facts = (o: Partial<FbConnectionFacts> = {}): FbConnectionFacts => ({
  enabled: true, credentialsSet: true, panelUrlSet: true, usageRatio: null, authorisation: auth, credentialsInvalidAt: null, verifiedCheckAt: null, ...o,
})

describe("seatsReported", () => {
  it("flags 9 as a cap and never a count", () => {
    expect(seatsReported("9")).toEqual({ raw: "9", count: null, atCap: true })
    expect(seatsReported("4")).toEqual({ raw: "4", count: 4, atCap: false })
    expect(seatsReported("X")).toEqual({ raw: "X", count: null, atCap: false })
  })
})

describe("fbConnectionState ordering", () => {
  it("follows the design order", () => {
    expect(fbConnectionState(facts({ enabled: false, credentialsSet: false }), now)).toBe("DISABLED")
    expect(fbConnectionState(facts({ credentialsSet: false }), now)).toBe("NOT_CONFIGURED")
    expect(fbConnectionState(facts({ panelUrlSet: false }), now)).toBe("NOT_CONFIGURED")
    expect(fbConnectionState(facts({ usageRatio: 1, authorisation: null }), now)).toBe("ACCESS_RESTRICTED")
    expect(fbConnectionState(facts({ authorisation: null, credentialsInvalidAt: now }), now)).toBe("AUTHORIZATION_PENDING")
    expect(fbConnectionState(facts({ credentialsInvalidAt: now, verifiedCheckAt: now }), now)).toBe("AUTH_FAILED")
    expect(fbConnectionState(facts(), now)).toBe("CONFIGURED")
  })
  it("CONNECTED needs a verified check within 24 h", () => {
    expect(fbConnectionState(facts({ verifiedCheckAt: new Date("2026-11-18T12:00:00Z") }), now)).toBe("CONNECTED")
    expect(fbConnectionState(facts({ verifiedCheckAt: new Date("2026-11-18T11:59:59Z") }), now)).toBe("CONFIGURED")
  })
  it("revoked or expired authorisation is pending", () => {
    expect(authorisationActive({ revokedAt: now, expiresAt: null }, now)).toBe(false)
    expect(authorisationActive({ revokedAt: null, expiresAt: new Date("2026-11-19T11:00:00Z") }, now)).toBe(false)
    expect(fbConnectionState(facts({ authorisation: { revokedAt: now, expiresAt: null } }), now)).toBe("AUTHORIZATION_PENDING")
  })
})

describe("syncGate", () => {
  const g = (o = {}) => ({ enabled: true, authorisation: auth, adapterPresent: false, usageRatio: null, ...o })
  it("is never allowed while adapterPresent=false", () => {
    for (const authorisation of [null, auth, { revokedAt: now, expiresAt: null }]) {
      for (const usageRatio of [null, 0, 1.2]) expect(syncGate(g({ authorisation, usageRatio }), now).allowed).toBe(false)
    }
    expect(syncGate(g(), now)).toEqual({ allowed: false, reason: "NO_ADAPTER" })
  })
  it("reasons", () => {
    expect(syncGate(g({ enabled: false }), now).reason).toBe("DISABLED")
    expect(syncGate(g({ authorisation: null }), now).reason).toBe("NOT_AUTHORISED")
    expect(syncGate(g({ adapterPresent: true, usageRatio: 1 }), now).reason).toBe("QUOTA_CRITICAL")
    expect(syncGate(g({ adapterPresent: true }), now)).toEqual({ allowed: true, reason: null })
  })
})

describe("fareFreshness", () => {
  const s = { freshHours: 6, staleHours: 24 }
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000)
  it("ages by observation time", () => {
    expect(fareFreshness(ago(5.99), null, now, s)).toBe("FRESH")
    expect(fareFreshness(ago(6), null, now, s)).toBe("AGING")
    expect(fareFreshness(ago(23.99), null, now, s)).toBe("AGING")
    expect(fareFreshness(ago(24), null, now, s)).toBe("STALE")
  })
  it("expires at 00:00 UTC of the deadline date", () => {
    expect(fareFreshness(new Date("2026-11-19T23:00:00Z"), "2026-11-20", new Date("2026-11-19T23:59:59Z"), s)).toBe("FRESH")
    expect(fareFreshness(ago(1), "2026-11-20", new Date("2026-11-20T00:00:00Z"), s)).toBe("EXPIRED")
    expect(fareFreshness(ago(1), "2026-11-19", now, s)).toBe("EXPIRED")
    expect(fareFreshness(ago(100), "2026-11-18", now, s)).toBe("EXPIRED")
  })
})

describe("deadlineWarning", () => {
  it("warns within the window only", () => {
    expect(deadlineWarning("2026-11-21", now, 48)).toBe(true)
    expect(deadlineWarning("2026-11-22", now, 48)).toBe(false)
    expect(deadlineWarning("2026-11-19", now, 48)).toBe(false)
    expect(deadlineWarning(null, now, 48)).toBe(false)
  })
})

describe("usageSummary", () => {
  const obs = (scanHits: number, bookings = 1, at = now) => ({ observedAt: at, bookings, scanHits, warningThreshold: 45, criticalThreshold: 50 })
  it("no observations gives null", () => expect(usageSummary([], now)).toBeNull())
  it("levels use scan hits per booking: warning at 45, critical at 50", () => {
    expect(usageSummary([obs(440, 10)], now)?.level).toBe("OK")
    expect(usageSummary([obs(450, 10)], now)?.level).toBe("WARNING")
    expect(usageSummary([obs(499, 10)], now)?.level).toBe("WARNING")
    expect(usageSummary([obs(500, 10)], now)?.level).toBe("CRITICAL")
    expect(usageSummary([obs(500, 10)], now)?.limitShare).toBe(1)
  })
  it("the research observation (481 hits, 10 bookings) is a warning at 48.1 per booking", () => {
    const s = usageSummary([obs(481, 10)], now)
    expect(s?.ratio).toBeCloseTo(48.1)
    expect(s?.level).toBe("WARNING")
    expect(s?.headroomEstimate).toBe(19)
  })
  it("7 hits over 2 bookings is 3.5 per booking, not a share of the limit", () => {
    expect(usageSummary([obs(7, 2)], now)?.ratio).toBe(3.5)
  })
  it("zero bookings gives an UNKNOWN level, never a guessed ratio", () => {
    const s = usageSummary([obs(7, 0)], now)
    expect(s?.level).toBe("UNKNOWN")
    expect(s?.limitShare).toBeNull()
  })
  it("headroom estimate is critical x bookings - hits, floored at 0, and labelled", () => {
    const s = usageSummary([obs(30, 2)], now)
    expect(s?.headroomEstimate).toBe(70)
    expect(s?.estimateLabel).toBe("ESTIMATED")
    expect(usageSummary([obs(500, 2)], now)?.headroomEstimate).toBe(0)
  })
  it("uses the latest observation and marks it stale after 7 days", () => {
    const old = new Date("2026-11-01T00:00:00Z")
    const s = usageSummary([obs(10, 1, old), obs(20, 1, new Date("2026-11-12T12:00:00Z"))], now)
    expect(s?.ratio).toBe(20)
    expect(s?.stale).toBe(false)
    expect(usageSummary([obs(10, 1, new Date("2026-11-12T11:59:59Z"))], now)?.stale).toBe(true)
  })
  it("never decrements: a later observation with fewer hits is read as written, not subtracted", () => {
    const input = [obs(40, 1, new Date("2026-11-18T00:00:00Z")), obs(5, 1, new Date("2026-11-19T00:00:00Z"))]
    expect(usageSummary(input, now)?.headroomEstimate).toBe(45)
    expect(input.map((o) => o.scanHits)).toEqual([40, 5])
  })
})
