import { readFileSync } from "node:fs"
import { join } from "node:path"

import fontkit from "@pdf-lib/fontkit"
import { PDFDocument, type PDFPage, rgb, StandardFonts } from "pdf-lib"

/** `table` rows are left-aligned text except the columns marked `right` (amounts); `emphasis` bolds the last row (a total). */
export interface PdfTable { columns: { label: string; x: number; right?: boolean }[]; rows: string[][]; emphasis?: boolean }
export interface PdfSection { heading?: string; rows?: [string, string][]; paragraphs?: string[]; table?: PdfTable }
export interface PdfOptions {
  /** Small label at the right of the header band, e.g. "INVOICE". */ kind?: string
  /** "fa" embeds Vazirmatn and lays the page out right to left (rows, paragraphs, footer); tables stay left to right. Default "en". */ locale?: "en" | "fa"
}

// Brand tokens from packages/ui/src/styles.css ("Night flight"): navy-950, orange, steel.
const NAVY = rgb(0.024, 0.122, 0.298)
const COPPER = rgb(1, 0.525, 0.09)
const GREY = rgb(0.29, 0.365, 0.478)
const LINE = rgb(0.859, 0.898, 0.949)

/** Latin-only text for the standard PDF font (English documents); Persian documents use `persian` and an embedded font. */
const ascii = (s: string) => s.replace(/[·—–]/g, "-").replace(/→/g, "-").replace(/×/g, "x")
const latin = (s: string) => ascii(s).normalize("NFKD").replace(/[^\x20-\x7E£€]/g, "").replace(/[£]/g, "GBP ").replace(/[€]/g, "EUR ")

const R_CHAR = /[\u0600-\u065F\u066A-\u06EF\u06FA-\u06FF\u0750-\u077F\u200c\u200d]/
const L_CHAR = /[A-Za-z0-9\u0660-\u0669\u06F0-\u06F9]/
const FA_DIGITS = /([\u06F0-\u06F9]+(?:[:.,/][\u06F0-\u06F9]+)*)/
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<" }

/** Minimal bidi for a right-to-left paragraph: Persian letters are R, Latin letters and digits are L, and neutrals between two L characters stay L, otherwise they join the Persian run (brackets mirrored). */
export function bidiRuns(text: string): { text: string; rtl: boolean }[] {
  const cls = [...text].map((ch) => (R_CHAR.test(ch) ? "R" : L_CHAR.test(ch) ? "L" : "N"))
  const chars = [...text]
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== "N") continue
    let j = i
    while (j < cls.length && cls[j] === "N") j++
    const resolved = i > 0 && j < cls.length && cls[i - 1] === "L" && cls[j] === "L" ? "L" : "R"
    for (let k = i; k < j; k++) cls[k] = resolved
    i = j - 1
  }
  const runs: { text: string; rtl: boolean }[] = []
  chars.forEach((ch, i) => {
    const rtl = cls[i] === "R"
    const c = rtl ? (MIRROR[ch] ?? ch) : ch
    const last = runs[runs.length - 1]
    if (last && last.rtl === rtl) last.text += c
    else runs.push({ text: c, rtl })
  })
  return runs
}

/** Persian keeps its own letters; bidi marks have no glyph in the font and are dropped. */
const persian = (s: string) => ascii(s).normalize("NFC").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/[^\x20-\x7E\u00A0\u0600-\u06FF\u0750-\u077F\u200c\u200d£€]/g, "").replace(/£/g, "GBP ").replace(/€/g, "EUR ")

// apps/api/assets/fonts, from both src/modules/documents (tests) and dist/modules/documents (runtime).
const fontBytes = new Map<string, Buffer>()
const vazirmatn = (weight: "Regular" | "Bold") => {
  if (!fontBytes.has(weight)) fontBytes.set(weight, readFileSync(join(__dirname, "../../../assets/fonts", `Vazirmatn-${weight}.ttf`)))
  return fontBytes.get(weight)!
}

