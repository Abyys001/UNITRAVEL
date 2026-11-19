import { DEFAULT_SETTINGS } from "@unitravel/contracts"
import type { TicketCover } from "@unitravel/db"
import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"

import { DEFAULT_TICKET, makeTicketPdf, symbolPayloads } from "../../../test/fixtures/ticket-pdf"
import { buildBrandedPdf } from "./branded-pdf"
import { decodePdf, inspectPdf, renderCodeCrop, verifyWrapper } from "./code-integrity"

const cover = (locale: "en" | "fa" = "en"): TicketCover => ({
  pnr: DEFAULT_TICKET.pnr, customerName: "Neda Rezaei", notes: "Check-in closes 60 minutes before departure.", locale,
  passengers: [{ travellerId: "00000000-0000-4000-8000-000000000001", name: "REZAEI/NEDA MS", ticketNumber: DEFAULT_TICKET.passengers[0]!.ticketNumber }],
  segments: [{ carrier: "TK", flightNumber: "1980", origin: "LHR", destination: "IST", departureLocal: "2026-12-14T11:35", departureUtc: "2026-12-14T11:35:00Z", arrivalLocal: "2026-12-14T17:40", arrivalUtc: "2026-12-14T14:40:00Z" }],
})
const b64 = (s: string) => Buffer.from(s, "latin1").toString("base64")
const build = (original: Buffer, mode: "FULL" | "COVER_ONLY", locale: "en" | "fa" = "en") =>
  buildBrandedPdf({ original, originalFilename: "provider ticket.pdf", mode, kind: "BOARDING_PASS", requestRef: "UT-F-ABC234", cover: cover(locale), company: DEFAULT_SETTINGS.company, logo: null, issuedOn: "2026-11-19" })

describe("code integrity (ADR-0038 D4)", { timeout: 60_000 }, () => {
  it("decodes QR, PDF417 and Code 128 from a provider PDF with their exact payload bytes", async () => {
    const pdf = await makeTicketPdf()
    const p = symbolPayloads()
    const r = await decodePdf(pdf)
    expect(r.pages).toBe(1)
    expect(r.codes.map((c) => c.format).sort()).toEqual(["Code128", "PDF417", "QRCode"])
    expect(r.codes.find((c) => c.format === "QRCode")!.bytesBase64).toBe(b64(p.qrcode))
    expect(r.codes.find((c) => c.format === "PDF417")!.bytesBase64).toBe(b64(p.pdf417))
    expect(r.codes.find((c) => c.format === "Code128")!.bytesBase64).toBe(b64(p.code128))
    for (const c of r.codes) expect(c.box.width * c.box.height).toBeGreaterThan(0)
    expect(r.text).toContain(DEFAULT_TICKET.pnr)
  })

  it("FULL wrapper: cover first, provider pages copied, original attached; every code is byte-identical in the branded file", async () => {
    const original = await makeTicketPdf()
    for (const locale of ["en", "fa"] as const) {
      const { bytes, coverPages } = await build(original, "FULL", locale)
      const doc = await PDFDocument.load(bytes)
      expect(doc.getPageCount()).toBe(coverPages + 1)
      // The original is embedded byte for byte as an attachment (an EmbeddedFile stream holding the exact bytes).
      expect(bytes.includes(Buffer.from("/EmbeddedFile"))).toBe(true)
      const v = await verifyWrapper({ original, branded: bytes, mode: "FULL", reason: null, coverPages, pnr: DEFAULT_TICKET.pnr, ticketNumbers: [DEFAULT_TICKET.passengers[0]!.ticketNumber], inspected: await inspectPdf(original) })
      expect(v.allMatched).toBe(true)
      expect(v.missing).toEqual([])
      expect(v.codesOriginal).toHaveLength(3)
      expect(v.codesBranded.map((c) => `${c.format}:${c.bytesBase64}`).sort()).toEqual(v.codesOriginal.map((c) => `${c.format}:${c.bytesBase64}`).sort())
      // Branded codes are read from the provider pages, after the cover.
      for (const c of v.codesBranded) expect(c.page).toBeGreaterThan(coverPages)
      expect(v.textWarnings).toBe(false)
      expect(v.wrapperMode).toBe("FULL")
    }
  })

  it("a branded file whose code differs by one byte fails the check", async () => {
    const original = await makeTicketPdf()
    const p = symbolPayloads()
    const altered = await makeTicketPdf({ payloadOverride: { pdf417: p.pdf417.replace("12A", "12B") } })
    const { bytes, coverPages } = await build(altered, "FULL")
    const v = await verifyWrapper({ original, branded: bytes, mode: "FULL", reason: null, coverPages, pnr: null, ticketNumbers: [], inspected: await inspectPdf(original) })
    expect(v.allMatched).toBe(false)
    expect(v.missing.map((i) => v.codesOriginal[i]!.format)).toEqual(["PDF417"])
  })

  it("a signed original is detected; the wrapper is the cover only and the unchanged original carries the codes", async () => {
    const signed = await makeTicketPdf({ signed: true })
    expect(await inspectPdf(signed)).toEqual({ signed: true, encrypted: false })
    expect(await inspectPdf(await makeTicketPdf())).toEqual({ signed: false, encrypted: false })
    const { bytes, coverPages } = await build(signed, "COVER_ONLY")
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(coverPages)
    expect(bytes.includes(Buffer.from("/EmbeddedFile"))).toBe(false)
    const v = await verifyWrapper({ original: signed, branded: bytes, mode: "COVER_ONLY", reason: "SIGNED", coverPages, pnr: DEFAULT_TICKET.pnr, ticketNumbers: [], inspected: await inspectPdf(signed) })
    expect(v).toMatchObject({ allMatched: true, signed: true, wrapperMode: "COVER_ONLY", wrapperReason: "SIGNED", codesBranded: [] })
    expect(v.codesOriginal).toHaveLength(3)
  })

  it("text warnings when the entered PNR or a ticket number is not in the PDF text", async () => {
    const original = await makeTicketPdf()
    const { bytes, coverPages } = await build(original, "FULL")
    const v = await verifyWrapper({ original, branded: bytes, mode: "FULL", reason: null, coverPages, pnr: "ZZZ999", ticketNumbers: [DEFAULT_TICKET.passengers[0]!.ticketNumber, "2359999999999"], inspected: await inspectPdf(original) })
    expect(v.textWarnings).toBe(true)
    expect(v.textMatches).toEqual({ pnr: { value: "ZZZ999", found: false }, ticketNumbers: [{ value: DEFAULT_TICKET.passengers[0]!.ticketNumber, found: true }, { value: "2359999999999", found: false }] })
  })

  it("the code crop is a PNG rendered from the original page that still decodes to the same bytes", async () => {
    const original = await makeTicketPdf()
    const r = await decodePdf(original)
    const qr = r.codes.find((c) => c.format === "QRCode")!
    const png = await renderCodeCrop(original, qr)
    expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
    // Wrap the crop in a one-page PDF and decode it again: the enlarged view reads back identically.
    const doc = await PDFDocument.create()
    const img = await doc.embedPng(png)
    doc.addPage([img.width / 4, img.height / 4]).drawImage(img, { x: 0, y: 0, width: img.width / 4, height: img.height / 4 })
    const again = await decodePdf(Buffer.from(await doc.save()))
    expect(again.codes.map((c) => `${c.format}:${c.bytesBase64}`)).toContain(`QRCode:${qr.bytesBase64}`)
  })
})
