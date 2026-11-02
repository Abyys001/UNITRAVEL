/**
 * SYNTHETIC fixtures for the Apify actor `lergassy~google-flights-scraper`, built from the field list in the actor README
 * (DOCUMENTED, checked 2 Nov 2026). They are NOT recorded runs: every value is invented. Replace with recorded output
 * after the manual smoke test (ADR-0029 A9; `maxTotalChargeUsd=0.02`). Never put a real token or booking token here.
 */

export const START_RESPONSE = { data: { id: "runSYNTH0001", defaultDatasetId: "dsSYNTH0001", status: "READY" } }
export const RUNNING_RESPONSE = { data: { id: "runSYNTH0001", defaultDatasetId: "dsSYNTH0001", status: "RUNNING" } }
export const SUCCEEDED_RESPONSE = { data: { id: "runSYNTH0001", defaultDatasetId: "dsSYNTH0001", status: "SUCCEEDED" } }
export const LIMITS_RESPONSE = { data: { monthlyUsageCycle: { startAt: "2026-11-01T00:00:00.000Z", endAt: "2026-11-30T23:59:59.999Z" }, limits: { maxMonthlyUsageUsd: 5 }, current: { monthlyUsageUsd: 0.42 } } }
export const TOKEN_INVALID = { error: { type: "user-or-token-not-found", message: "User was not found or authentication token is not valid" } }

/** IST -> LHR direct, one passenger, economy. Local times carry no zone. */
export const DIRECT = {
  type: "flight", origin: "IST", destination: "LHR", departureDate: "2026-12-10", cabinClass: "economy", airline: "Turkish Airlines", airlineCodes: ["TK"], flightNumbers: ["TK1979"], stops: 0, layovers: [],
  departAirport: "IST", departAt: "2026-12-10T08:40", arriveAt: "2026-12-10T10:55", totalDurationMinutes: 255,
  legs: [{ flightNumber: "TK1979", airline: "Turkish Airlines", airlineCode: "TK", operatedBy: null, from: "IST", to: "LHR", departAt: "2026-12-10T08:40", arriveAt: "2026-12-10T10:55", durationMinutes: 255, aircraft: "Airbus A321", legroom: "30 in", emissionsKg: 180 }],
  emissionsKg: 180, price: 231, currency: "GBP", priceUnavailable: false, priceLevel: "low", typicalPriceLow: 210, typicalPriceHigh: 340, bookingToken: "SYNTHETIC-TOKEN-DIRECT", googleFlightsUrl: "https://www.google.com/travel/flights?synthetic=direct",
}

/** VAN -> LHR with one stop in IST. */
export const ONE_STOP = {
  type: "flight", origin: "VAN", destination: "LHR", departureDate: "2026-12-10", cabinClass: "economy", airline: "Turkish Airlines", airlineCodes: ["TK"], flightNumbers: ["TK2573", "TK1979"], stops: 1,
  layovers: [{ airport: "IST", city: "Istanbul", durationMinutes: 185 }], departAirport: "VAN", departAt: "2026-12-10T05:20", arriveAt: "2026-12-10T10:55", totalDurationMinutes: 485,
  legs: [
    { flightNumber: "TK2573", airline: "Turkish Airlines", airlineCode: "TK", operatedBy: null, from: "VAN", to: "IST", departAt: "2026-12-10T05:20", arriveAt: "2026-12-10T07:35", durationMinutes: 135, aircraft: "Boeing 737", legroom: "29 in", emissionsKg: 120 },
    { flightNumber: "TK1979", airline: "Turkish Airlines", airlineCode: "TK", operatedBy: null, from: "IST", to: "LHR", departAt: "2026-12-10T08:40", arriveAt: "2026-12-10T10:55", durationMinutes: 255, aircraft: "Airbus A321", legroom: "30 in", emissionsKg: 180 },
  ],
  emissionsKg: 300, price: 198.5, currency: "GBP", priceUnavailable: false, priceLevel: "typical", typicalPriceLow: 190, typicalPriceHigh: 320, bookingToken: "SYNTHETIC-TOKEN-ONESTOP", googleFlightsUrl: "https://www.google.com/travel/flights?synthetic=onestop",
}

/** Google lists the itinerary but not a price: never turned into an offer, kept in the run log. */
export const PRICE_UNAVAILABLE = { ...DIRECT, flightNumbers: ["PC1261"], airline: "Pegasus", airlineCodes: ["PC"], departAt: "2026-12-10T13:10", arriveAt: "2026-12-10T15:20", price: null, priceUnavailable: true, priceLevel: null, typicalPriceLow: null, typicalPriceHigh: null, bookingToken: null, googleFlightsUrl: null,
  legs: [{ ...DIRECT.legs[0]!, flightNumber: "PC1261", airline: "Pegasus", airlineCode: "PC", departAt: "2026-12-10T13:10", arriveAt: "2026-12-10T15:20" }] }

/** The airport is not in our reference data, so the row is dropped and logged (ADR-0029 A4). */
export const UNKNOWN_AIRPORT = { ...DIRECT, flightNumbers: ["XX100"], origin: "ZZZ", departAirport: "ZZZ", legs: [{ ...DIRECT.legs[0]!, flightNumber: "XX100", from: "ZZZ" }] }

export const NOTICE = { type: "notice", message: "Fewer results than requested: Google returned 2 itineraries." }
export const ERROR_ROW = { type: "error", message: "Route VAN-XXX: no results" }
export const CALENDAR_DAY = { type: "calendar_day", date: "2026-12-11", price: 190, currency: "GBP" }
export const SEARCH_ROW = { type: "search", query: { origin: "IST", destination: "LHR" } }

/** Mixed dataset as the actor returns it for a two-route run. */
export const MIXED_DATASET = [DIRECT, ONE_STOP, PRICE_UNAVAILABLE, UNKNOWN_AIRPORT, NOTICE, ERROR_ROW, CALENDAR_DAY, SEARCH_ROW]

/** Iran origin, used to check the lane policy (ADR-0029 A10). TK879 is a Turkish Airlines flight, so the carrier BLOCK does not apply. */
export const IKA_IST = {
  ...DIRECT, origin: "IKA", destination: "IST", departAirport: "IKA", flightNumbers: ["TK879"], departAt: "2026-12-10T03:05", arriveAt: "2026-12-10T05:55", totalDurationMinutes: 230, price: 140, bookingToken: "SYNTHETIC-TOKEN-IKA",
  legs: [{ ...DIRECT.legs[0]!, flightNumber: "TK879", from: "IKA", to: "IST", departAt: "2026-12-10T03:05", arriveAt: "2026-12-10T05:55", durationMinutes: 230 }],
}
