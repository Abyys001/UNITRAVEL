import { z } from "zod"

import { IsoDate, IsoDateTime, tri } from "./common"

// ADR-0015 §4.3: normalised models for hotels, stays, rail and bus. No provider is contracted, so no adapter exists and
// every vertical's flag stays off. Customer projections carry no amounts before a sent quote (ADR-0004, O8b), and
// supplier-sourced facts are tri-state: UNKNOWN stays UNKNOWN (rule 3).

export const ProviderVertical = z.enum(["FLIGHT", "STAY", "RAIL", "BUS"])
export type ProviderVertical = z.infer<typeof ProviderVertical>

export const StaySearchQuery = z
  .object({ location: z.string().trim().min(2).max(120), checkIn: IsoDate, checkOut: IsoDate, guests: z.number().int().min(1).max(20), rooms: z.number().int().min(1).max(10), kind: z.enum(["HOTEL", "STAY"]) })
  .refine((q) => q.checkOut > q.checkIn, { message: "Check-out must be after check-in", path: ["checkOut"] })
export type StaySearchQuery = z.infer<typeof StaySearchQuery>

export const StayOffer = z.object({
  provider: z.string(),
  providerOfferId: z.string(),
  kind: z.enum(["HOTEL", "STAY"]),
  name: z.string(),
  location: z.string(),
  checkIn: IsoDate,
  checkOut: IsoDate,
  roomDescription: tri(z.string()),
  board: tri(z.enum(["ROOM_ONLY", "BREAKFAST", "HALF_BOARD", "FULL_BOARD", "ALL_INCLUSIVE"])),
  refundable: tri(z.boolean()),
  fetchedAt: IsoDateTime,
})
export type StayOffer = z.infer<typeof StayOffer>

export const GroundSearchQuery = z.object({ mode: z.enum(["RAIL", "BUS"]), from: z.string().trim().min(2).max(120), to: z.string().trim().min(2).max(120), date: IsoDate, passengers: z.number().int().min(1).max(20) })
export type GroundSearchQuery = z.infer<typeof GroundSearchQuery>

export const GroundOffer = z.object({
  provider: z.string(),
  providerOfferId: z.string(),
  mode: z.enum(["RAIL", "BUS"]),
  operator: z.string(),
  from: z.string(),
  to: z.string(),
  departAt: IsoDateTime,
  arriveAt: IsoDateTime,
  fareClass: tri(z.string()),
  baggage: tri(z.string()),
  refundable: tri(z.boolean()),
  fetchedAt: IsoDateTime,
})
export type GroundOffer = z.infer<typeof GroundOffer>
