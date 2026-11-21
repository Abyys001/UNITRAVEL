import { type MessageKey, translate } from "@unitravel/i18n"

import { GROUND_CITIES } from "./ground-places"

export type StayRegion = "heritage" | "city" | "north" | "gulf" | "mountain"
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

export const STAY_REGIONS: StayRegion[] = ["heritage", "city", "north", "gulf", "mountain"]

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

/** Picker groups: the featured regions plus a catch-all for towns that are only in the sourced ground list. */
export type StayGroup = StayRegion | "other"
export interface StayDestination { id: string; en: string; fa: string; group: StayGroup; featured: boolean }

const d = (id: string, en: string, fa: string, group: StayGroup): Omit<StayDestination, "featured"> => ({ id, en, fa, group })

/**
 * Holiday and villa areas that customers ask for but that have no rail or bus terminal entry. Names follow the
 * provinces' own spellings; provenance in docs/reference-data.md, "Villa destinations". A place here is something a
 * customer can ask about, never stock (rule 2).
 */
const HOLIDAY_PLACES = [
  // Caspian coast and Alborz north slopes
  d("chalus", "Chalus", "چالوس", "north"), d("nowshahr", "Nowshahr", "نوشهر", "north"), d("kelardasht", "Kelardasht", "کلاردشت", "north"),
  d("tonekabon", "Tonekabon", "تنکابن", "north"), d("abbasabad", "Abbasabad", "عباس‌آباد", "north"), d("nur", "Nur", "نور", "north"),
  d("mahmudabad", "Mahmudabad", "محمودآباد", "north"), d("babolsar", "Babolsar", "بابلسر", "north"), d("fereydunkenar", "Fereydunkenar", "فریدونکنار", "north"),
  d("amol", "Amol", "آمل", "north"), d("behshahr", "Behshahr", "بهشهر", "north"), d("lahijan", "Lahijan", "لاهیجان", "north"),
  d("bandar-anzali", "Bandar Anzali", "بندر انزلی", "north"), d("astara", "Astara", "آستارا", "north"), d("talesh", "Talesh", "تالش", "north"),
  d("fuman", "Fuman", "فومن", "north"), d("rudsar", "Rudsar", "رودسر", "north"), d("langarud", "Langarud", "لنگرود", "north"),
  d("namakabrud", "Namakabrud", "نمک‌آبرود", "north"),
  // Persian Gulf and Sea of Oman
  d("hormuz", "Hormuz Island", "جزیرهٔ هرمز", "gulf"), d("chabahar", "Chabahar", "چابهار", "gulf"), d("bandar-lengeh", "Bandar Lengeh", "بندر لنگه", "gulf"),
  // Mountains, ski areas and countryside close to Tehran and the north-west
  d("lavasan", "Lavasan", "لواسان", "mountain"), d("damavand", "Damavand", "دماوند", "mountain"), d("shemshak", "Shemshak", "شمشک", "mountain"),
  d("dizin", "Dizin", "دیزین", "mountain"), d("sarein", "Sarein", "سرعین", "mountain"), d("kandovan", "Kandovan", "کندوان", "mountain"),
  // Historic towns and villages
  d("abyaneh", "Abyaneh", "ابیانه", "heritage"), d("naein", "Naein", "نائین", "heritage"),
]

/** Ground-list cities that fit a featured region better than "other". */
const GROUND_GROUP: Record<string, StayGroup> = {
  tehran: "city", mashhad: "city", tabriz: "city", ahvaz: "city", qom: "city", karaj: "city", urmia: "city", arak: "city", zahedan: "city",
  isfahan: "heritage", shiraz: "heritage", yazd: "heritage", kashan: "heritage", kerman: "heritage", kermanshah: "heritage", shushtar: "heritage",
  hamedan: "heritage", qazvin: "heritage", meybod: "heritage", ardakan: "heritage", bam: "heritage", zanjan: "heritage", ardabil: "heritage",
  rasht: "north", sari: "north", gorgan: "north", ramsar: "north", "qaem-shahr": "north",
  "bandar-abbas": "gulf", bushehr: "gulf", firuzkuh: "mountain",
}

const featuredSlugs = new Set<string>(STAY_CITIES.map((c) => c.slug))

/**
 * Everything the villa picker offers: the featured cities, every Iranian city in the sourced train and bus lists, and the
 * holiday places above. De-duplicated by id; featured cities take their names from the catalogue so the two never differ.
 */
export const STAY_DESTINATIONS: readonly StayDestination[] = (() => {
  const byId = new Map<string, StayDestination>()
  for (const c of STAY_CITIES) {
    byId.set(c.slug, { id: c.slug, en: translate("en", cityKey(c, "name")), fa: translate("fa", cityKey(c, "name")), group: c.region, featured: true })
  }
  const ground = [...GROUND_CITIES.TRAIN.popular, ...GROUND_CITIES.TRAIN.other, ...GROUND_CITIES.BUS.popular, ...GROUND_CITIES.BUS.other]
  for (const g of ground) if (!byId.has(g.id)) byId.set(g.id, { ...g, group: GROUND_GROUP[g.id] ?? "other", featured: false })
  for (const h of HOLIDAY_PLACES) if (!byId.has(h.id)) byId.set(h.id, { ...h, featured: featuredSlugs.has(h.id) })
  return [...byId.values()]
})()

export const STAY_GROUPS: readonly StayGroup[] = ["north", "gulf", "heritage", "mountain", "city", "other"]

export const destinationMatches = (dst: StayDestination, query: string) => {
  const q = fold(query)
  return !q || fold(dst.en).includes(q) || fold(dst.fa).includes(q) || dst.id.includes(q)
}
