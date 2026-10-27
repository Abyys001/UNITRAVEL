import { describe, expect, it } from "vitest"

import { faq, flightGuide, type Item, travelRules, visibleItems } from "./index"

const pages = { faq, travelRules, flightGuide }
const strings = (i: Item) => [i.heading, ...i.blocks.flatMap((b) => (b.kind === "ol" || b.kind === "ul" ? b.items : b.kind === "link" ? [b.text, b.href] : [b.text]))]

describe("long-form content (Phase H)", () => {
  for (const [name, c] of Object.entries(pages)) {
    it(`${name}: en and fa have the same ids, flags and block shapes`, () => {
      expect(c.fa.map((i) => i.id)).toEqual(c.en.map((i) => i.id))
      expect(new Set(c.en.map((i) => i.id)).size).toBe(c.en.length)
      expect(c.fa.map((i) => [i.flag, i.blocks.map((b) => [b.kind, b.flag])])).toEqual(c.en.map((i) => [i.flag, i.blocks.map((b) => [b.kind, b.flag])]))
    })
    it(`${name}: no empty strings, and fa is Persian`, () => {
      for (const l of ["en", "fa"] as const) {
        for (const i of c[l]) {
          expect(i.id).not.toBe("")
          for (const s of strings(i)) expect(s.trim(), `${name}.${l}.${i.id}`).not.toBe("")
          expect(i.heading).toMatch(l === "fa" ? /[؀-ۿ]/ : /[A-Za-z]/)
        }
      }
    })
  }

  it("expected sizes: 5 FAQ questions, 6 rules sections, 12 guide headings", () => {
    expect([faq.en.length, travelRules.en.length, flightGuide.en.length]).toEqual([5, 6, 12])
  })

  it("guide item 1 reuses the FAQ how-to-buy blocks", () => {
    expect(flightGuide.en[0]!.blocks).toBe(faq.en.find((i) => i.id === "how-to-buy")!.blocks)
    expect(flightGuide.fa[0]!.blocks).toBe(faq.fa.find((i) => i.id === "how-to-buy")!.blocks)
  })

  it("visibleItems hides flagged items and blocks until their flag is on", () => {
    const ids = (flags = {}) => visibleItems(flightGuide.en, flags).map((i) => i.id)
    expect(ids()).not.toContain("visa")
    expect(ids()).not.toContain("insurance")
    expect(ids({ "services.visa.enabled": true })).toContain("visa")
    const payment = (flags = {}) => visibleItems(flightGuide.en, flags).find((i) => i.id === "payment-options")!.blocks.length
    expect(payment()).toBe(1)
    expect(payment({ "payments.online.enabled": true })).toBe(2)
  })
})
