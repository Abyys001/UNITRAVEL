import { readFileSync } from "node:fs"
import { join } from "node:path"

import { createCanvas, loadImage } from "@napi-rs/canvas"
import type { AppSettings, WrapperMode } from "@unitravel/contracts"
import type { TicketCover } from "@unitravel/db"
import { PDFDocument } from "pdf-lib"

import { renderPdf, type PdfSection } from "../documents/pdf"

// apps/api/assets/brand, from both src/modules/ticket-documents (tests) and dist/modules/ticket-documents (runtime).
let bundledMark: Buffer | undefined
export const bundledMarkSvg = () => (bundledMark ??= readFileSync(join(__dirname, "../../../assets/brand", "mark.svg")))

/** PNG for the cover band: PNG as is, JPEG and SVG drawn on a canvas (an SVG is rasterised here, never served). */
export async function logoPng(bytes: Buffer, mime: string): Promise<Buffer> {
  if (mime === "image/png") return bytes
  const img = await loadImage(bytes)
  const h = 192
  const w = Math.max(1, Math.round((img.width / Math.max(1, img.height)) * h))
  const c = createCanvas(Math.min(w, 960), h)
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height)
  return c.toBuffer("image/png")
}

const L = {
  en: {
    title: { E_TICKET: "Your e-ticket", BOARDING_PASS: "Your boarding pass" }, subtitle: "Request {ref} · issued by {company}", kind: "TICKET",
    booking: "Booking", pnr: "Booking reference (PNR)", request: "Request", customer: "Customer", issued: "Issued",
    passengers: "Passengers", name: "Name", ticket: "Ticket number", flights: "Flights", flight: "Flight", from: "From", to: "To", departs: "Departs", arrives: "Arrives",
    notes: "Information", company: "Issued by", phone: "Phone", email: "Email", unknown: "Not recorded",
    full: "The airline's own pages follow unchanged, and the airline's original file is attached inside this PDF. Codes shown are the airline's own; Uni Travel never alters them.",
    coverOnly: "The airline's original document is supplied as a separate file, unchanged. Use that file for check-in and boarding.",
  },
  fa: {
    title: { E_TICKET: "بلیت الکترونیکی شما", BOARDING_PASS: "کارت پرواز شما" }, subtitle: "درخواست {ref} · صادرشده توسط {company}", kind: "بلیت",
    booking: "رزرو", pnr: "کد رزرو (PNR)", request: "درخواست", customer: "مشتری", issued: "تاریخ صدور",
    passengers: "مسافران", name: "Name", ticket: "Ticket number", flights: "پروازها", flight: "Flight", from: "From", to: "To", departs: "Departs", arrives: "Arrives",
    notes: "توضیحات", company: "صادرکننده", phone: "تلفن", email: "ایمیل", unknown: "ثبت نشده",
    full: "صفحه‌های شرکت هواپیمایی بدون تغییر در ادامه آمده و فایل اصلی شرکت هواپیمایی نیز داخل همین PDF پیوست شده است. کدهای روی آن متعلق به شرکت هواپیمایی است و یونی‌تراول هرگز آن‌ها را تغییر نمی‌دهد.",
    coverOnly: "سند اصلی شرکت هواپیمایی به‌صورت فایل جداگانه و بدون تغییر ارسال شده است. برای پذیرش و سوار شدن از همان فایل استفاده کنید.",
  },
} as const

export interface BrandedInput {
  original: Buffer
  originalFilename: string
  mode: WrapperMode
  kind: "E_TICKET" | "BOARDING_PASS"
  requestRef: string
  cover: TicketCover
  company: AppSettings["company"]
  logo: { bytes: Buffer; mime: string } | null
  issuedOn: string
}

/** D3: page 1 is our cover; in FULL mode the provider's pages follow via copyPages and the original is attached byte for byte. */
export async function buildBrandedPdf(input: BrandedInput): Promise<{ bytes: Buffer; coverPages: number }> {
  const t = L[input.cover.locale]
  const c = input.cover
  const sections: PdfSection[] = [
    { heading: t.booking, rows: [[t.pnr, c.pnr ?? t.unknown], [t.request, input.requestRef], [t.customer, c.customerName], [t.issued, input.issuedOn]] },
    { heading: t.passengers, table: { columns: [{ label: t.name, x: 50 }, { label: t.ticket, x: 330 }], rows: c.passengers.map((p) => [p.name, p.ticketNumber ?? t.unknown]) } },
  ]
  if (c.segments.length) {
    sections.push({
      heading: t.flights,
      table: {
        columns: [{ label: t.flight, x: 50 }, { label: t.from, x: 120 }, { label: t.to, x: 170 }, { label: t.departs, x: 220 }, { label: t.arrives, x: 380 }],
        rows: c.segments.map((s) => [`${s.carrier}${s.flightNumber}`, s.origin, s.destination, (s.departureLocal ?? s.departureUtc.slice(0, 16)).replace("T", " "), (s.arrivalLocal ?? s.arrivalUtc?.slice(0, 16) ?? "-").replace("T", " ")]),
      },
    })
  }
  if (c.notes) sections.push({ heading: t.notes, paragraphs: [c.notes] })
  const co = input.company
  sections.push({ heading: t.company, rows: [[co.name, co.address], [t.phone, co.phone], [t.email, co.email]], paragraphs: [co.registration] })
  const logo = input.logo ? await logoPng(input.logo.bytes, input.logo.mime).catch(() => null) : null
  const coverBytes = await renderPdf(
    t.title[input.kind], t.subtitle.replace("{ref}", input.requestRef).replace("{company}", co.name), sections, [input.mode === "FULL" ? t.full : t.coverOnly],
    { kind: t.kind, locale: input.cover.locale, brand: { primary: co.brandColours.primary, accent: co.brandColours.accent, logoPng: logo ?? (await logoPng(bundledMarkSvg(), "image/svg+xml")) } },
  )
  const doc = await PDFDocument.load(coverBytes)
  const coverPages = doc.getPageCount()
  if (input.mode === "FULL") {
    const src = await PDFDocument.load(input.original, { updateMetadata: false })
    for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p)
    await doc.attach(input.original, input.originalFilename.replace(/[^A-Za-z0-9._-]/g, "_") || "original.pdf", {
      mimeType: "application/pdf", description: "Original document from the issuing provider, unchanged", creationDate: new Date(0), modificationDate: new Date(0),
    })
  }
  doc.setTitle(`${t.title[input.kind]} · ${input.requestRef}`)
  doc.setProducer("Uni Travel")
  return { bytes: Buffer.from(await doc.save()), coverPages }
}
