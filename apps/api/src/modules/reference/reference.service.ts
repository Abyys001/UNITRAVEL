import { Inject, Injectable, type OnModuleInit } from "@nestjs/common"

import type { LocationSuggestion } from "@unitravel/contracts"
import { airlines, airports, cities, countries, type Db } from "@unitravel/db"
import type { AirportRef, ReferenceLookup } from "@unitravel/engine"

import { DB } from "../../core/infra.module"

type Airport = typeof airports.$inferSelect
type City = typeof cities.$inferSelect
type Airline = typeof airlines.$inferSelect

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ")

/** Airports (with mandatory IANA zones), cities, countries and airlines, held in memory (ch. 20.1 reference). */
@Injectable()
export class ReferenceService implements OnModuleInit {
  private airportsByIata = new Map<string, Airport>()
  private cityByCode = new Map<string, City>()
  private regionsByCountry = new Map<string, string[]>()
  private countryNames = new Map<string, { en: string; fa: string }>()
  private airlinesByCode = new Map<string, Airline>()

  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit() {
    await this.reload()
  }

  async reload() {
    const [a, c, k, l] = await Promise.all([this.db.select().from(airports), this.db.select().from(cities), this.db.select().from(countries), this.db.select().from(airlines)])
    this.airportsByIata = new Map(a.filter((x) => x.active && x.tz).map((x) => [x.iata, x]))
    this.cityByCode = new Map(c.map((x) => [x.code, x]))
    this.regionsByCountry = new Map(k.map((x) => [x.code, x.regionTags]))
    this.countryNames = new Map(k.map((x) => [x.code, { en: x.nameEn, fa: x.nameFa }]))
    this.airlinesByCode = new Map(l.map((x) => [x.iata, x]))
  }

  airport(iata: string): Airport | undefined {
    return this.airportsByIata.get(iata)
  }

  airline(code: string): Airline | undefined {
    return this.airlinesByCode.get(code)
  }

  airlinesInCountry(country: string): string[] {
    return [...this.airlinesByCode.values()].filter((a) => a.country === country).map((a) => a.iata)
  }

  countryName(code: string, locale: "en" | "fa") {
    return this.countryNames.get(code)?.[locale] ?? code
  }

  placeName(code: string, locale: "en" | "fa"): string {
    const city = this.cityByCode.get(code)
    if (city) return locale === "fa" ? city.nameFa : city.nameEn
    const a = this.airportsByIata.get(code)
    return a ? (locale === "fa" ? a.nameFa : a.nameEn) : code
  }

  cityName(iata: string, locale: "en" | "fa"): string {
    const a = this.airportsByIata.get(iata)
    const city = a?.cityCode ? this.cityByCode.get(a.cityCode) : undefined
    return city ? (locale === "fa" ? city.nameFa : city.nameEn) : this.placeName(iata, locale)
  }

  /** The engine's view of reference data (it performs no I/O itself). */
  lookup(): ReferenceLookup {
    return {
      airport: (iata) => {
        const a = this.airportsByIata.get(iata)
        if (!a) return undefined
        const ref: AirportRef = { iata: a.iata, country: a.country, tz: a.tz, cityCode: a.cityCode, regions: this.regionsByCountry.get(a.country) ?? [a.country], nameEn: a.nameEn, nameFa: a.nameFa }
        return ref
      },
      cityAirports: (code) => [...this.airportsByIata.values()].filter((a) => a.cityCode === code || a.metroCode === code).map((a) => a.iata),
    }
  }

  /** Autocomplete in English and Persian: "Tehran — all airports" first, then airports (ch. 11.3). */
  suggest(q: string, limit = 10): LocationSuggestion[] {
    const needle = fold(q.trim())
    if (!needle) return []
    const out: LocationSuggestion[] = []
    for (const c of this.cityByCode.values()) {
      const airportsInCity = [...this.airportsByIata.values()].filter((a) => a.cityCode === c.code)
      if (airportsInCity.length < 2) continue
      if (c.code.toLowerCase() === needle || fold(c.nameEn).startsWith(needle) || fold(c.nameFa).includes(needle)) {
        out.push({ kind: "CITY", code: c.code, nameEn: `${c.nameEn} — all airports`, nameFa: `${c.nameFa} — همهٔ فرودگاه‌ها`, country: c.country, airports: airportsInCity.map((a) => a.iata) })
      }
    }
    const scored: [number, Airport][] = []
    for (const a of this.airportsByIata.values()) {
      const city = a.cityCode ? this.cityByCode.get(a.cityCode) : undefined
      let s = 0
      if (a.iata.toLowerCase() === needle) s = 100
      else if (fold(a.nameEn).startsWith(needle) || (city && fold(city.nameEn).startsWith(needle))) s = 60
      else if (fold(a.nameFa).includes(needle) || (city && fold(city.nameFa).includes(needle))) s = 50
      else if (fold(a.nameEn).includes(needle)) s = 30
      if (s > 0) scored.push([s, a])
    }
    scored.sort((x, y) => y[0] - x[0] || x[1].nameEn.localeCompare(y[1].nameEn))
    for (const [, a] of scored) out.push({ kind: "AIRPORT", code: a.iata, nameEn: a.nameEn, nameFa: a.nameFa, country: a.country, cityCode: a.cityCode ?? undefined })
    return out.slice(0, limit)
  }
}
