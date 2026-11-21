import fontkit from "@pdf-lib/fontkit"
import bwipjs from "bwip-js"
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "pdf-lib"

import { formatTrackingNumber } from "@unitravel/domain"

import { drawRtl, PERSIAN_TEXT, persian, vazirmatn } from "../documents/pdf"

/**
 * Cargo labels (ADR-0042 D6). One label per piece. Layout is drawn on a 288 × 432 pt (4 × 6 in) design box and
 * scaled into the target: a 4×6 page, an A6 page, or four A6 cells on an A4 page with cut marks.
 */
export type LabelFormat = "4x6" | "A6" | "A4"

export interface LabelParty { name: string; company?: string | null; phone?: string | null; lines: string[] }
export interface LabelInput {
  trackingNumber: string
  ref: string
  qrUrl: string
  service: string
  sender: LabelParty
  recipient: LabelParty
  collection: string[]
  description: string
  handlingInstructions?: string | null
  readyDate: string
  pieces: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number }[]
  totalWeightKg: number
  printedAt: Date
}

const NAVY = rgb(0.024, 0.122, 0.298)
const ORANGE = rgb(1, 0.525, 0.09)
const INK = rgb(0.07, 0.1, 0.16)
const GREY = rgb(0.35, 0.4, 0.48)
const RED = rgb(0.75, 0.1, 0.1)
const W = 288
const H = 432

/** The standard PDF fonts are WinAnsi: keep Latin, swap typographic marks, drop the rest (names are Latin by contract). */
const latin = (s: string) => s.replace(/[·—–]/g, "-").replace(/→/g, "->").replace(/×/g, "x").normalize("NFKD").replace(/[^\x20-\x7E£€]/g, "").trim()

async function png(opts: Parameters<typeof bwipjs.toBuffer>[0]) {
  return bwipjs.toBuffer(opts)
}

interface Ctx { page: PDFPage; ox: number; oy: number; s: number; font: PDFFont; bold: PDFFont; faFont?: PDFFont; faBold?: PDFFont }

/** Design-box coordinates (origin top-left, y down) to PDF coordinates. */
const X = (c: Ctx, x: number) => c.ox + x * c.s
const Y = (c: Ctx, y: number) => c.oy + (H - y) * c.s

function text(c: Ctx, value: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; maxWidth?: number } = {}) {
  // Persian (an Iranian address, a handling note): Vazirmatn, right to left, aligned to the end of the column.
  if (c.faFont && c.faBold && PERSIAN_TEXT.test(value)) {
    const f = opts.bold ? c.faBold : c.faFont
    const max = opts.maxWidth ?? W - x - 10
    let v = persian(value).trim()
    while (v.length > 1 && f.widthOfTextAtSize(v, size) > max) v = v.slice(0, -1)
    drawRtl(c.page, v, X(c, x + max), Y(c, y + size * 0.8), size * c.s, f, opts.color ?? INK)
    return
  }
  const font = opts.bold ? c.bold : c.font
  let v = latin(value)
  const max = opts.maxWidth ?? W - x - 10
  while (v.length > 1 && font.widthOfTextAtSize(v, size) > max) v = v.slice(0, -1)
  c.page.drawText(v, { x: X(c, x), y: Y(c, y + size * 0.8), size: size * c.s, font, color: opts.color ?? INK })
}

function wrap(font: PDFFont, value: string, size: number, width: number, maxLines: number) {
  const words = (PERSIAN_TEXT.test(value) ? persian(value) : latin(value)).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ""
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (font.widthOfTextAtSize(next, size) <= width) cur = next
    else { if (cur) lines.push(cur); cur = w }
    if (lines.length === maxLines) break
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  return lines
}

/** Word-wraps inside `width`, at most `maxLines`; returns the y below the last line. */
function para(c: Ctx, value: string, x: number, y: number, size: number, width: number, maxLines: number, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
  const fa = !!c.faFont && PERSIAN_TEXT.test(value)
  const lines = wrap(fa ? (opts.bold ? c.faBold! : c.faFont!) : opts.bold ? c.bold : c.font, value, size, width, maxLines)
  lines.forEach((l, i) => text(c, l, x, y + i * size * 1.25, size, { ...opts, maxWidth: width }))
  return y + lines.length * size * 1.25
}

function rect(c: Ctx, x: number, y: number, w: number, h: number, opts: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb>; width?: number }) {
  c.page.drawRectangle({ x: X(c, x), y: Y(c, y + h), width: w * c.s, height: h * c.s, color: opts.fill, borderColor: opts.border, borderWidth: opts.border ? (opts.width ?? 1) * c.s : undefined })
}

