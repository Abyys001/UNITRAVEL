// Metadata stripping for identity scans (ADR-0005 V7). The container is rewritten, the pixel data is not touched, so
// legibility is exactly what the customer uploaded. Anything that does not parse is refused rather than passed through.

export class UnsupportedImageError extends Error {}

const JPEG_KEEP_APP = new Set([0xe0 /* JFIF */, 0xe2 /* ICC profile */, 0xee /* Adobe colour transform */])

/** JPEG: keep decode-critical segments; drop EXIF/XMP/IPTC (APP1, APP13), comments, and every other APPn. */
export function stripJpeg(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) throw new UnsupportedImageError("Not a JPEG")
  const out: Buffer[] = [input.subarray(0, 2)]
  let i = 2
  while (i < input.length) {
    if (input[i] !== 0xff) throw new UnsupportedImageError("Corrupt JPEG segment")
    let marker = input[i + 1]!
    // Fill bytes before a marker are legal.
    while (marker === 0xff && i + 2 < input.length) { i++; marker = input[i + 1]! }
    if (marker === 0xd9) { out.push(input.subarray(i, i + 2)); i += 2; break } // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(input.subarray(i, i + 2)); i += 2; continue }
    if (i + 4 > input.length) throw new UnsupportedImageError("Truncated JPEG")
    const len = input.readUInt16BE(i + 2)
    if (len < 2 || i + 2 + len > input.length) throw new UnsupportedImageError("Corrupt JPEG segment length")
    const end = i + 2 + len
    if (marker === 0xda) {
      // Start of scan: copy the header and the entropy-coded data up to the next real marker, then carry on (progressive JPEGs have several scans).
      let j = end
      while (j < input.length - 1 && !(input[j] === 0xff && input[j + 1] !== 0x00 && input[j + 1] !== 0xff && !(input[j + 1]! >= 0xd0 && input[j + 1]! <= 0xd7))) j++
      if (j >= input.length - 1) throw new UnsupportedImageError("JPEG has no end marker")
      out.push(input.subarray(i, j))
      i = j
      continue
    }
    const keep = marker >= 0xe0 && marker <= 0xef ? JPEG_KEEP_APP.has(marker) : marker !== 0xfe /* COM */
    if (keep) out.push(input.subarray(i, end))
    i = end
  }
  const result = Buffer.concat(out)
  if (result.length < 4 || result[result.length - 2] !== 0xff || result[result.length - 1] !== 0xd9) throw new UnsupportedImageError("JPEG has no end marker")
  return result
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Critical chunks, palette/transparency, colour management and APNG frames; everything else (eXIf, tEXt, zTXt, iTXt, tIME, vendor chunks) is dropped. */
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD", "acTL", "fcTL", "fdAT"])

export function stripPng(input: Buffer): Buffer {
  if (input.length < 8 || !input.subarray(0, 8).equals(PNG_SIGNATURE)) throw new UnsupportedImageError("Not a PNG")
  const out: Buffer[] = [PNG_SIGNATURE]
  let i = 8
  let sawEnd = false
  while (i + 12 <= input.length) {
    const len = input.readUInt32BE(i)
    const end = i + 12 + len
    if (end > input.length) throw new UnsupportedImageError("Corrupt PNG chunk")
    const type = input.toString("latin1", i + 4, i + 8)
    if (PNG_KEEP.has(type)) out.push(input.subarray(i, end))
    i = end
    if (type === "IEND") { sawEnd = true; break }
  }
  if (!sawEnd) throw new UnsupportedImageError("PNG has no end chunk")
  return Buffer.concat(out)
}

/** Dispatches on the content, not the filename or declared type. */
export function stripImageMetadata(input: Buffer): { body: Buffer; mime: "image/jpeg" | "image/png" } {
  if (input[0] === 0xff && input[1] === 0xd8) return { body: stripJpeg(input), mime: "image/jpeg" }
  if (input.subarray(0, 8).equals(PNG_SIGNATURE)) return { body: stripPng(input), mime: "image/png" }
  throw new UnsupportedImageError("Only JPEG and PNG scans are accepted")
}