/** Simple branded A4 document (quote, receipt, ATOL certificate, shipment summary, commercial invoice template). */
export async function renderPdf(title: string, subtitle: string, sections: PdfSection[], footer: string[], options: PdfOptions = {}): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const fa = options.locale === "fa"
  if (fa) doc.registerFontkit(fontkit)
  const font = fa ? await doc.embedFont(vazirmatn("Regular"), { subset: true }) : await doc.embedFont(StandardFonts.Helvetica)
  const bold = fa ? await doc.embedFont(vazirmatn("Bold"), { subset: true }) : await doc.embedFont(StandardFonts.HelveticaBold)
  const brand = fa ? await doc.embedFont(StandardFonts.HelveticaBold) : bold
  const clean = fa ? persian : latin
  /** Draws text ending at `xr`, first logical run rightmost. fontkit reverses whatever it draws as Persian, so Persian digits are handed over pre-reversed to read left to right. */
  const drawRtl = (pg: PDFPage, text: string, xr: number, yy: number, size: number, f: typeof font, color: ReturnType<typeof rgb>) => {
    let x = xr
    for (const run of bidiRuns(text)) {
      // A ZWNJ must break joining without a visible gap: the font has no usable glyph for it, so the run is drawn as separately shaped pieces (logical order is right to left).
      const pieces = run.rtl ? run.text.split("\u200c").filter(Boolean).reverse() : run.text.split(FA_DIGITS).filter(Boolean)
      const placed: { t: string; w: number; draw: string }[] = pieces.map((t) => ({ t, w: f.widthOfTextAtSize(t, size), draw: !run.rtl && FA_DIGITS.test(t) ? [...t].reverse().join("") : t }))
      x -= placed.reduce((n, p) => n + p.w, 0)
      let px = x
      for (const p of placed) {
        if (p.t.trim()) pg.drawText(p.draw, { x: px, y: yy, size, font: f, color })
        px += p.w
      }
    }
  }
  let page = doc.addPage([595, 842])
  let y = 790
  const line = (text: string, opts: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    if (y < 80) { page = doc.addPage([595, 842]); y = 790 }
    if (fa) drawRtl(page, clean(text).slice(0, 110), 545, y, opts.size ?? 10, opts.f ?? font, opts.color ?? NAVY)
    else page.drawText(latin(text).slice(0, 110), { x: opts.x ?? 50, y, size: opts.size ?? 10, font: opts.f ?? font, color: opts.color ?? NAVY })
    y -= (opts.size ?? 10) + 6
  }
  page.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: NAVY })
  page.drawText("UNI TRAVEL", { x: 50, y: 822, size: 10, font: brand, color: COPPER })
  if (options.kind) {
    const kind = fa ? persian(options.kind) : latin(options.kind).toUpperCase()
    if (fa) drawRtl(page, kind, 545, 822, 9, bold, rgb(1, 1, 1))
    else page.drawText(kind, { x: 545 - bold.widthOfTextAtSize(kind, 9), y: 822, size: 9, font: bold, color: rgb(1, 1, 1) })
  }
  line(title, { size: 18, f: bold })
  line(subtitle, { size: 10, color: GREY })
  y -= 8
  for (const s of sections) {
    if (s.heading) { y -= 4; line(fa ? s.heading : s.heading.toUpperCase(), { size: 9, f: bold, color: COPPER }) }
    for (const [k, v] of s.rows ?? []) {
      if (y < 80) { page = doc.addPage([595, 842]); y = 790 }
      if (fa) {
        drawRtl(page, persian(k).slice(0, 40), 545, y, 10, bold, NAVY)
        drawRtl(page, persian(v).slice(0, 80), 400, y, 10, font, NAVY)
      } else {
        page.drawText(latin(k).slice(0, 40), { x: 50, y, size: 10, font: bold, color: NAVY })
        page.drawText(latin(v).slice(0, 80), { x: 220, y, size: 10, font, color: NAVY })
      }
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
    for (const p of s.paragraphs ?? []) for (const chunk of wrap(clean(p), 95)) line(chunk)
  }
  y -= 10
  for (const f of footer) for (const chunk of wrap(clean(f), 105)) line(chunk, { size: 8, color: GREY })
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
