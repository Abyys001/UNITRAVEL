import { describe, expect, it } from "vitest"

import { faq, flightGuide, hotelGuide, type Item, travelRules, visibleItems } from "./index"

const pages = { faq, travelRules, flightGuide, hotelGuide }
const strings = (i: Item) => [i.heading, ...i.blocks.flatMap((b) => (b.kind === "ol" || b.kind === "ul" ? b.items : b.kind === "link" ? [b.text, b.href] : b.kind === "dl" ? b.items.flatMap((t) => [t.term, t.text]) : [b.text]))]

describe("long-form content (Phase H)", () => {
  for (const [name, c] of Object.entries(pages)) {
    it(`${name}: en and fa have the same ids, flags and block shapes`, () => {
      expect(c.fa.map((i) => i.id)).toEqual(c.en.map((i) => i.id))
      expect(new Set(c.en.map((i) => i.id)).size).toBe(c.en.length)
      const shape = (i: Item) => [i.flag, i.blocks.map((b) => [b.kind, b.flag, b.kind === "p" || b.kind === "link" ? 1 : b.items.length, b.kind === "dl" ? b.items.map((t) => t.code ?? null) : null])]
      expect(c.fa.map(shape)).toEqual(c.en.map(shape))
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

  it("hotel page: 15 sections; service claims are hidden until hotels.enabled; guide sections always show", () => {
    expect(hotelGuide.en.length).toBe(15)
    const off = visibleItems(hotelGuide.en).map((i) => i.id)
    expect(off).toEqual(["cheap", "price-factors", "types", "stars", "rooms", "meals", "terms", "tips"])
    expect(visibleItems(hotelGuide.en, { "hotels.enabled": true }).length).toBe(15)
    const steps = hotelGuide.en.find((i) => i.id === "steps")!.blocks[0]!
    expect(steps.kind === "ol" && steps.items.length).toBe(5)
  })

  it("hotel page makes no claim the platform cannot keep", () => {
    const all = JSON.stringify(hotelGuide)
    for (const banned of [/24\s*\/\s*7/, /۲۴\s*\/\s*۷/, /cheapest site/i, /ارزان‌?ترین\s*(و|سایت)/, /flytoday|فلای تو ?دی/i, /instantly|بصورت آنی|به‌صورت آنی/]) expect(all).not.toMatch(banned)
  })
})
