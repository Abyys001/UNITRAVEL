import { resolve } from "node:path"

import { beforeAll, describe, expect, it } from "vitest"

import { findForbiddenKeys } from "../../testing/leak"
import { renderTemplate } from "../notifications/format"
import { InvoicesService } from "./invoices.service"

// The seed templates live outside this package's rootDir; a computed path keeps tsc from pulling them into the build.
type SeedTemplate = { vars: string[]; emailEn?: { body: string }; emailFa?: { body: string } }
let TEMPLATES: Record<string, SeedTemplate>
beforeAll(async () => {
  TEMPLATES = ((await import(/* @vite-ignore */ resolve(__dirname, "../../../../../packages/db/src/seed/templates"))) as { TEMPLATES: Record<string, SeedTemplate> }).TEMPLATES
})

type Settings = { payment: { offlineInstructions: { en: string; fa: string } | null } }
const blocks = (online: boolean, offlineInstructions: Settings["payment"]["offlineInstructions"]) =>
  InvoicesService.prototype.paymentInstructionBlocks.call({ config: { flag: () => online, settings: () => ({ payment: { offlineInstructions } }) } } as never)

const BANK = { en: "Sort code 00-00-00\nAccount 12345678\nReference: your invoice number", fa: "کد شعبه ۰۰\nحساب ۱۲۳۴۵۶۷۸\nشناسه: شماره فاکتور" }
/** The variables the router passes for `invoice.issued`; `_en`/`_fa` variants replace the plain name per recipient. */
const model = (b: { en: string; fa: string }, locale: "en" | "fa") => ({
  ref: "UT-1", number: "INV-1", expires_at_local: "10 Nov 2026", link: "https://app.example/billing/INV-1",
  services: "- Visa support x 2: GBP 100.00", total: "GBP 100.00", payment_instructions: locale === "fa" ? b.fa : b.en,
})
const render = (locale: "en" | "fa", b: { en: string; fa: string }) => {
  const t = TEMPLATES["invoice.issued"]!
  return renderTemplate((locale === "en" ? t.emailEn : t.emailFa)!.body, model(b, locale))
}

describe("invoice.issued email: bank-transfer instructions", () => {
  it("has the placeholder in both languages and declares the variable", () => {
    const t = TEMPLATES["invoice.issued"]!
    expect(t.emailEn!.body).toContain("{payment_instructions}")
    expect(t.emailFa!.body).toContain("{payment_instructions}")
    expect(t.vars).toContain("payment_instructions")
  })
  it("shows the configured instructions in the recipient's language while online payment is off", () => {
    const b = blocks(false, BANK)
    expect(render("en", b)).toContain("How to pay (bank transfer):\nSort code 00-00-00")
    expect(render("fa", b)).toContain("روش پرداخت (انتقال بانکی):\nکد شعبه ۰۰")
    expect(render("en", b)).not.toContain("{payment_instructions}")
  })
  it("says to contact us (never an invented account) when no instructions are configured", () => {
    const b = blocks(false, null)
    expect(render("en", b)).toContain("contact us")
    expect(render("fa", b)).toContain("با ما تماس بگیرید")
    expect(render("en", b)).not.toMatch(/sort code|iban/i)
  })
  it("leaves the email as before, with the pay link and no block, while online payment is on", () => {
    const b = blocks(true, BANK)
    expect(b).toEqual({ en: "", fa: "" })
    for (const locale of ["en", "fa"] as const) {
      const text = render(locale, b)
      expect(text).toContain("https://app.example/billing/INV-1")
      expect(text).not.toContain("Sort code")
      expect(text).not.toContain("{payment_instructions}")
      expect(text).not.toContain("\n\n\n")
    }
  })
  it("carries only our invoice lines and total: no market-fare or staff keys in the model, no secret-looking text in the email", () => {
    expect(findForbiddenKeys(model(blocks(false, BANK), "en"))).toEqual([])
    expect(findForbiddenKeys(model(blocks(false, BANK), "fa"))).toEqual([])
    const text = render("en", blocks(false, BANK))
    expect(text).not.toMatch(/sk_(test|live)_|whsec_|client_secret|pi_[A-Za-z0-9]{8}/)
  })
})
