import { z } from "zod"

import { Iata, CarrierCode, IsoDateTime, Money, tri } from "./common"
import { Cabin, ProviderId, Rung } from "./enums"

// Chapter 21.3 — the normalised model every adapter returns.
export const TimePoint = z.object({
  local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  utc: IsoDateTime,
  tz: z.string().min(3),
})
export type TimePoint = z.infer<typeof TimePoint>

export const Segment = z.object({
  marketing: z.object({ carrier: CarrierCode, flightNumber: z.string().regex(/^\d{1,4}[A-Z]?$/) }),
  operating: z.object({ carrier: CarrierCode, flightNumber: z.string().optional() }),
  origin: z.object({ iata: Iata, terminal: z.string().optional() }),
  destination: z.object({ iata: Iata, terminal: z.string().optional() }),
  departure: TimePoint,
  arrival: TimePoint,
  cabin: Cabin,
  bookingClass: z.string().optional(),
  fareBasis: z.string().optional(),
  aircraft: z.string().optional(),
  technicalStops: z.array(z.object({ iata: Iata, durationMin: z.number().int().optional() })).default([]),
})
export type Segment = z.infer<typeof Segment>

export const Slice = z.object({
  origin: Iata,
  destination: Iata,
  segments: z.array(Segment).min(1),
  durationMin: z.number().int().nonnegative(),
})
export type Slice = z.infer<typeof Slice>

export const Baggage = z.object({ pieces: z.number().int().nonnegative().optional(), kgPerPiece: z.number().nonnegative().optional(), totalKg: z.number().nonnegative().optional() })
export type Baggage = z.infer<typeof Baggage>

export const SegmentBaggage = z.object({
  segmentIndex: z.number().int().nonnegative(),
  passengerType: z.string().default("ADT"),
  checked: tri(Baggage),
  cabin: tri(z.boolean()),
})
export type SegmentBaggage = z.infer<typeof SegmentBaggage>

export const Condition = z.object({ allowed: z.boolean(), penalty: Money.optional() })
export type Condition = z.infer<typeof Condition>

export const OfferSource = z.object({
  provider: ProviderId,
  providerOfferId: z.string(),
  rung: Rung,
  fetchedAt: IsoDateTime,
  expiresAt: IsoDateTime.optional(),
  fake: z.boolean().default(false),
})
export type OfferSource = z.infer<typeof OfferSource>

export const NormalisedOffer = z.object({
  source: OfferSource,
  slices: z.array(Slice).min(1),
  price: z.object({ total: Money, base: Money.optional(), taxes: Money.optional() }),
  validatingCarrier: CarrierCode.optional(),
  ticketing: z.literal("SINGLE_TICKET"),
  brand: tri(z.object({ name: z.string() })),
  baggage: z.array(SegmentBaggage),
  conditions: z.object({ change: tri(Condition), refund: tri(Condition) }),
  seatSelection: tri(z.enum(["FREE", "PAID", "NOT_ALLOWED"])).default({ status: "UNKNOWN" }),
  seatsRemaining: z.number().int().optional(),
  seatMapAvailable: z.boolean().default(false),
  restrictions: z.array(z.string()).default([]),
})
export type NormalisedOffer = z.infer<typeof NormalisedOffer>

// Chapter 7.3 — seat maps follow the supplier's structure; no imposed grid.
export const SeatElement = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("seat"),
    designator: z.string(),
    available: z.boolean(),
    price: Money.optional(),
    characteristics: z.array(z.string()).default([]),
  }),
  z.object({ type: z.enum(["empty", "exit_row", "lavatory", "galley", "closet", "stairs", "bassinet"]) }),
])
export type SeatElement = z.infer<typeof SeatElement>

export const SeatMap = z.object({
  segmentRef: z.string(),
  source: z.object({ provider: ProviderId, fetchedAt: IsoDateTime }),
  cabins: z.array(
    z.object({
      cabinClass: Cabin,
      deck: z.union([z.literal(0), z.literal(1)]),
      wings: z.object({ firstRow: z.number().int(), lastRow: z.number().int() }).optional(),
      rows: z.array(z.object({ sections: z.array(z.object({ elements: z.array(SeatElement) })) })),
    }),
  ),
})
export type SeatMap = z.infer<typeof SeatMap>
