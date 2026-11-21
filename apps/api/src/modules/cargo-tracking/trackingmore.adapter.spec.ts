import { describe, expect, it } from "vitest"

import { dedupeIncoming } from "@unitravel/domain"

import { awbEvents, parseAwbResponse, TrackingMoreAdapter, TrackingMoreError } from "./trackingmore.adapter"

// SYNTHETIC fixtures, written from the field names of the vendor's official SDK models (AirWaybill, TrackInfo, AirlineInfo). Not recorded
// from the live API; values, airport codes and the date format are made up for these tests only.
const envelope = {
  meta: { code: 200, type: "Success", message: "Request response is successful" },
  data: {
    awb_number: "235-69030430", awb_status: "transit", airline_info: { name: "Synthetic Air Cargo" },
    track_info: [
      { plan_date: null, actual_date: "2026-11-02 08:15:00", event: "Received from shipper", station: "LHR", flight_number: null, status: "RCS", checkpoint_status: "transit" },
      { plan_date: "2026-11-03 10:00:00", actual_date: null, event: "Departed", station: "LHR", flight_number: "XX123", status: "DEP", checkpoint_status: "transit" },
      { plan_date: "2026-11-04 12:00:00", actual_date: "2026-11-04T12:30:00+03:30", event: "Delivered", station: "IKA", flight_number: null, status: "DLV", checkpoint_status: "delivered" },
      { plan_date: null, actual_date: null, event: "No date at all", station: "IKA", status: "XXX", checkpoint_status: "transit" },
    ],
  },
}

describe("TrackingMore AWB mapping", () => {
  it("keeps the provider's words, maps only 'delivered', and drops a checkpoint that has no date", () => {
    const { airline, events } = parseAwbResponse("235-69030430", 200, envelope)
    expect(airline).toBe("Synthetic Air Cargo")
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ eventCode: "NOTE", location: "LHR", occurredAt: "2026-11-02T08:15:00.000Z", description: "Received from shipper · RCS" })
    expect(events[1]).toMatchObject({ eventCode: "NOTE", description: "Departed · DEP · XX123", occurredAt: "2026-11-03T10:00:00.000Z" })
    expect(events[2]).toMatchObject({ eventCode: "DELIVERED", occurredAt: "2026-11-04T09:00:00.000Z" })
  })

  it("gives the same external ids on a replay, so dedupe stores nothing twice", () => {
    const a = awbEvents("235-69030430", envelope.data), b = awbEvents("235-69030430", envelope.data)
    expect(a.map((e) => e.externalEventId)).toEqual(b.map((e) => e.externalEventId))
    expect(new Set(a.map((e) => e.externalEventId)).size).toBe(a.length)
    expect(dedupeIncoming(b, new Set(a.map((e) => e.externalEventId!)))).toEqual([])
  })

  it.each([
    [401, 401, "AUTH"], [400, 4160, "INVALID_AWB"], [400, 4161, "AIRLINE_UNSUPPORTED"], [400, 4190, "QUOTA"], [429, 429, "RATE_LIMITED"], [500, 512, "UNAVAILABLE"],
  ])("HTTP %i / meta %i is %s", (http, meta, failure) => {
    expect(() => parseAwbResponse("235-69030430", http, { meta: { code: meta } })).toThrow(expect.objectContaining({ failure }))
  })

  it("posts the AWB with the vendor's key header and never puts the key in an error", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(envelope), { status: 200 }) }) as typeof fetch
    try {
      const a = new TrackingMoreAdapter("SECRET-key-123456", "https://tm.test/v4")
      expect(await a.fetchEvents({ ref: "UT-C-7Q2K9M", awbNumber: "235-69030430" })).toHaveLength(3)
      expect(calls[0]!.url).toBe("https://tm.test/v4/awb")
      expect((calls[0]!.init.headers as Record<string, string>)["Tracking-Api-Key"]).toBe("SECRET-key-123456")
      expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ awb_number: "235-69030430" })
      expect(await a.fetchEvents({ ref: "UT-C-7Q2K9M", awbNumber: null })).toEqual([])
      globalThis.fetch = (async () => { throw Object.assign(new Error("connect https://tm.test/v4 SECRET-key-123456"), { name: "FetchError" }) }) as unknown as typeof fetch
      const err = (await a.lookup("235-69030430").catch((e) => e)) as TrackingMoreError
      expect(err).toBeInstanceOf(TrackingMoreError)
      expect(String(err.message)).not.toContain("SECRET-")
    } finally { globalThis.fetch = real }
  })
})
