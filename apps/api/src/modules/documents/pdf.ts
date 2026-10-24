import { PDFDocument, rgb, StandardFonts } from "pdf-lib"

/** `table` rows are left-aligned text except the columns marked `right` (amounts); `emphasis` bolds the last row (a total). */
export interface PdfTable { columns: { label: string; x: number; right?: boolean }[]; rows: string[][]; emphasis?: boolean }
export interface PdfSection { heading?: string; rows?: [string, string][]; paragraphs?: string[]; table?: PdfTable }
export interface PdfOptions { /** Small label at the right of the header band, e.g. "INVOICE". */ kind?: string }

// Brand tokens from packages/ui/src/styles.css ("Night flight"): navy-950, orange, steel.
const NAVY = rgb(0.024, 0.122, 0.298)
const COPPER = rgb(1, 0.525, 0.09)
const GREY = rgb(0.29, 0.365, 0.478)
const LINE = rgb(0.859, 0.898, 0.949)

/** Latin-only text for the standard PDF font: Persian copy lives in the apps; documents are issued in English. */
const latin = (s: string) => s.normalize("NFKD").replace(/[^\x20-\x7E£€]/g, "").replace(/[£]/g, "GBP ").replace(/[€]/g, "EUR ")

/** Simple branded A4 document (quote, receipt, ATOL certificate, shipment summary, commercial invoice template). */
export async function renderPdf(title: string, subtitle: string, sections: PdfSection[], footer: string[], options: PdfOptions = {}): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let page = doc.addPage([595, 842])
  let y = 790
  const line = (text: string, opts: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    if (y < 80) { page = doc.addPage([595, 842]); y = 790 }
    page.drawText(latin(text).slice(0, 110), { x: opts.x ?? 50, y, size: opts.size ?? 10, font: opts.f ?? font, color: opts.color ?? NAVY })
    y -= (opts.size ?? 10) + 6
  }
  page.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: NAVY })
  page.drawText("UNI TRAVEL", { x: 50, y: 822, size: 10, font: bold, color: COPPER })
  if (options.kind) page.drawText(latin(options.kind).toUpperCase(), { x: 545 - bold.widthOfTextAtSize(latin(options.kind).toUpperCase(), 9), y: 822, size: 9, font: bold, color: rgb(1, 1, 1) })
  line(title, { size: 18, f: bold })
  line(subtitle, { size: 10, color: GREY })
  y -= 8
  for (const s of sections) {
    if (s.heading) { y -= 4; line(s.heading.toUpperCase(), { size: 9, f: bold, color: COPPER }) }
    for (const [k, v] of s.rows ?? []) {
      if (y < 80) { page = doc.addPage([595, 842]); y = 790 }
      page.drawText(latin(k).slice(0, 40), { x: 50, y, size: 10, font: bold, color: NAVY })
      page.drawText(latin(v).slice(0, 80), { x: 220, y, size: 10, font, color: NAVY })
      y -= 16
    }
    if (s.table) {
      const t = s.table
      const draw = (cells: string[], f: typeof font, size: number) => {
        if (y < 80) { page = doc.addPage([595, 842]); y = 790 }
        t.columns.forEach((c, i) => {
          const v = latin(cells[i] ?? "").slice(0, 70)
          page.drawText(v, { x: c.right ? c.x - f.widthOfTextAtSize(v, size) : c.x, y, size, font: f, color: NAVY })
        })
        y -= size + 7
      }
      draw(t.columns.map((c) => c.label.toUpperCase()), bold, 8)
      page.drawLine({ start: { x: 50, y: y + 5 }, end: { x: 545, y: y + 5 }, thickness: 0.6, color: LINE })
      t.rows.forEach((r, i) => draw(r, t.emphasis && i === t.rows.length - 1 ? bold : font, 10))
    }
    for (const p of s.paragraphs ?? []) for (const chunk of wrap(latin(p), 95)) line(chunk)
  }
  y -= 10
  for (const f of footer) for (const chunk of wrap(latin(f), 105)) line(chunk, { size: 8, color: GREY })
  return Buffer.from(await doc.save())
}

function wrap(s: string, n: number): string[] {
  const out: string[] = []
  let cur = ""
  for (const w of s.split(/\s+/)) {
    if ((cur + " " + w).trim().length > n) { out.push(cur.trim()); cur = w } else cur += ` ${w}`
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
