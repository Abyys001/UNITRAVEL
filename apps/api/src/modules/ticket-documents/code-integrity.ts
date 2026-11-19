import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { createCanvas } from "@napi-rs/canvas"
import type { CodeIntegrityResult, DecodedCode, PageBox, TextMatch, WrapperMode, WrapperReason } from "@unitravel/contracts"
import { missingCodes, textContains } from "@unitravel/domain"
import { PDFDict, PDFDocument, PDFName } from "pdf-lib"
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader"

/**
 * ADR-0038 D4: renders PDF pages with pdf.js on a prebuilt native canvas and decodes every machine-readable code with
 * zxing (QR, PDF417, Aztec, Data Matrix and 1-D codes). Payloads are compared as exact bytes; nothing is re-encoded.
 */

/** pdf.js viewport scales (1 = 72 dpi): 2 and 3 are about 144 and 216 dpi, enough for dense PDF417 and Aztec codes. */
export const RENDER_SCALES = [2, 3] as const
/** Larger pages are not rendered (a ticket PDF has a handful of pages; this bounds memory and time). */
export const MAX_PAGES = 30
const MAX_PIXELS = 40_000_000

// Works under the compiled CommonJS build and under vitest alike.
const req = createRequire(__filename)

let zxingReady: Promise<unknown> | undefined
/** The wasm binary is read from the installed package, so nothing is fetched from a CDN (Node and the Docker image alike). */
function zxing() {
  zxingReady ??= prepareZXingModule({ overrides: { wasmBinary: wasmBytes() }, fireImmediately: true })
  return zxingReady
}

function wasmBytes(): ArrayBuffer {
  const buf = readFileSync(req.resolve("zxing-wasm/reader/zxing_reader.wasm"))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs")
let pdfjsLib: Promise<PdfJs> | undefined
const pdfjs = () => (pdfjsLib ??= import("pdfjs-dist/legacy/build/pdf.mjs"))
const pdfjsDir = () => dirname(req.resolve("pdfjs-dist/package.json"))

const READER: ReaderOptions = { formats: [], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 64 }

async function open(bytes: Uint8Array) {
  const lib = await pdfjs()
  // A copy: pdf.js transfers (detaches) the buffer it is given.
  const task = lib.getDocument({
    data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0,
    standardFontDataUrl: join(pdfjsDir(), "standard_fonts") + "/", cMapUrl: join(pdfjsDir(), "cmaps") + "/", cMapPacked: true, wasmUrl: join(pdfjsDir(), "wasm") + "/",
  })
  const doc = await task.promise
  return Object.assign(doc, { close: () => task.destroy() })
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof open>>["getPage"]>>

async function renderPage(page: PdfPage, scale: number) {
  const base = page.getViewport({ scale: 1 })
  const s = Math.min(scale, Math.sqrt(MAX_PIXELS / Math.max(1, base.width * base.height)))
  const viewport = page.getViewport({ scale: s })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // pdf.js types its canvas as the DOM one; @napi-rs/canvas implements the same 2D API.
  await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise
  return { canvas, ctx }
}

/**
 * Signature or encryption (D3: such a file is never rewrapped, the cover goes alone). The raw scan catches markers in
 * plain objects; the structural walk also finds a signature dictionary stored inside a compressed object stream.
 */
export async function inspectPdf(bytes: Buffer): Promise<{ signed: boolean; encrypted: boolean }> {
  const raw = bytes.toString("latin1")
  let signed = /\/ByteRange\s*\[/.test(raw) || /\/Type\s*\/Sig\b/.test(raw) || /\/FT\s*\/Sig\b/.test(raw)
  let encrypted = /\/Encrypt\s+\d+\s+\d+\s+R/.test(raw) || /\/Encrypt\s*<</.test(raw)
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
    encrypted ||= doc.isEncrypted
    if (!signed) {
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFDict)) continue
        const type = obj.get(PDFName.of("Type")), ft = obj.get(PDFName.of("FT"))
        if (obj.has(PDFName.of("ByteRange")) || (type instanceof PDFName && type.asString() === "/Sig") || (ft instanceof PDFName && ft.asString() === "/Sig")) { signed = true; break }
      }
    }
  } catch {
    // Unparseable by pdf-lib: the raw markers decide, and the wrapper falls back to the cover when copying fails.
  }
  return { signed, encrypted }
}

export interface DecodeResult { codes: DecodedCode[]; pages: number; text: string }

/**
 * Every code on every page. A page is rendered at each scale; a code counts once per page however many scales read it,
 * but two identical codes on one page count twice (the highest count any single scale saw).
 */
