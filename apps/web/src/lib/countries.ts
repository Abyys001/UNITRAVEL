/** Countries offered in forms: the corridors Uni Travel serves (ISO 3166-1 alpha-2). Names come from Intl in the UI language. */
export const COUNTRIES = ["IR", "GB", "TR", "AM", "DE", "NL", "FR", "AT", "IQ", "AE", "AF", "US", "CA"]

const names = new Map<string, Intl.DisplayNames>()

/** Country name in the UI locale; falls back to the code when ICU has no name for it. */
export function countryName(code: string, locale: string): string {
  try {
    let dn = names.get(locale)
    if (!dn) names.set(locale, (dn = new Intl.DisplayNames(locale, { type: "region" })))
    return dn.of(code) ?? code
  } catch {
    return code
  }
}
