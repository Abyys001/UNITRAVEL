/**
 * Keys that must never appear anywhere in a customer-facing DTO (ch. 25.6, 32.2, ADR-0004), whatever the nesting.
 * Left out on purpose because a customer DTO legitimately carries them: `notes` (staff note on a direct invoice) and
 * the amount carriers `amountMinor`, `totalMinor`, `price`, `priceBreakdown`, `fare`, `taxes`, `penalty` (sent quotes,
 * invoices, indicative listings). Those are asserted per DTO in serialisers.spec.ts instead.
 */
export const FORBIDDEN_CUSTOMER_KEYS: readonly string[] = [
  "internalCostMinor", "internalNotes", "assigneeId", "assigneeName", "screening", "screeningScore", "riskScore", "complianceCase",
  "passportNumber", "documentNumberEnc", "supplierRaw", "createdBy", "customerUserId", "contactIdentityId", "costMinor", "supplierPrice",
  "supplierFetchedAt", "supplierExpiresAt", "priceAtSubmit", "priceRevalidated", "score", "explain",
  "priceLevel", "typicalPriceLow", "typicalPriceHigh", "typicalPriceRange", "bookingToken", "googleFlightsUrl", "bookingOptions",
  "bookingUrl", "totalPrice", "cheapestReturn", "priceNote", "fareMinor", "baseFare",
]

const FORBIDDEN_URL = /google\.com\/(travel|flights)/i

/** JSON paths (`$.a[0].b`) of forbidden keys (case-insensitive) and of strings pointing at Google Travel/Flights. */
export function findForbiddenKeys(value: unknown, extra: readonly string[] = []): string[] {
  const keys = new Set([...FORBIDDEN_CUSTOMER_KEYS, ...extra].map((k) => k.toLowerCase()))
  const walk = (v: unknown, path: string): string[] => {
    if (typeof v === "string") return FORBIDDEN_URL.test(v) ? [path] : []
    if (Array.isArray(v)) return v.flatMap((x, i) => walk(x, `${path}[${i}]`))
    if (v && typeof v === "object") {
      return Object.entries(v).flatMap(([k, x]) => [...(keys.has(k.toLowerCase()) ? [`${path}.${k}`] : []), ...walk(x, `${path}.${k}`)])
    }
    return []
  }
  return walk(value, "$")
}
