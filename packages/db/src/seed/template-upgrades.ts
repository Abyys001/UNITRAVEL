import { and, eq } from "drizzle-orm"

import type { Db } from "../index"
import * as s from "../schema"
import { TEMPLATES } from "./templates"

/**
 * Seeding never overwrites a template (staff may have edited it). The `invoice.issued` email gained the
 * `{payment_instructions}` placeholder, so an existing row is upgraded only while it still equals the previous default.
 */
export async function upgradeInvoiceIssuedEmail(db: Db) {
  const t = TEMPLATES["invoice.issued"]!
  for (const locale of ["en", "fa"] as const) {
    const next = (locale === "en" ? t.emailEn : t.emailFa)!
    const previous = next.body.replace("{payment_instructions}", "")
    await db.update(s.notificationTemplates).set({ body: next.body, variables: t.vars })
      .where(and(eq(s.notificationTemplates.eventType, "invoice.issued"), eq(s.notificationTemplates.channel, "EMAIL"), eq(s.notificationTemplates.locale, locale), eq(s.notificationTemplates.body, previous)))
  }
}
