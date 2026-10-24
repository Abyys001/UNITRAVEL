import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { TRACKING_EVENT_CODES } from "@unitravel/contracts"

import { dedupeIncoming, effectiveRecordIds, effectiveTimeline, type IncomingTrackingEvent, ManualTrackingAdapter, RETRACTED, type TrackingRecord } from "./cargo-tracking"

const t = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString()
const code = fc.constantFrom(...TRACKING_EVENT_CODES)
const original = (i: number): fc.Arbitrary<TrackingRecord> =>
  fc.record({ eventCode: code, location: fc.string({ minLength: 2, maxLength: 8 }), occ: fc.integer({ min: 0, max: 500 }) })
    .map(({ eventCode, location, occ }) => ({ id: `e${i}`, eventCode, location, occurredAt: t(occ), createdAt: t(1000 + i) }))

/** A history: some originals, then corrections (of originals or of earlier corrections), appended in order. */
const history = fc.integer({ min: 1, max: 6 }).chain((n) =>
  fc.tuple(...Array.from({ length: n }, (_, i) => original(i))).chain((origs) =>
    fc.array(fc.record({ target: fc.nat(), eventCode: fc.oneof(code, fc.constant(RETRACTED)), occ: fc.integer({ min: 0, max: 500 }) }), { maxLength: 8 }).map((cs) => {
      const rows: TrackingRecord[] = [...origs]
      cs.forEach((c, k) => {
        const target = rows[c.target % rows.length]!
        rows.push({ id: `c${k}`, eventCode: c.eventCode, location: "fix", occurredAt: t(c.occ), correctsEventId: target.id, createdAt: t(2000 + k) })
      })
      return rows
    })))

describe("tracking corrections (property)", () => {
  it("effective timeline has one entry per original event unless retracted, in time order", () => {
    fc.assert(fc.property(history, (rows) => {
      const eff = effectiveTimeline(rows)
      const originals = rows.filter((r) => !r.correctsEventId)
      expect(eff.length).toBeLessThanOrEqual(originals.length)
      expect(new Set(eff.map((e) => e.id)).size).toBe(eff.length)
      for (let i = 1; i < eff.length; i++) expect(eff[i - 1]!.occurredAt <= eff[i]!.occurredAt).toBe(true)
      expect(eff.every((e) => (e.eventCode as string) !== RETRACTED)).toBe(true)
    }), { numRuns: 1000 })
  })

  it("appending never mutates earlier records, and an uncorrected event is unchanged", () => {
    fc.assert(fc.property(history, (rows) => {
      const before = JSON.stringify(rows)
      effectiveTimeline(rows)
      expect(JSON.stringify(rows)).toBe(before)
      const eff = effectiveTimeline(rows)
      const corrected = new Set(rows.filter((r) => r.correctsEventId).map((r) => r.id))
      for (const e of eff) {
        if (e.corrected) continue
        const o = rows.find((r) => r.id === e.id)!
        expect([e.eventCode, e.location, e.occurredAt]).toEqual([o.eventCode, o.location, o.occurredAt])
      }
      expect(corrected.size).toBe(rows.filter((r) => r.correctsEventId).length)
    }), { numRuns: 500 })
  })

  it("the latest correction wins, a correction of a correction resolves to the original, retraction removes", () => {
    const rows: TrackingRecord[] = [
      { id: "a", eventCode: "DEPARTED", location: "LHR", occurredAt: t(10), createdAt: t(100) },
      { id: "b", eventCode: "ARRIVED", location: "IST", occurredAt: t(20), createdAt: t(101) },
      { id: "c1", eventCode: "HELD", location: "LHR", occurredAt: t(10), correctsEventId: "a", createdAt: t(200) },
      { id: "c2", eventCode: "ARRIVED", location: "LGW", occurredAt: t(11), correctsEventId: "c1", createdAt: t(201) },
      { id: "c3", eventCode: RETRACTED, location: "x", occurredAt: t(0), correctsEventId: "b", createdAt: t(202) },
    ]
    expect(effectiveTimeline(rows)).toEqual([{ id: "a", eventCode: "ARRIVED", location: "LGW", occurredAt: t(11), description: undefined, corrected: true }])
    expect(effectiveTimeline(rows.slice(0, 3))[0]).toMatchObject({ id: "a", eventCode: "HELD", corrected: true })
    expect([...effectiveRecordIds(rows)]).toEqual(["c2"])
  })

  it("ignores a correction aimed at an unknown event", () => {
    const rows: TrackingRecord[] = [{ id: "a", eventCode: "DEPARTED", location: "LHR", occurredAt: t(1), createdAt: t(1) }, { id: "z", eventCode: "HELD", location: "x", occurredAt: t(2), correctsEventId: "nope", createdAt: t(2) }]
    expect(effectiveTimeline(rows)).toHaveLength(1)
    expect(effectiveTimeline(rows)[0]!.corrected).toBe(false)
  })
})

describe("deduplication", () => {
  const ev = (id: string | null): IncomingTrackingEvent => ({ externalEventId: id, eventCode: "DEPARTED", location: "LHR", occurredAt: t(1) })
  it("keeps one event per external id, is idempotent, and always keeps staff entries", () => {
    fc.assert(fc.property(fc.array(fc.option(fc.constantFrom("p1", "p2", "p3"), { nil: null })), fc.array(fc.constantFrom("p1", "p2")), (ids, stored) => {
      const once = dedupeIncoming(ids.map(ev), new Set(stored))
      const external = once.filter((e) => e.externalEventId).map((e) => e.externalEventId)
      expect(new Set(external).size).toBe(external.length)
      expect(external.some((x) => stored.includes(x!))).toBe(false)
      expect(dedupeIncoming(once, new Set(stored))).toEqual(once)
      expect(once.filter((e) => e.externalEventId === null).length).toBe(ids.filter((i) => i === null).length)
    }))
  })
  it("the manual adapter hands over staff entries with no external id", async () => {
    const a = new ManualTrackingAdapter([{ eventCode: "RECEIVED", location: "London hub", occurredAt: t(1) }])
    expect(a.source).toBe("STAFF")
    expect(await a.fetchEvents()).toEqual([{ externalEventId: null, eventCode: "RECEIVED", location: "London hub", occurredAt: t(1) }])
  })
})
