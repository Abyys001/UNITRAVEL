import { z } from "zod"

import { Iata, IsoDateTime, LocalisedText, Money, page, Uuid } from "./common"
import { Segment } from "./offer"

// ADR-0021: curated listings (bus, train, stay) and cached flight listings. "Real or empty": nothing here is invented, scraped
// or shown as available; every item says where it comes from and, for flights, when it was fetched.

export const LISTING_VERTICALS = ["BUS", "TRAIN", "STAY"] as const
export const ListingVertical = z.enum(LISTING_VERTICALS)
export type ListingVertical = z.infer<typeof ListingVertical>
/** Public URL segment per vertical. */
export const LISTING_PATHS = { buses: "BUS", trains: "TRAIN", stays: "STAY" } as const satisfies Record<string, ListingVertical>
export const ListingPath = z.enum(["buses", "trains", "stays"])
export const LISTING_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const
export const ListingStatus = z.enum(LISTING_STATUSES)
export type ListingStatus = z.infer<typeof ListingStatus>

const Place = z.string().trim().min(2).max(80)
const Loc = (min: number, max: number) => z.object({ en: z.string().trim().min(min).max(max), fa: z.string().trim().min(min).max(max) })

/**
 * A price exists only when staff entered one and marked it quoted; otherwise there is no amount at all (the schema cannot
 * hold one), so an "indicative" row can never look like an offer.
 */
const ListingShape = z.object({
  vertical: ListingVertical,
  title: Loc(2, 120),
  summary: LocalisedText.extend({ en: z.string().trim().max(400), fa: z.string().trim().max(400) }),
  /** Origin for buses and trains; empty for a stay. */
  fromPlace: Place.nullable(),
  toPlace: Place,
  operator: z.string().trim().min(2).max(80).nullable(),
  priceQuoted: z.boolean(),
  price: Money.refine((m) => m.amountMinor > 0, { message: "The price must be greater than zero" }).nullable(),
  validUntil: IsoDateTime.nullable(),
  sortOrder: z.number().int().min(0).max(10_000),
})
/** Defaults belong to creation only: `.partial()` keeps `.default()` in Zod 4 and a PATCH would silently reset fields (see TravellerPatch). */
const ListingFields = ListingShape.extend({
  summary: ListingShape.shape.summary.default({ en: "", fa: "" }),
  fromPlace: ListingShape.shape.fromPlace.default(null),
  operator: ListingShape.shape.operator.default(null),
  priceQuoted: ListingShape.shape.priceQuoted.default(false),
  price: ListingShape.shape.price.default(null),
  validUntil: ListingShape.shape.validUntil.default(null),
  sortOrder: ListingShape.shape.sortOrder.default(100),
})
const priceRule = (b: { priceQuoted?: boolean; price?: unknown }) => (b.priceQuoted ? b.price != null : b.price == null)

export const CuratedListingBody = ListingFields.refine(priceRule, { message: "A price needs priceQuoted, and priceQuoted needs a price", path: ["price"] })
export type CuratedListingBody = z.infer<typeof CuratedListingBody>
export const CuratedListingPatch = ListingShape.partial().extend({ version: z.number().int().positive(), status: ListingStatus.optional() })
export type CuratedListingPatch = z.infer<typeof CuratedListingPatch>

export const LISTING_LABELS = ["INDICATIVE", "CACHED_OFFER", "SANDBOX"] as const
export const ListingLabel = z.enum(LISTING_LABELS)

/** Public item: indicative, confirmed on quote. `price` is null unless staff quoted one. */
export const CuratedListingView = z.object({
  id: Uuid, vertical: ListingVertical, title: LocalisedText, summary: LocalisedText, fromPlace: z.string().nullable(), toPlace: z.string(), operator: z.string().nullable(),
  label: z.literal("INDICATIVE"), price: Money.nullable(), validUntil: IsoDateTime.nullable(), updatedAt: IsoDateTime,
})
export type CuratedListingView = z.infer<typeof CuratedListingView>
export const PublicListingsView = z.object({ vertical: ListingVertical, items: z.array(CuratedListingView), notice: z.literal("INDICATIVE_ONLY") })
export type PublicListingsView = z.infer<typeof PublicListingsView>

export const StaffListingView = CuratedListingView.omit({ label: true }).extend({
  status: ListingStatus, priceQuoted: z.boolean(), sortOrder: z.number().int(), version: z.number().int(), createdAt: IsoDateTime,
})
export type StaffListingView = z.infer<typeof StaffListingView>
export const StaffListingPage = page(StaffListingView)
export const StaffListingQuery = z.object({
  vertical: ListingVertical.optional(), status: ListingStatus.optional(), q: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(200).optional(),
})
export type StaffListingQuery = z.infer<typeof StaffListingQuery>
export const PublicListingQuery = z.object({ to: z.string().trim().min(1).max(80).optional(), from: z.string().trim().min(1).max(80).optional() })
export type PublicListingQuery = z.infer<typeof PublicListingQuery>

// ---- flights: cached live-adapter results only ----
/** No amounts: customers see none before a sent quote (ADR-0004). The label and `fetchedAt` are shown with every item. */
export const FlightListingItem = z.object({
  label: z.enum(["CACHED_OFFER", "SANDBOX"]),
  fetchedAt: IsoDateTime,
  origin: Iata, destination: Iata, departureDate: z.string(),
  carriers: z.array(z.string()), stops: z.number().int().min(0), durationMin: z.number().int().min(0),
  departureLocal: z.string(), arrivalLocal: z.string(),
  /** ADR-0032 B4: card detail. Layovers are the gaps between consecutive segments' UTC times. Booking class and fare basis are never listed. */
  segments: z.array(Segment.pick({ marketing: true, operating: true, origin: true, destination: true, departure: true, arrival: true, cabin: true, aircraft: true }).extend({ carrierName: z.string().optional() })).optional(),
  /** ADR-0032 B5: the stored listing search and itinerary; the existing ITINERARY request flow takes them as they are. */
  offerRef: z.object({ searchId: Uuid, itineraryId: z.string() }).nullable().optional(),
  /** ADR-0031 I3: a REVIEW lane policy applies; a request goes to compliance review. */
  complianceReview: z.boolean().optional(),
})
export type FlightListingItem = z.infer<typeof FlightListingItem>
export const FlightListingsView = z.object({
  items: z.array(FlightListingItem),
  /** NO_SOURCES: no live adapter is enabled, or nothing has been fetched yet. The page offers "Ask our team" instead. */
  notice: z.literal("NO_SOURCES").nullable(),
})
export type FlightListingsView = z.infer<typeof FlightListingsView>
