import type { PassengerType } from "@unitravel/contracts"

/** Whole years between a date of birth and a local date (both YYYY-MM-DD). */
export function ageOn(dateOfBirth: string, onLocalDate: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number) as [number, number, number]
  const [y, m, d] = onLocalDate.split("-").map(Number) as [number, number, number]
  let age = y - by
  if (m < bm || (m === bm && d < bd)) age -= 1
  return age
}

/**
 * Passenger type for one segment (ch. 12.4): ages are computed against the local date of each segment, so an
 * infant who turns two mid-journey is a child on the return. Adults are 12+ on the date of the last flight.
 */
export function passengerTypeOn(dateOfBirth: string, segmentLocalDate: string, wantsSeat = false): PassengerType {
  const age = ageOn(dateOfBirth, segmentLocalDate)
  if (age < 2) return wantsSeat ? "INS" : "INF"
  if (age < 12) return "CHD"
  return "ADT"
}

export function validatePassengerMix(types: PassengerType[]): string[] {
  const issues: string[] = []
  const adults = types.filter((t) => t === "ADT" || t === "YTH" || t === "STU").length
  const lap = types.filter((t) => t === "INF").length
  if (types.length > 9) issues.push("At most 9 passengers per request")
  if (adults === 0) issues.push("At least one adult is required; unaccompanied minors are handled as manual requests")
  if (lap > adults) issues.push("At most one lap infant per adult")
  return issues
}
