import { describe, expect, it } from "vitest"

import { stripImageMetadata, stripJpeg, stripPng, UnsupportedImageError } from "./image-sanitise"

const seg = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 255]), payload])
const EXIF = seg(0xe1, Buffer.from("Exif\0\0GPS-LATITUDE-51.5N Orientation=6 Canon"))
const XMP = seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>owner</x:xmpmeta>"))
const IPTC = seg(0xed, Buffer.from("Photoshop 3.0\0IPTC-Byline"))
const COM = seg(0xfe, Buffer.from("secret comment"))
const JFIF = seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0"))
const DQT = seg(0xdb, Buffer.alloc(65, 1))
const SOF = seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]))
const DHT = seg(0xc4, Buffer.alloc(20, 2))
const SOS = seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0]))
const DATA = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56])
const jpeg = (...parts: Buffer[]) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...parts, Buffer.from([0xff, 0xd9])])

describe("JPEG metadata stripping", () => {
  const src = jpeg(JFIF, EXIF, XMP, IPTC, COM, DQT, SOF, DHT, SOS, DATA)
  const out = stripJpeg(src)
  it("removes EXIF, XMP, IPTC and comments", () => {
    for (const needle of ["GPS-LATITUDE", "Orientation", "xmpmeta", "IPTC-Byline", "secret comment", "Canon"]) expect(out.includes(Buffer.from(needle))).toBe(false)
  })
  it("keeps the decode path and the entropy data byte for byte", () => {
    expect(out.equals(jpeg(JFIF, DQT, SOF, DHT, SOS, DATA))).toBe(true)
  })
  it("drops anything appended after the end marker", () => {
    expect(stripJpeg(Buffer.concat([src, Buffer.from("trailing-thumbnail-GPS")])).includes(Buffer.from("trailing"))).toBe(false)
  })
  it("refuses a truncated or non-JPEG file", () => {
    expect(() => stripJpeg(src.subarray(0, src.length - 12))).toThrow(UnsupportedImageError)
    expect(() => stripJpeg(Buffer.from("GIF89a"))).toThrow(UnsupportedImageError)
  })
})

const chunk = (type: string, data: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); return Buffer.concat([l, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]) }
const png = (...chunks: Buffer[]) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks])

describe("PNG metadata stripping", () => {
  const src = png(chunk("IHDR", Buffer.alloc(13)), chunk("eXIf", Buffer.from("GPS-LATITUDE")), chunk("tEXt", Buffer.from("Author\0Neda")), chunk("tIME", Buffer.alloc(7)), chunk("iCCP", Buffer.from("icc")), chunk("IDAT", Buffer.from("pixels")), chunk("IEND", Buffer.alloc(0)))
  it("drops text, time and EXIF chunks and keeps the rest", () => {
    expect(stripPng(src).equals(png(chunk("IHDR", Buffer.alloc(13)), chunk("iCCP", Buffer.from("icc")), chunk("IDAT", Buffer.from("pixels")), chunk("IEND", Buffer.alloc(0))))).toBe(true)
  })
  it("refuses a PNG without IEND", () => {
    expect(() => stripPng(png(chunk("IHDR", Buffer.alloc(13))))).toThrow(UnsupportedImageError)
  })
})

describe("dispatch", () => {
  it("decides on content, not on the declared type", () => {
    expect(stripImageMetadata(jpeg(JFIF, EXIF, DQT, SOF, SOS, DATA)).mime).toBe("image/jpeg")
    expect(() => stripImageMetadata(Buffer.from("%PDF-1.7"))).toThrow(UnsupportedImageError)
  })
})
