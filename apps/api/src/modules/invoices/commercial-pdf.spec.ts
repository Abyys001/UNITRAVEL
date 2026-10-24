import { inflateSync } from "node:zlib"

import { DEFAULT_COMMERCIAL_DOCUMENTS } from "@unitravel/contracts"
import { describe, expect, it } from "vitest"

import { renderInvoicePdf, UNKNOWN_PARTICULAR } from "./commercial-pdf"

/** pdf-lib deflates its streams and writes standard-font text as hex strings, so inflate every stream and search for the hex of the text. */
const content = (pdf: Buffer) => {
  const raw = pdf.toString("latin1")
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => { try { return inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1") } catch { return "" } }).join("\n")
}
const hex = (s: string) => Buffer.from(s, "latin1").toString("hex").toUpperCase()
const input = (cfg = DEFAULT_COMMERCIAL_DOCUMENTS) => ({
  number: "INV-2026-000001", requestRef: "UT-C-7Q2K9M", issuedAt: new Date("2026-11-01T10:00:00Z"), expiresAt: new Date("2026-11-15T10:00:00Z"), paid: false, billTo: ["Leila Shipper"], currency: "GBP",
  lines: [{ description: "Freight (8 kg)", quantity: 1, unitAmountMinor: 3600, amountMinor: 3600 }], totalMinor: 3600, company: { name: "Uni Travel Ltd", email: "help@unitravel.example", phone: "+44 20 0000 0000" }, cfg, notes: [],
})

describe("invoice PDF (decision 5: particulars stay UNKNOWN)", () => {
  it("prints a clear placeholder for every unset particular and never invents one", async () => {
    const pdf = await renderInvoicePdf(input())
    expect(pdf.toString("latin1").startsWith("%PDF")).toBe(true)
    const bytes = content(pdf)
    expect(bytes).toContain(hex(UNKNOWN_PARTICULAR))
    expect(bytes).toContain(hex("INV-2026-000001"))
    expect(bytes).toContain(hex("GBP 36.00"))
  })

  it("prints the configured values instead once the accountant has answered", async () => {
    const bytes = content(await renderInvoicePdf(input({ ...DEFAULT_COMMERCIAL_DOCUMENTS, registrationNumber: "REG-TEST-1", vatNumber: "VAT-TEST-1", vatTreatment: "Outside the scope (test)", registeredAddress: "1 Test Street, London" })))
    for (const v of ["REG-TEST-1", "VAT-TEST-1", "Outside the scope (test)", "1 Test Street, London"]) expect(bytes).toContain(hex(v))
    expect(bytes).not.toContain(hex(UNKNOWN_PARTICULAR))
  })
})
