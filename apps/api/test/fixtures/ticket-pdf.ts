import bwipjs from "bwip-js"
import { PDFDocument, PDFHexString, PDFName, PDFNumber, StandardFonts, rgb } from "pdf-lib"

/**
 * ADR-0038 test fixture: a provider-style e-ticket / boarding pass PDF carrying a QR code, a PDF417 (IATA BCBP style)
 * and a Code 128 symbol. Used by the API unit and e2e tests and by later Playwright runs (see write-ticket-pdf.ts).
 * The data is fictitious; the BCBP string only follows the shape of the format.
 */
export interface TicketPdfOptions {
  pnr?: string
  passengers?: { name: string; ticketNumber: string }[]
  flight?: { carrier: string; number: string; from: string; to: string; date: string }
  /** Symbols to draw (default all three). */
  codes?: ("qrcode" | "pdf417" | "code128")[]
  /** Adds a signature dictionary (/Type /Sig with /ByteRange), as a digitally signed PDF has. */
  signed?: boolean
  /** Override the payload of one symbol (to build a deliberately different file). */
  payloadOverride?: Partial<Record<"qrcode" | "pdf417" | "code128", string>>
}

export const DEFAULT_TICKET = {
  pnr: "ABC123",
  passengers: [{ name: "REZAEI/NEDA MS", ticketNumber: "2351234567890" }],
  flight: { carrier: "TK", number: "1980", from: "LHR", to: "IST", date: "2026-12-14" },
}

/** IATA BCBP-shaped string (M1 + name + E + PNR + from/to/carrier + flight + Julian date + cabin + seat + sequence). */
export function bcbp(o: { name: string; pnr: string; from: string; to: string; carrier: string; number: string; julian?: string }) {
  const name = o.name.padEnd(20, " ").slice(0, 20)
  return `M1${name}E${o.pnr.padEnd(7, " ")}${o.from}${o.to}${o.carrier.padEnd(3, " ")}${o.number.padStart(4, "0")} ${o.julian ?? "348"}Y012A0001 100`
}

export function symbolPayloads(o: TicketPdfOptions = {}) {
  const pnr = o.pnr ?? DEFAULT_TICKET.pnr
  const pax = o.passengers ?? DEFAULT_TICKET.passengers
  const f = o.flight ?? DEFAULT_TICKET.flight
  const pass = bcbp({ name: pax[0]!.name, pnr, from: f.from, to: f.to, carrier: f.carrier, number: f.number })
  return {
    qrcode: o.payloadOverride?.qrcode ?? pass,
    pdf417: o.payloadOverride?.pdf417 ?? pass,
    code128: o.payloadOverride?.code128 ?? pax[0]!.ticketNumber,
  }
}

export async function makeTicketPdf(o: TicketPdfOptions = {}): Promise<Buffer> {
  const pnr = o.pnr ?? DEFAULT_TICKET.pnr
  const pax = o.passengers ?? DEFAULT_TICKET.passengers
  const f = o.flight ?? DEFAULT_TICKET.flight
  const payloads = symbolPayloads(o)
  const doc = await PDFDocument.create()
  doc.setTitle("Electronic ticket receipt")
  doc.setProducer("unitravel-test-fixture")
  // Fixed dates keep the bytes reproducible for a given input.
  doc.setCreationDate(new Date("2026-11-19T00:00:00Z"))
  doc.setModificationDate(new Date("2026-11-19T00:00:00Z"))
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  page.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: rgb(0.75, 0.05, 0.1) })
  page.drawText("SAMPLE AIRLINE  ELECTRONIC TICKET / BOARDING PASS", { x: 40, y: 810, size: 13, font: bold, color: rgb(1, 1, 1) })
  let y = 760
  const line = (t: string, b = false) => { page.drawText(t, { x: 40, y, size: 11, font: b ? bold : font }); y -= 18 }
  line(`Booking reference: ${pnr}`, true)
  for (const p of pax) line(`Passenger: ${p.name}   Ticket number: ${p.ticketNumber}`)
  line(`Flight ${f.carrier}${f.number}  ${f.from} - ${f.to}  ${f.date}  Seat 12A  Cabin Y`)
  line("This is a test document generated for automated checks. It is not a travel document.")
  const codes = o.codes ?? ["qrcode", "pdf417", "code128"]
  let cy = 560
  for (const bcid of codes) {
    const png = await bwipjs.toBuffer({ bcid, text: payloads[bcid], scale: 3, includetext: false, ...(bcid === "pdf417" ? { columns: 6 } : {}) })
    const img = await doc.embedPng(png)
    const w = bcid === "qrcode" ? 140 : bcid === "pdf417" ? 320 : 280
    const h = bcid === "qrcode" ? 140 : bcid === "pdf417" ? 90 : 70
    page.drawImage(img, { x: 40, y: cy, width: w, height: h })
    cy -= h + 50
  }
  if (o.signed) {
    // The markers a signed PDF carries; the signature itself is not valid (detection only looks for the dictionary).
    const sig = doc.context.obj({ Type: "Sig", Filter: "Adobe.PPKLite", SubFilter: "adbe.pkcs7.detached" })
    sig.set(PDFName.of("ByteRange"), doc.context.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)]))
    sig.set(PDFName.of("Contents"), PDFHexString.of("00".repeat(32)))
    doc.context.register(sig)
  }
  return Buffer.from(await doc.save())
}
