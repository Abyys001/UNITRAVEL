"use client"

import { useQuery } from "@tanstack/react-query"
import { FileText, ReceiptText } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"

import type { BillingDocuments } from "@unitravel/contracts"
import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { Ltr } from "@/components/badges"
import { InvoiceStatus } from "@/components/invoice-status"
import { api } from "@/lib/api"
import { download } from "@/lib/documents"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

/** Documents & billing (ADR-0006): own quotations and invoices; amounts appear only on issued invoices, the quote itself lives on the request page. */
export default function BillingPage() {
  const { t, href, date, money, sep } = useI18n()
  const { me } = useRequireSignIn()
  const q = useQuery({ queryKey: ["billing"], queryFn: () => api<BillingDocuments>("/v1/billing/documents"), enabled: !!me, refetchInterval: 30_000 })
  const open = (id: string) => download(id).catch(() => toast.error(t("billing.openFailed")))
  const quotations = q.data?.quotations ?? []
  const invoices = q.data?.invoices ?? []
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{t("billing.title")}</h1>
      <p className="mt-1 text-steel">{t("billing.lead")}</p>
      {q.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}

      <section className="mt-8" aria-labelledby="invoices-h">
        <h2 id="invoices-h" className="font-display text-xl">{t("billing.invoices")}</h2>
        {!q.isLoading && !invoices.length && <EmptyState className="mt-3" icon={<ReceiptText />} title={t("billing.emptyInvoices")} />}
        <ul className="mt-3 space-y-3">
          {invoices.map((i) => (
            <li key={i.number} className="card-brand flex flex-wrap items-center justify-between gap-3 p-4" data-testid="invoice-row">
              <Link href={href(`/billing/${i.number}`)} className="min-w-full rounded-lg sm:min-w-0 sm:flex-1 focus-visible:outline-2 focus-visible:outline-orange">
                <span className="block font-display text-lg"><Ltr className="font-mono">{i.number}</Ltr></span>
                <span className="text-xs text-steel"><Ltr className="font-mono">{i.requestRef}</Ltr>{sep}{t("billing.issued")} {date(i.issuedAt, { dateOnly: true })}</span>
              </Link>
              <span className="font-display text-lg" data-testid="invoice-total">{money(i.total)}</span>
              <InvoiceStatus status={i.status} />
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="quotes-h">
        <h2 id="quotes-h" className="font-display text-xl">{t("billing.quotations")}</h2>
        {!q.isLoading && !quotations.length && <EmptyState className="mt-3" icon={<FileText />} title={t("billing.emptyQuotations")} />}
        <ul className="mt-3 space-y-3">
          {quotations.map((x) => (
            <li key={x.number} className="card-brand flex flex-wrap items-center justify-between gap-3 p-4" data-testid="quotation-row">
              <div className="min-w-full sm:min-w-0 sm:flex-1">
                <span className="block font-display text-lg"><Ltr className="font-mono">{x.number}</Ltr></span>
                <span className="text-xs text-steel"><Ltr className="font-mono">{x.requestRef}</Ltr>{sep}{t("billing.sent")} {date(x.sentAt, { dateOnly: true })}{x.validUntil && <>{sep}{t("billing.validUntil")} {date(x.validUntil, { withTime: true })}</>}</span>
              </div>
              <span className="rounded-full border border-navy-900/30 bg-cloud px-3 py-1 text-xs font-semibold text-navy-900">{t(`billing.quoteStatus.${x.status}`)}</span>
              <div className="flex gap-4 text-sm font-semibold">
                <Link href={href(x.productType === "FLIGHT" ? `/requests/${x.requestRef}` : `/cargo/${x.requestRef}`)} className="inline-flex items-center underline focus-visible:outline-2 focus-visible:outline-orange pointer-coarse:min-h-11">{t("billing.viewQuote")}</Link>
                {x.documentId && <button type="button" onClick={() => open(x.documentId!)} className="inline-flex items-center underline focus-visible:outline-2 focus-visible:outline-orange pointer-coarse:min-h-11">{t("billing.download")}</button>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
