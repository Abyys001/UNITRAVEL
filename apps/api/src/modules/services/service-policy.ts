import type { ServiceRequestType } from "@unitravel/contracts"

/**
 * SERVICE compliance policies are data keyed `<TYPE>:<context>` (ADR-0015). This lists the keys that apply to one request;
 * the policies themselves (BLOCK or REVIEW) are looked up by ComplianceService and nothing here decides an outcome.
 *
 * Context rules (decisions recorded in ADR-0015):
 * - every type: `<TYPE>:*`, a wildcard row an officer can add to hold or stop the whole service;
 * - CIP: the airport (`CIP:IKA`);
 * - VISA: the destination country (`VISA:TR`);
 * - INSURANCE: the customer's country of residence from the profile address, and `IR` as well when the contact phone is
 *   +98. Either signal alone is enough, so a customer living in Iran who gave a UK address is still caught by the +98 phone
 *   and a +98 number that moved abroad is caught by the address.
 */
export function servicePolicyKeys(type: ServiceRequestType, details: Record<string, unknown>, who: { residenceCountry: string | null; contactPhone: string }): string[] {
  const keys = [`${type}:*`]
  if (type === "CIP" && typeof details.airport === "string") keys.push(`CIP:${details.airport}`)
  if (type === "VISA" && typeof details.destinationCountry === "string") keys.push(`VISA:${details.destinationCountry}`)
  if (type === "INSURANCE") {
    if (who.residenceCountry) keys.push(`INSURANCE:${who.residenceCountry.toUpperCase()}`)
    if (who.contactPhone.startsWith("+98")) keys.push("INSURANCE:IR")
  }
  return [...new Set(keys)]
}
