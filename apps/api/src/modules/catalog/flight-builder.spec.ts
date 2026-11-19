import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { PublicFare } from "@unitravel/contracts"

import { findForbiddenKeys } from "../../testing/leak"
import { FlightBuilderService } from "./flight-builder.service"

const SETTINGS = { enabled: true, panelUrl: "https://panel.example.com", syncMode: "DISABLED", syncInterval: "DAILY", freshHours: 6, staleHours: 24, deadlineWarnHours: 48 } as const
const NOW = new Date("2026-11-19T12:00:00Z")

/** A fare row as stored, with price-like and credential-like junk riding in every JSON column (a bad import or a future bug). */
const contaminated = () => ({
  id: "3e9d4c0b-6f40-4c0d-8e5b-8a7f6e5d4c31", resultId: "3e9d4c0b-6f40-4c0d-8e5b-8a7f6e5d4c32", position: 0, cabin: "ECONOMY", bookingClasses: ["Y"], seatsRaw: ["9"], fareBasis: ["YOWIR"],
  fareType: "NEGO", fareTypeRaw: "NEGO", baseMinor: 20000, taxesMinor: 1345, totalMinor: 21345, currency: "EUR", status: "LIVE", observedAt: new Date("2026-11-19T10:00:00Z"), ticketingDeadline: "2026-11-30",
  baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "UNKNOWN" }, cabin: { status: "UNKNOWN" }, sourceText: "panel text", totalMinor: 1, username: "u" }],
  conditions: {
    change: { state: "KNOWN_ALLOWED", penaltyMinor: 7777, sourceText: "x", staffFare: { totalMinor: 1 } }, refund: { state: "UNKNOWN", password: "p" },
    rulesText: "RULE-TEXT-SECRET", confirmedBy: "staff", confirmedAt: "2026-11-19T10:00:00Z", panelUrl: "https://panel.example.com",
  },
}) as never

describe("customer fares (ADR-0037, ADR-0004)", () => {
  const svc = new FlightBuilderService(...(Array(6).fill(null) as [never, never, never, never, never, never]))

  it("publicFareOf drops every price, fare type, basis, rules text and credential, even from contaminated rows", () => {
    const pub = svc.publicFareOf(contaminated(), SETTINGS as never, NOW)
    expect(PublicFare.strict().safeParse(pub).success).toBe(true)
    expect(findForbiddenKeys(pub)).toEqual([])
    expect(JSON.stringify(pub)).not.toMatch(/21345|20000|1345|7777|RULE-TEXT|YOWIR|NEGO|panel\.example|password|username|staffFare|Minor|penalty|currency|EUR/i)
    expect(pub.conditions).toEqual({ change: { state: "KNOWN_ALLOWED" }, refund: { state: "UNKNOWN" } })
    expect(pub.seats).toEqual([{ raw: "9", count: null, atCap: true }])
  })

  it("the staff view without pricing.read.internal drops price and penalty amounts but the priced view keeps them", () => {
    const noPrice = svc.staffFareNoPrice(contaminated(), SETTINGS as never, NOW)
    expect(JSON.stringify(noPrice)).not.toMatch(/21345|7777|totalMinor|penaltyMinor/)
    const priced = svc.staffFare(contaminated(), SETTINGS as never, NOW)
    expect(priced.totalMinor).toBe(21345)
  })
})

describe("no automated Flight Builder access exists (ADR-0037)", () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith(".ts") && !p.endsWith(".spec.ts") && !p.endsWith(".e2e.ts")) files.push(p)
    }
  }
  walk(join(__dirname, "..", ".."))

  it("scans a meaningful number of source files", () => expect(files.length).toBeGreaterThan(100))

  it("no source file mentions airquest or builds a Flight Builder HTTP client", () => {
    const offenders = files.filter((f) => /airquest/i.test(readFileSync(f, "utf8")))
    expect(offenders).toEqual([])
    const clients = files.filter((f) => /(fetch|axios|got|request|http\.get|https\.get)\s*\([^)]*flight[-_ ]?builder/i.test(readFileSync(f, "utf8")))
    expect(clients).toEqual([])
  })

  it("nothing fetches the settings panelUrl: it is stored and displayed, never called", () => {
    const users = files.filter((f) => /panelUrl/.test(readFileSync(f, "utf8")))
    for (const f of users) {
      const src = readFileSync(f, "utf8")
      expect({ f, calls: /(fetch|axios|http\.get|https\.get|http\.request|https\.request|undici|\.request)\s*\(/.test(src) }).toEqual({ f, calls: false })
    }
    expect(users.length).toBeGreaterThan(0)
  })

  it("no Flight Builder module imports an HTTP client", () => {
    const fbFiles = files.filter((f) => /flight-builder/.test(f))
    expect(fbFiles.length).toBeGreaterThan(3)
    for (const f of fbFiles) expect({ f, http: /from "(axios|undici|got|node-fetch|node:https?|https?)"|globalThis\.fetch|\bfetch\(/.test(readFileSync(f, "utf8")) }).toEqual({ f, http: false })
  })
})
