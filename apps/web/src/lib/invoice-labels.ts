import { INVOICE_LINE_TYPES, type InvoiceLineType } from "@unitravel/contracts"

import type { Locale } from "@unitravel/i18n"

// Direct-invoice line types and the staff note label (ADR-0028). Kept beside the page rather than in @unitravel/i18n,
// which another change owns; move them there when that package is next opened.
const LINE_TYPES: Record<Locale, Record<InvoiceLineType, string>> = {
  en: { VISA: "Visa", BUS: "Bus", TRAIN: "Train", HOTEL: "Hotel", STAY: "Stay", CIP: "CIP", INSURANCE: "Insurance", TOUR: "Tour", TRANSFER: "Transfer", BAGGAGE: "Baggage", OTHER: "Other", DISCOUNT: "Discount" },
  fa: { VISA: "ویزا", BUS: "اتوبوس", TRAIN: "قطار", HOTEL: "هتل", STAY: "اقامت", CIP: "سی‌آی‌پی", INSURANCE: "بیمه", TOUR: "تور", TRANSFER: "ترانسفر", BAGGAGE: "بار و چمدان", OTHER: "سایر", DISCOUNT: "تخفیف" },
}
export const lineTypeLabel = (locale: Locale, type: string | null | undefined): string | null =>
  type && (INVOICE_LINE_TYPES as readonly string[]).includes(type) ? LINE_TYPES[locale][type as InvoiceLineType] : null
export const invoiceNoteLabel = (locale: Locale) => (locale === "fa" ? "یادداشت" : "Note")
