import { sql } from "drizzle-orm"

import type { Db } from "../index"
import * as s from "../schema"

// Starter catalogue (STAGE-23). Prices are 0 and hidden from customers: staff set real prices in the console,
// we do not invent Uni Travel's rates. Inactive until staff review the copy and price.
const ITEMS = [
  { code: "INSURANCE", lineType: "INSURANCE", nameEn: "Travel insurance", nameFa: "بیمه مسافرتی", perPassenger: true },
  { code: "CIP", lineType: "CIP", nameEn: "Airport CIP service", nameFa: "خدمات سی‌آی‌پی فرودگاه", perPassenger: true },
  { code: "BAGGAGE", lineType: "BAGGAGE", nameEn: "Extra baggage", nameFa: "بار اضافه", perPassenger: true },
  { code: "VISA", lineType: "VISA", nameEn: "Visa assistance", nameFa: "راهنمایی ویزا", perPassenger: true },
  { code: "TRANSFER", lineType: "TRANSFER", nameEn: "Airport transfer", nameFa: "ترانسفر فرودگاهی", perPassenger: false },
] as const

/** Inserts missing codes only, so staff edits are never overwritten. Needs an owner to be the author. */
export async function seedServiceCatalog(db: Db): Promise<number | null> {
  const owner = await db.execute(sql`select ur.user_id as id from user_roles ur join roles r on r.id = ur.role_id where r.key = 'owner' order by ur.user_id limit 1`)
  const createdBy = (owner.rows[0] as { id: string } | undefined)?.id
  if (!createdBy) return null
  const res = await db.insert(s.serviceCatalogItems)
    .values(ITEMS.map((i) => ({ ...i, defaultPriceMinor: 0, currency: "GBP", showPriceToCustomer: false, active: false, createdBy })))
    .onConflictDoNothing().returning({ id: s.serviceCatalogItems.id })
  return res.length
}
