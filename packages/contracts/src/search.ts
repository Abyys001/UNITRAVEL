import { z } from "zod"

import { Iata, IsoDate, IsoDateTime, Money, Uuid } from "./common"
import { Cabin, Construction, PassengerType, ProviderId, ResultTab, RiskFlag, Rung, TicketingModel, TripType } from "./enums"
import { NormalisedOffer, SegmentBaggage } from "./offer"

// Chapter 11.3 / 24.7 — search request.
export const Place = z.union([z.object({ city: Iata }), z.object({ airport: Iata })])
export type Place = z.infer<typeof Place>

export const SliceQuery = z.object({
  from: Place,
  to: Place,
  date: IsoDate,
  flexDays: z.number().int().min(0).max(3).default(0),
})

export const PassengerQuery = z.object({
  type: PassengerType,
  /** Age in years on the travel date; required for children (ch. 11.3). */
  age: z.number().int().min(0).max(120).optional(),
})

export const SearchPreferences = z.object({
  allowSelfTransfer: z.boolean().default(true),
  allowAirportChange: z.boolean().default(false),
  allowOvernight: z.boolean().default(true),
  preferredLayoverMin: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  maxStops: z.number().int().min(0).max(3).default(2),
  includeGateways: z.boolean().optional(),
  nearestCabin: z.boolean().default(false),
  studentFare: z.boolean().default(false),
})

export const SearchQuery = z
  .object({
    tripType: TripType,
    slices: z.array(SliceQuery).min(1).max(4),
    passengers: z.array(PassengerQuery).min(1).max(9),
    cabin: Cabin.default("ECONOMY"),
    preferences: SearchPreferences.prefault({}),
  })
  .superRefine((q, ctx) => {
    const expected = q.tripType === "ONE_WAY" ? 1 : q.tripType === "MULTI_CITY" ? undefined : 2
    if (expected !== undefined && q.slices.length !== expected) {
      ctx.addIssue({ code: "custom", path: ["slices"], message: `${q.tripType} needs ${expected} slice(s)` })
    }
    if (q.tripType === "MULTI_CITY" && q.slices.length < 2) ctx.addIssue({ code: "custom", path: ["slices"], message: "MULTI_CITY needs 2–4 slices" })
    const adults = q.passengers.filter((p) => ["ADT", "YTH", "STU"].includes(p.type)).length
    const lapInfants = q.passengers.filter((p) => p.type === "INF").length
    if (adults === 0) ctx.addIssue({ code: "custom", path: ["passengers"], message: "At least one adult is required; unaccompanied minors use a manual request" })
    if (lapInfants > adults) ctx.addIssue({ code: "custom", path: ["passengers"], message: "At most one lap infant per adult" })
    q.passengers.forEach((p, i) => {
      if (p.type === "CHD" && (p.age === undefined || p.age < 2 || p.age > 11)) ctx.addIssue({ code: "custom", path: ["passengers", i, "age"], message: "Child age 2–11 is required" })
    })
  })
export type SearchQuery = z.infer<typeof SearchQuery>

// Chapter 24.8 — one result item.
export const Connection = z.object({
  sliceIndex: z.number().int(),
  at: Iata,
  departAirport: Iata,
  layoverMin: z.number().int(),
  requiredMin: z.number().int(),
  inPreferredWindow: z.boolean(),
  protected: z.boolean(),
  overnight: z.boolean(),
  flags: z.array(RiskFlag),
  advisory: z.string().optional(),
  ruleId: z.string(),
})
export type Connection = z.infer<typeof Connection>

export const TruthItem = z.object({
  component: z.number().int(),
  provider: ProviderId,
  rung: Rung,
  fetchedAt: IsoDateTime,
  expiresAt: IsoDateTime.optional(),
  fake: z.boolean(),
})
export type TruthItem = z.infer<typeof TruthItem>

export const ScoreExplain = z.object({
  price: z.number(), duration: z.number(), layoverFit: z.number(), risk: z.number(), stops: z.number(), timeOfDay: z.number(),
  preferredCarrierBonus: z.number().default(0),
})
export type ScoreExplain = z.infer<typeof ScoreExplain>

export const Itinerary = z.object({
  id: z.string(),
  construction: Construction,
  ticketing: TicketingModel,
  tabs: z.array(ResultTab),
  price: z.object({ total: Money, isSumOfTickets: z.boolean() }),
  durationMin: z.number().int(),
  /** Each component is one ticket (one supplier offer). */
  components: z.array(NormalisedOffer).min(1),
  connections: z.array(Connection),
  gateway: z.object({ iata: Iata, dayOffset: z.number().int(), access: z.string(), country: z.string() }).optional(),
  truth: z.array(TruthItem),
  baggage: z.array(SegmentBaggage),
  riskFlags: z.array(RiskFlag),
  score: z.number(),
  explain: ScoreExplain,
  stops: z.number().int(),
  firstDeparture: IsoDateTime,
  lastArrival: IsoDateTime,
  carriers: z.array(z.string()),
})
export type Itinerary = z.infer<typeof Itinerary>

export const SearchStatus = z.enum(["RUNNING", "COMPLETE", "PARTIAL", "FAILED"])
export type SearchStatus = z.infer<typeof SearchStatus>

export const SearchProgress = z.object({
  sourcesTotal: z.number().int(),
  sourcesDone: z.number().int(),
  removedByPolicy: z.number().int(),
  slowSources: z.array(z.string()),
  wave: z.number().int(),
})

export const SearchCreated = z.object({ id: Uuid, status: SearchStatus, expiresAt: IsoDateTime })

export const SearchState = z.object({
  id: Uuid,
  status: SearchStatus,
  version: z.number().int(),
  query: SearchQuery,
  progress: SearchProgress,
  expiresAt: IsoDateTime,
  historical: z.boolean(),
  ruleVersion: z.number().int(),
  engineVersion: z.string(),
  notices: z.array(z.string()),
  results: z.array(Itinerary),
  nextCursor: z.string().nullable(),
  /** Results in the current tab across all pages. */
  total: z.number().int().nonnegative(),
})
export type SearchState = z.infer<typeof SearchState>

export const SearchStateQuery = z.object({
  tab: ResultTab.optional(),
  limit: z.coerce.number().int().min(1).max(60).default(20),
  cursor: z.string().optional(),
  version: z.coerce.number().int().optional(),
})

export const PriceCheckResult = z.object({
  outcome: z.enum(["CONFIRMED", "PRICE_CHANGED", "OFFER_EXPIRED", "UNAVAILABLE"]),
  previousTotal: Money,
  currentTotal: Money.optional(),
  checkedAt: IsoDateTime,
  itinerary: Itinerary.optional(),
})
export type PriceCheckResult = z.infer<typeof PriceCheckResult>

export const LocationSuggestion = z.object({
  kind: z.enum(["CITY", "AIRPORT"]),
  code: Iata,
  nameEn: z.string(),
  nameFa: z.string(),
  country: z.string(),
  cityCode: z.string().optional(),
  airports: z.array(Iata).optional(),
})
export type LocationSuggestion = z.infer<typeof LocationSuggestion>
