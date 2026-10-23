import { PDFDocument, rgb, StandardFonts } from "pdf-lib"

export interface PdfSection { heading?: string; rows?: [string, string][]; paragraphs?: string[] }

const NAVY = rgb(0.075, 0.149, 0.247)
const COPPER = rgb(0.69, 0.478, 0.27)
const GREY = rgb(0.35, 0.38, 0.42)

/** Latin-only text for the standard PDF font: Persian copy lives in the apps; documents are issued in English. */
const latin = (s: string) => s.normalize("NFKD").replace(/[^\x20-\x7E£€]/g, "").replace(/[£]/g, "GBP ").replace(/[€]/g, "EUR ")

/** Simple branded A4 document (quote, receipt, ATOL certificate, shipment summary, commercial invoice template). */
export async function renderPdf(title: string, subtitle: string, sections: PdfSection[], footer: string[]): Promise<Buffer> {
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
