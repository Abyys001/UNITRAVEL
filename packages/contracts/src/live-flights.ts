import { z } from "zod"

import { IsoDateTime } from "./common"

// ADR-0027: aircraft in the air right now, from a public ADS-B source. These are observations, never offers: nothing here
// has a price, availability or booking link, and no origin or destination is inferred from a callsign.

export const LIVE_FLIGHT_REGIONS = ["EUROPE", "TURKEY", "UAE", "IRAN"] as const
export const LiveFlightRegion = z.enum(LIVE_FLIGHT_REGIONS)
export type LiveFlightRegion = z.infer<typeof LiveFlightRegion>

export const LiveFlightItem = z.object({
  label: z.literal("LIVE_POSITION"),
  /** ICAO transponder address, the only identifier that stays stable across overlapping source areas. */
  hex: z.string().regex(/^[0-9a-f]{6}$/),
  callsign: z.string().regex(/^[A-Z]{3}[0-9][A-Z0-9]{0,3}$/),
  aircraftType: z.string().max(8).nullable(),
  region: LiveFlightRegion,
  altitudeFt: z.number().int(),
  groundSpeedKt: z.number().int().min(0).nullable(),
  /** When the source last received this aircraft's position. */
  seenAt: IsoDateTime,
})
export type LiveFlightItem = z.infer<typeof LiveFlightItem>

export const LiveFlightsQuery = z.object({
  region: LiveFlightRegion.optional(),
  /** Start of a callsign, for example THY or BAW12. */
  q: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,7}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})
export type LiveFlightsQuery = z.infer<typeof LiveFlightsQuery>

export const LiveFlightsView = z.object({
  items: z.array(LiveFlightItem),
  /** Matches before `limit`. */
  total: z.number().int().min(0),
  /** Aircraft per region, ignoring the region and callsign filters. */
  regions: z.object({ EUROPE: z.number().int().min(0), TURKEY: z.number().int().min(0), UAE: z.number().int().min(0), IRAN: z.number().int().min(0) }),
  /** Newest fetch from the source; null when nothing is held. */
  updatedAt: IsoDateTime.nullable(),
  /** OFF: the source is switched off here. NO_DATA: switched on but nothing fresh is held. */
  notice: z.enum(["OFF", "NO_DATA"]).nullable(),
})
export type LiveFlightsView = z.infer<typeof LiveFlightsView>
