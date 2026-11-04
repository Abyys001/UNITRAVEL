import { describe, expect, it } from "vitest"

import type { SearchQuery } from "@unitravel/contracts"

import { demandRoute } from "./requests.service"

const q = (from: object, to: object) => ({ tripType: "ONE_WAY", slices: [{ from, to, date: "2026-11-20", flexDays: 0 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", preferences: {} }) as unknown as SearchQuery

describe("catalog demand from a submitted request (ADR-0034)", () => {
  it("takes the first slice's places as typed (city or airport) and its date", () => {
    expect(demandRoute(q({ city: "THR" }, { city: "LON" }))).toEqual({ from: "THR", to: "LON", date: "2026-11-20" })
    expect(demandRoute(q({ airport: "IST" }, { airport: "LHR" }))).toEqual({ from: "IST", to: "LHR", date: "2026-11-20" })
  })
})
