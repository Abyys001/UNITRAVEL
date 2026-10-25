"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import type { BillingDocuments } from "@unitravel/contracts"

import { Ltr } from "@/components/badges"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

/** After a quote is accepted: the invoice to pay, or a note that it is being prepared. Amounts come from the issued invoice only. */
export function InvoiceDue({ requestRef }: { requestRef: string }) {
  const { t, href, money } = useI18n()
  const q = useQuery({ queryKey: ["billing"], queryFn: () => api<BillingDocuments>("/v1/billing/documents"), refetchInterval: 20_000 })
  if (!q.data) return null
  const invoice = q.data.invoices.find((i) => i.requestRef === requestRef && i.status !== "CANCELLED")
  if (!invoice) return <p className="card-brand !rounded-xl px-4 py-3 text-sm" data-testid="invoice-preparing">{t("flow.invoicePreparing")}</p>
  if (invoice.status !== "ISSUED") return null
  return (
    <section className="rounded-2xl border-2 border-orange bg-warning-subtle p-5" data-testid="invoice-due">
      <p className="font-medium">{t("flow.invoiceDue", { number: invoice.number, total: money(invoice.total) })}</p>
      <Link href={href(`/billing/${invoice.number}`)} className="btn-orange mt-3 inline-flex">{t("flow.invoiceView")} <Ltr className="ms-1 font-mono">{invoice.number}</Ltr></Link>
    </section>
  )
}