function line(c: Ctx, x1: number, y1: number, x2: number, y2: number, width = 1) {
  c.page.drawLine({ start: { x: X(c, x1), y: Y(c, y1) }, end: { x: X(c, x2), y: Y(c, y2) }, thickness: width * c.s, color: INK })
}

function image(c: Ctx, img: PDFImage, x: number, y: number, w: number, h: number) {
  c.page.drawImage(img, { x: X(c, x), y: Y(c, y + h), width: w * c.s, height: h * c.s })
}

function party(c: Ctx, label: string, p: LabelParty, x: number, y: number, width: number, big: boolean) {
  text(c, label, x, y, 7, { bold: true, color: GREY })
  let yy = y + 10
  text(c, p.name, x, yy, big ? 13 : 9.5, { bold: true, maxWidth: width }); yy += big ? 16 : 12
  if (p.company) { text(c, p.company, x, yy, big ? 10 : 8.5, { maxWidth: width }); yy += big ? 12.5 : 10.5 }
  for (const l of p.lines) { text(c, l, x, yy, big ? 10.5 : 8.5, { maxWidth: width, bold: big && l === p.lines.at(-1) }); yy += big ? 13 : 10.5 }
  if (p.phone) { text(c, `Tel ${p.phone}`, x, yy, big ? 9.5 : 8, { maxWidth: width }); yy += big ? 12 : 10 }
  return yy
}

