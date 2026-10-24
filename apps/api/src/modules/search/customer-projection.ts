import { CustomerItinerary, CustomerSeatMap, type Itinerary, type SeatMap } from "@unitravel/contracts"

/**
 * ADR-0004: customers, and staff without `pricing.read.internal`, never receive an amount before a sent quote.
 * Fields are removed, not zeroed. Booking class and fare basis stay staff-only too (ch. 15.2). Parsing through the
 * strict customer schema is the backstop: anything added to the stored itinerary later is dropped, not leaked.
 */
export function customerItinerary(it: Itinerary): CustomerItinerary {
  const { price: _p, score: _s, explain: _e, tabs, components, ...rest } = it
  return CustomerItinerary.parse({
    ...rest,
    tabs: tabs.filter((t) => t !== "CHEAPEST"),
    components: components.map(({ price: _cp, conditions, slices, ...c }) => ({
      ...c,
      conditions: { change: conditionView(conditions.change), refund: conditionView(conditions.refund) },
      slices: slices.map((s) => ({ ...s, segments: s.segments.map(({ bookingClass: _b, fareBasis: _f, ...seg }) => seg) })),
    })),
  })
}

function conditionView(c: Itinerary["components"][number]["conditions"]["change"]) {
  return c.status === "KNOWN" ? { status: "KNOWN" as const, value: { allowed: c.value.allowed } } : c
}

export function customerSeatMaps(maps: SeatMap[]): CustomerSeatMap[] {
  return maps.map((m) => CustomerSeatMap.parse(m))
}
