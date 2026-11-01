import { type MessageKey, translate } from "@unitravel/i18n"

export type StayRegion = "heritage" | "city" | "north" | "gulf"
export interface StayCity { slug: "tehran" | "isfahan" | "shiraz" | "yazd" | "kashan" | "tabriz" | "mashhad" | "kerman" | "kermanshah" | "shushtar" | "kish" | "qeshm" | "ramsar" | "masuleh"; region: StayRegion; photo: string }

const iran = (slug: string) => `/media/photos/iran/${slug}`

/**
 * Places a customer can ask about, not stock: nothing here implies availability, a host or a price (rule 2). Real offers
 * are the staff-curated listings (ADR-0021). Sources for the photos are in public/media/CREDITS.md.
 */
export const STAY_CITIES: StayCity[] = [
  { slug: "isfahan", region: "heritage", photo: iran("isfahan") },
  { slug: "shiraz", region: "heritage", photo: iran("shiraz") },
  { slug: "tehran", region: "city", photo: "/media/photos/tehran" },
  { slug: "kish", region: "gulf", photo: iran("kish") },
  { slug: "yazd", region: "heritage", photo: iran("yazd") },
  { slug: "ramsar", region: "north", photo: iran("ramsar") },
  { slug: "mashhad", region: "city", photo: iran("mashhad") },
  { slug: "kashan", region: "heritage", photo: iran("kashan") },
  { slug: "qeshm", region: "gulf", photo: iran("qeshm") },
  { slug: "tabriz", region: "city", photo: iran("tabriz") },
  { slug: "masuleh", region: "north", photo: iran("masuleh") },
  { slug: "kerman", region: "heritage", photo: iran("kerman") },
  { slug: "shushtar", region: "heritage", photo: iran("shushtar") },
  { slug: "kermanshah", region: "heritage", photo: iran("kermanshah") },
]

export const STAY_REGIONS: StayRegion[] = ["heritage", "city", "north", "gulf"]

export const cityKey = (c: StayCity, field: "name" | "blurb") => `stays.cities.${c.slug}.${field}` as MessageKey

/** Lower-cased, with Arabic keyboard letters folded to Persian ones so "اصفهان" and "ي/ك" spellings match. */
export const fold = (s: string) => s.trim().toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک")

const cityNames = (c: StayCity) => [translate("en", cityKey(c, "name")), translate("fa", cityKey(c, "name"))].map(fold)

/** The city a staff-entered place belongs to, in either language; staff may write "Tabriz" or "تبریز, باغمیشه". */
export const cityOfPlace = (place: string) => STAY_CITIES.find((c) => cityNames(c).some((n) => fold(place).includes(n)))

export const cityMatches = (c: StayCity, query: string) => {
  const q = fold(query)
  if (!q) return true
  return [...cityNames(c), fold(translate("en", cityKey(c, "blurb"))), fold(translate("fa", cityKey(c, "blurb")))].some((s) => s.includes(q))
}