async function drawLabel(c: Ctx, l: LabelInput, i: number, barcode: PDFImage, qr: PDFImage) {
  const n = l.pieces.length
  const piece = l.pieces[i]!
  rect(c, 0, 0, W, H, { border: INK, width: 1.2 })
  // Brand band.
  rect(c, 0, 0, W, 36, { fill: NAVY })
  text(c, "UNI", 12, 10, 15, { bold: true, color: rgb(1, 1, 1) })
  text(c, "TRAVEL", 12 + c.bold.widthOfTextAtSize("UNI ", 15), 10, 15, { bold: true, color: ORANGE })
  text(c, "CARGO", 12, 25, 6.5, { bold: true, color: rgb(0.75, 0.82, 0.92) })
  const pieceLabel = `${i + 1} / ${n}`
  text(c, l.service.replace(/_/g, " "), 150, 8, 8, { bold: true, color: rgb(1, 1, 1), maxWidth: 126 })
  text(c, `PIECE ${pieceLabel}`, 150, 20, 10, { bold: true, color: ORANGE, maxWidth: 126 })
  // Tracking number and barcode.
  text(c, "TRACKING NUMBER", 12, 43, 7, { bold: true, color: GREY })
  text(c, formatTrackingNumber(l.trackingNumber), 12, 52, 17, { bold: true })
  // Code128 needs a quiet zone of at least 10 modules each side: keep the bars well inside the label edge.
  image(c, barcode, 40, 74, W - 80, 46)
  text(c, l.trackingNumber, (W - c.font.widthOfTextAtSize(l.trackingNumber, 8)) / 2, 122, 8)
  line(c, 0, 134, W, 134, 1.2)
  // Recipient (largest), then sender.
  const toEnd = party(c, "DELIVER TO", l.recipient, 12, 140, W - 24, true)
  line(c, 0, Math.max(toEnd + 2, 222), W, Math.max(toEnd + 2, 222), 0.8)
  const fromTop = Math.max(toEnd + 8, 228)
  const fromEnd = party(c, "FROM (SENDER)", l.sender, 12, fromTop, 160, false)
  text(c, "COLLECT FROM", 180, fromTop, 7, { bold: true, color: GREY })
  let cy = fromTop + 10
  for (const cl of l.collection) { text(c, cl, 180, cy, 8, { maxWidth: 100 }); cy += 10 }
  const detailsTop = Math.max(fromEnd, cy) + 6
  line(c, 0, detailsTop - 3, W, detailsTop - 3, 0.8)
  // Details beside the QR code.
  image(c, qr, W - 12 - 84, detailsTop + 4, 84, 84)
  text(c, "Scan to track", W - 12 - 84, detailsTop + 90, 6.5, { color: GREY, maxWidth: 84 })
  let dy = detailsTop + 2
  const dw = W - 24 - 92
  text(c, "CONTENTS", 12, dy, 7, { bold: true, color: GREY }); dy += 9
  dy = para(c, l.description, 12, dy, 8.5, dw, 2) + 3
  text(c, `Piece: ${piece.weightKg} kg  ·  ${piece.lengthCm} x ${piece.widthCm} x ${piece.heightCm} cm`, 12, dy, 8.5, { bold: true, maxWidth: dw }); dy += 11
  text(c, `Shipment: ${n} piece${n === 1 ? "" : "s"}, ${l.totalWeightKg} kg`, 12, dy, 8, { maxWidth: dw }); dy += 10
  text(c, `Ref ${l.ref}  ·  Ready ${l.readyDate}`, 12, dy, 8, { maxWidth: dw }); dy += 12
  if (l.handlingInstructions) {
    // Beside the QR code while it is still there, full width below it; sized to its text.
    const qrBottom = detailsTop + 96
    const boxTop = dy
    const width = boxTop < qrBottom ? dw + 6 : W - 20
    const lines = Math.max(1, Math.min(4, Math.floor((H - 16 - boxTop - 12) / 10)))
    const used = wrap(c.faBold && PERSIAN_TEXT.test(l.handlingInstructions) ? c.faBold : c.bold, l.handlingInstructions, 8, width - 10, lines).length
    rect(c, 10, boxTop - 2, width, 14 + used * 10, { border: RED, width: 1.2 })
    text(c, "HANDLING", 15, boxTop + 1, 7, { bold: true, color: RED })
    para(c, l.handlingInstructions, 15, boxTop + 10, 8, width - 10, lines, { bold: true, color: RED })
  }
  text(c, `Printed ${l.printedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, 12, H - 11, 6, { color: GREY })
}

/** Page sizes in points. A6 = 105 × 148 mm; 4×6 = 101.6 × 152.4 mm. */
const SIZES: Record<LabelFormat, [number, number]> = { "4x6": [288, 432], A6: [297.64, 419.53], A4: [595.28, 841.89] }

export async function renderCargoLabels(l: LabelInput, format: LabelFormat): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Cargo label ${l.trackingNumber}`)
  doc.setAuthor("Uni Travel")
  doc.setCreator("Uni Travel cargo")
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let faFont: PDFFont | undefined
  let faBold: PDFFont | undefined
  if (PERSIAN_TEXT.test(JSON.stringify(l))) {
    doc.registerFontkit(fontkit)
    faFont = await doc.embedFont(vazirmatn("Regular"), { subset: true })
    faBold = await doc.embedFont(vazirmatn("Bold"), { subset: true })
  }
  const barcode = await doc.embedPng(await png({ bcid: "code128", text: l.trackingNumber, scale: 4, height: 14, includetext: false, paddingwidth: 0, paddingheight: 0 }))
  const qr = await doc.embedPng(await png({ bcid: "qrcode", text: l.qrUrl, scale: 6, paddingwidth: 0, paddingheight: 0 }))
  const cells: { page: PDFPage; x: number; y: number; w: number; h: number }[] = []
  const pieces = l.pieces.length ? l.pieces : [{ lengthCm: 0, widthCm: 0, heightCm: 0, weightKg: l.totalWeightKg }]
  const input = { ...l, pieces }
  if (format === "A4") {
    const [pw, ph] = SIZES.A4
    for (let i = 0; i < pieces.length; i++) {
      if (i % 4 === 0) {
        const page = doc.addPage([pw, ph])
        // Cut marks between the four A6 cells.
        for (const [a, b] of [[{ x: pw / 2, y: 0 }, { x: pw / 2, y: 12 }], [{ x: pw / 2, y: ph - 12 }, { x: pw / 2, y: ph }], [{ x: 0, y: ph / 2 }, { x: 12, y: ph / 2 }], [{ x: pw - 12, y: ph / 2 }, { x: pw, y: ph / 2 }]] as const) page.drawLine({ start: a, end: b, thickness: 0.5, color: GREY })
      }
      const page = doc.getPages().at(-1)!
      const k = i % 4
      cells.push({ page, x: (k % 2) * (pw / 2), y: k < 2 ? ph / 2 : 0, w: pw / 2, h: ph / 2 })
    }
  } else {
    const [pw, ph] = SIZES[format]
    for (let i = 0; i < pieces.length; i++) cells.push({ page: doc.addPage([pw, ph]), x: 0, y: 0, w: pw, h: ph })
  }
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!
    const margin = format === "4x6" ? 0 : 6
    const s = Math.min((cell.w - margin * 2) / W, (cell.h - margin * 2) / H)
    const ox = cell.x + (cell.w - W * s) / 2
    const oy = cell.y + (cell.h - H * s) / 2
    await drawLabel({ page: cell.page, ox, oy, s, font, bold, faFont, faBold }, input, i, barcode, qr)
  }
  return Buffer.from(await doc.save())
}