export async function decodePdf(bytes: Uint8Array, opts: { scales?: readonly number[]; firstPage?: number } = {}): Promise<DecodeResult> {
  await zxing()
  const doc = await open(bytes)
  try {
    const pages = doc.numPages
    if (pages > MAX_PAGES) throw new Error(`PDF has ${pages} pages; at most ${MAX_PAGES} are checked`)
    const codes: DecodedCode[] = []
    const text: string[] = []
    for (let p = opts.firstPage ?? 1; p <= pages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      text.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "))
      const best = new Map<string, DecodedCode[]>()
      for (const scale of opts.scales ?? RENDER_SCALES) {
        const { canvas, ctx } = await renderPage(page, scale)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const found = await readBarcodes({ data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), width: img.width, height: img.height, colorSpace: "srgb" } as unknown as Parameters<typeof readBarcodes>[0], READER)
        const byKey = new Map<string, DecodedCode[]>()
        for (const r of found) {
          if (!r.isValid) continue
          const bytesBase64 = Buffer.from(r.bytes).toString("base64")
          const xs = [r.position.topLeft.x, r.position.topRight.x, r.position.bottomLeft.x, r.position.bottomRight.x]
          const ys = [r.position.topLeft.y, r.position.topRight.y, r.position.bottomLeft.y, r.position.bottomRight.y]
          const box: PageBox = clampBox({ x: Math.min(...xs) / canvas.width, y: Math.min(...ys) / canvas.height, width: (Math.max(...xs) - Math.min(...xs)) / canvas.width, height: (Math.max(...ys) - Math.min(...ys)) / canvas.height })
          const key = `${r.format}:${bytesBase64}`
          byKey.set(key, [...(byKey.get(key) ?? []), { format: r.format, page: p, bytesBase64, text: r.text, box }])
        }
        for (const [k, list] of byKey) if ((best.get(k)?.length ?? 0) < list.length) best.set(k, list)
      }
      for (const list of best.values()) codes.push(...list)
      page.cleanup()
    }
    return { codes, pages, text: text.join("\n") }
  } finally {
    await doc.close()
  }
}

function clampBox(b: PageBox): PageBox {
  const c = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
  return { x: c(b.x), y: c(b.y), width: c(b.width), height: c(b.height) }
}

export function matchText(text: string, pnr: string | null, ticketNumbers: string[]): { pnr: TextMatch | null; ticketNumbers: TextMatch[]; warnings: boolean } {
  const p = pnr ? { value: pnr, found: textContains(text, pnr) } : null
  const t = ticketNumbers.map((value) => ({ value, found: textContains(text, value) }))
  return { pnr: p, ticketNumbers: t, warnings: (p ? !p.found : false) || t.some((x) => !x.found) }
}

/**
 * D4 over a built wrapper. FULL: every code of the original must be in the branded file's provider pages (after the
 * cover) with identical bytes. COVER_ONLY: the branded file carries no provider pages; the unchanged original travels as
 * its own file, so its codes are compared against a fresh decode of the original bytes as delivered.
 */
export async function verifyWrapper(input: {
  original: Buffer; branded: Buffer; mode: WrapperMode; reason: WrapperReason | null; coverPages: number; originalDecode?: DecodeResult; pnr: string | null; ticketNumbers: string[]; inspected: { signed: boolean; encrypted: boolean }
}): Promise<CodeIntegrityResult> {
  const orig = input.originalDecode ?? (await decodePdf(input.original))
  const brandedPages = (await PDFDocument.load(input.branded, { updateMetadata: false })).getPageCount()
  let codesBranded: DecodedCode[] = []
  let missing: number[]
  if (input.mode === "FULL") {
    const dec = await decodePdf(input.branded, { firstPage: input.coverPages + 1 })
    codesBranded = dec.codes
    missing = missingCodes(orig.codes, dec.codes)
  } else {
    const again = await decodePdf(input.original)
    missing = missingCodes(orig.codes, again.codes)
  }
  const text = matchText(orig.text, input.pnr, input.ticketNumbers)
  return {
    codesOriginal: orig.codes, codesBranded, allMatched: missing.length === 0, missing, signed: input.inspected.signed, encrypted: input.inspected.encrypted,
    wrapperMode: input.mode, wrapperReason: input.reason, textMatches: { pnr: text.pnr, ticketNumbers: text.ticketNumbers }, textWarnings: text.warnings,
    scales: [...RENDER_SCALES], pages: { original: orig.pages, branded: brandedPages }, checkedAt: new Date().toISOString(),
  }
}

/** The portal's "show code": an enlarged PNG crop of the ORIGINAL page around a decoded code (never a re-encoded symbol). */
export async function renderCodeCrop(original: Buffer, code: Pick<DecodedCode, "page" | "box">, scale = 4): Promise<Buffer> {
  const doc = await open(original)
  try {
    if (code.page < 1 || code.page > doc.numPages) throw new Error("page out of range")
    const { canvas } = await renderPage(await doc.getPage(code.page), scale)
    // A quiet zone around the symbol: scanners need it, and the crop must not clip modules.
    const mx = Math.max(code.box.width * 0.15, 0.02), my = Math.max(code.box.height * 0.15, 0.02)
    const x0 = Math.max(0, Math.floor((code.box.x - mx) * canvas.width)), y0 = Math.max(0, Math.floor((code.box.y - my) * canvas.height))
    const x1 = Math.min(canvas.width, Math.ceil((code.box.x + code.box.width + mx) * canvas.width)), y1 = Math.min(canvas.height, Math.ceil((code.box.y + code.box.height + my) * canvas.height))
    const out = createCanvas(Math.max(1, x1 - x0), Math.max(1, y1 - y0))
    out.getContext("2d").drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0)
    return out.toBuffer("image/png")
  } finally {
    await doc.close()
  }
}
