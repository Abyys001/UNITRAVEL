import type { ComboItem } from "@/components/form"
import { ALL_COUNTRIES, COUNTRIES, countryName, sortedCountries } from "@/lib/countries"

/**
 * Countries for a ComboField, searchable by the name in either language and the ISO code. With `popular` the
 * corridors Uni Travel serves come first as their own group.
 */
/** Names people still type for countries whose official short name changed or differs from everyday use. */
const ALIASES: Record<string, string[]> = {
  TR: ["Turkey", "ترکیه"], NL: ["Holland"], GB: ["UK", "Britain", "England", "Scotland", "Wales", "انگلیس", "انگلستان"],
  US: ["USA", "America", "آمریکا"], AE: ["UAE", "Emirates", "Dubai", "امارات", "دبی"], CZ: ["Czech Republic"], KR: ["South Korea"],
  RU: ["Russia"], MK: ["Macedonia"], SZ: ["Swaziland"], CI: ["Ivory Coast"], CV: ["Cape Verde"], MM: ["Burma"], DE: ["آلمان"],
}

export function countryItems(locale: string, opts: { exclude?: string[]; popular?: boolean } = {}): ComboItem[] {
  const skip = new Set(opts.exclude ?? [])
  const item = (c: string, group?: string): ComboItem => ({ value: c, label: countryName(c, locale), keywords: [c, countryName(c, "en"), countryName(c, "fa"), ...(ALIASES[c] ?? [])], group })
  if (!opts.popular) return sortedCountries(locale, ALL_COUNTRIES.filter((c) => !skip.has(c))).map((c) => item(c))
  const top = COUNTRIES.filter((c) => !skip.has(c))
  const rest = sortedCountries(locale, ALL_COUNTRIES.filter((c) => !skip.has(c) && !top.includes(c)))
  return [...top.map((c) => item(c, "popular")), ...rest.map((c) => item(c, "all"))]
}
