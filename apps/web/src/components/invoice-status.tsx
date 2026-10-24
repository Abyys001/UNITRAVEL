"use client"

import type { CustomerInvoice } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"

/** Text label plus colour, never colour alone. */
export function InvoiceStatus({ status }: { status: CustomerInvoice["status"] }) {
  const { t } = useI18n()
  const tone = status === "PAID" ? "border-success text-success" : status === "ISSUED" ? "border-navy-900/30 text-navy-900" : "border-danger text-danger"
  return <span className={`rounded-full border bg-cloud px-3 py-1 text-xs font-semibold ${tone}`} data-testid="invoice-status">{t(`billing.status.${status}`)}</span>
}
