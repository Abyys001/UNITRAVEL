import { inflateSync } from "node:zlib"

import { DEFAULT_COMMERCIAL_DOCUMENTS } from "@unitravel/contracts"
import { describe, expect, it } from "vitest"

import { renderQuotationPdf } from "./commercial-pdf"
import { baggageText, conditionText, flightOptionSections, formatValidity, type QuotationOptionRow } from "./quotation-content"

const content = (pdf: Buffer) => [...pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => { try { return inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1") } catch { return "" } }).join("\n")
const hex = (s: string) => Buffer.from(s, "latin1").toString("hex").toUpperCase()

const en = { locale: "en", tz: "Europe/London", calendar: "GREGORIAN" } as const
const fa = { locale: "fa", tz: "Europe/London", calendar: "GREGORIAN" } as const
const seg = (n: string) => ({ marketing: { carrier: "BA", flightNumber: n }, origin: { iata: "LHR" }, destination: { iata: "IKA" }, departure: { local: "2026-11-01T10:00" } })
const option: QuotationOptionRow = {
  label: "Best", ticketingModel: "SINGLE_TICKET", itinerary: { slices: [{ segments: [seg("123"), seg("456")] }] },
  baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 2, kgPerPiece: 23 } }, cabin: { status: "UNKNOWN" } }],
  conditions: { change: { status: "KNOWN", value: { allowed: true, penalty: { amountMinor: 5000, currency: "GBP" } } }, refund: { status: "UNKNOWN" } },
  priceBreakdown: { fare: { amountMinor: 10000, currency: "GBP" }, taxes: { amountMinor: 2000, currency: "GBP" }, serviceFee: { amountMinor: 1000, currency: "GBP" }, total: { amountMinor: 13000, currency: "GBP" } },
}
const traveller = { passengerType: "ADT", nameSnapshot: { title: "MR", givenNames: "Reza", surname: "Karimi", nameFa: "رضا کریمی" } }
const base = { number: "QT-2026-000237", title: "Your travel options - UT-F-TEST", company: { name: "Uni Travel Ltd", email: "help@unitravel.example", phone: "+44 20 0000 0000" }, cfg: DEFAULT_COMMERCIAL_DOCUMENTS, footer: ["Footer"] }

describe("quotation content", () => {
  it("shows validity in the customer's zone with the zone named", () => {
    expect(formatValidity(new Date("2026-07-01T19:36:00Z"), en)).toBe("1 Jul 2026, 20:36 BST")
    expect(formatValidity(new Date("2026-12-01T19:36:00Z"), en)).toContain("GMT")
    expect(formatValidity(new Date("2026-07-01T19:36:00Z"), { ...en, tz: "Asia/Tehran" })).toContain("GMT+3:30")
  })

  it("keeps baggage and conditions tri-state: known values, or UNKNOWN, never inferred", () => {
    expect(baggageText([option.baggage as never][0]!, en)).toBe("2 × 23 kg")
    expect(baggageText([], en)).toMatch(/^UNKNOWN/)
    expect(baggageText([{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 0 } }, cabin: { status: "UNKNOWN" } }], en)).toBe("No checked bag included")
    expect(conditionText({ status: "KNOWN", value: { allowed: true, penalty: { amountMinor: 5000, currency: "GBP" } } }, en)).toContain("GBP 50.00")
    expect(conditionText({ status: "KNOWN", value: { allowed: false } }, en)).toBe("Not allowed")
    expect(conditionText({ status: "UNKNOWN" }, fa)).toMatch(/^نامشخص/)
  })

  it("lists travellers, per-segment baggage and conditions for every option", () => {
    const rows = flightOptionSections([option], [traveller], en)[0]!.rows!
    expect(rows).toContainEqual(["Traveller 1", "MR Reza KARIMI (Adult)"])
    expect(rows).toContainEqual(["Baggage BA123", "2 × 23 kg"])
    expect(rows.find(([k]) => k === "Baggage BA456")![1]).toMatch(/^UNKNOWN/)
    expect(rows.find(([k]) => k === "Refund before departure")![1]).toMatch(/^UNKNOWN/)
  })
})

describe("quotation PDF", () => {
  it("prints the zone label, traveller name and baggage line", async () => {
    const validity = formatValidity(new Date("2026-07-01T19:36:00Z"), en)
    const bytes = content(await renderQuotationPdf({ ...base, subtitle: `Valid until ${validity}`, sections: flightOptionSections([option], [traveller], en) }))
    for (const t of ["BST", "MR Reza KARIMI (Adult)", "2 x 23 kg", "Baggage BA123", "QT-2026-000237"]) expect(bytes).toContain(hex(t))
    expect(bytes).not.toContain(hex(" UTC"))
  })

  it("renders a Persian quotation with an embedded Persian font", async () => {
    const pdf = await renderQuotationPdf({ ...base, locale: "fa", subtitle: `اعتبار تا ${formatValidity(new Date("2026-07-01T19:36:00Z"), fa)}`, sections: flightOptionSections([option], [traveller], fa) })
    expect(pdf.toString("latin1").startsWith("%PDF")).toBe(true)
    expect(content(pdf)).toContain("Vazirmatn")
  })
})
