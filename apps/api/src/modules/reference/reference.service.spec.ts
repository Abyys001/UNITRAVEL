import { airlines, airports, cities, countries, type Db } from "@unitravel/db"
import { describe, expect, it } from "vitest"

import { ReferenceService } from "./reference.service"

const ap = (iata: string, nameEn: string, cityCode: string | null, country: string, extra: Partial<{ active: boolean; tz: string }> = {}) => ({ iata, nameEn, nameFa: nameEn, cityCode, metroCode: null, country, tz: "UTC", active: true, ...extra })
const rows = new Map<unknown, unknown[]>([
  [airports, [ap("LHR", "London Heathrow", "LON", "GB"), ap("LGW", "London Gatwick", "LON", "GB"), ap("MHD", "Mashhad", "MHD", "IR"), ap("DXB", "Dubai", null, "AE"), ap("XXX", "Closed", "LON", "GB", { active: false })]],
  [cities, [{ code: "LON", nameEn: "London", nameFa: "لندن", country: "GB" }, { code: "MHD", nameEn: "Mashhad", nameFa: "مشهد", country: "IR" }, { code: "PAR", nameEn: "Paris", nameFa: "پاریس", country: "FR" }]],
  [countries, [{ code: "GB", nameEn: "United Kingdom", nameFa: "بریتانیا", regionTags: [] }, { code: "IR", nameEn: "Iran", nameFa: "ایران", regionTags: [] }, { code: "AE", nameEn: "United Arab Emirates", nameFa: "امارات", regionTags: [] }]],
  [airlines, []],
])
const db = { select: () => ({ from: (t: unknown) => Promise.resolve(rows.get(t) ?? []) }) } as unknown as Db

describe("ReferenceService.destinations", () => {
  it("lists only places with an active airport: multi-airport cities as CITY, others as their airport", async () => {
    const ref = new ReferenceService(db)
    await ref.reload()
    const list = ref.destinations()
    expect(list.map((d) => [d.kind, d.code, d.nameEn, d.airports.map((a) => a.iata)])).toEqual([
      ["AIRPORT", "MHD", "Mashhad", ["MHD"]],
      ["AIRPORT", "DXB", "Dubai", ["DXB"]],
      ["CITY", "LON", "London", ["LGW", "LHR"]],
    ])
    expect(list[2]).toMatchObject({ country: "GB", countryNameEn: "United Kingdom", countryNameFa: "بریتانیا" })
  })
})
