"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"

import type { CustomerInvoice, CustomerPaymentState } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { LoadingState } from "@unitravel/ui/product/states"

import { Ltr } from "@/components/badges"
import { InvoiceStatus } from "@/components/invoice-status"
import { api, ApiError } from "@/lib/api"
import { download } from "@/lib/documents"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

/** Where the emailed or texted short link lands: sign-in first (useRequireSignIn), then the invoice if it is the signed-in customer's own. */
export default function InvoicePage() {
  const { number } = useParams<{ number: string }>()
  const { t, href, date, money, sep } = useI18n()
  const { me } = useRequireSignIn()
  const q = useQuery({
    queryKey: ["billing", number], enabled: !!me, retry: false,
    queryFn: () => api<CustomerInvoice>(`/v1/billing/invoices/${encodeURIComponent(number)}`),
  })
  const inv = q.data
  // Online payment is offered per invoice by the server (feature flag, eligibility policy, time left); the page never decides.
  const pay = useQuery({
    queryKey: ["billing", number, "payment"], enabled: !!me && inv?.status === "ISSUED", retry: false,
    queryFn: () => api<CustomerPaymentState>(`/v1/billing/invoices/${encodeURIComponent(number)}/payment`),
  })
  const notFound = q.error instanceof ApiError && q.error.problem.status === 404
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <Link href={href("/billing")} className="inline-flex items-center text-sm font-semibold underline pointer-coarse:min-h-11">{t("billing.back")}</Link>
      {q.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}
      {notFound && <p className="card-brand mt-6 p-6 text-steel" role="alert">{t("billing.notFound")}</p>}
      {inv && (
        <article className="card-brand mt-4 p-5 md:p-7" data-testid="invoice-detail">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl md:text-3xl"><Ltr className="font-mono">{inv.number}</Ltr></h1>
              <p className="mt-1 text-xs text-steel"><Ltr className="font-mono">{inv.requestRef}</Ltr>{sep}{t("billing.issued")} {date(inv.issuedAt, { dateOnly: true })}</p>
            </div>
            <InvoiceStatus status={inv.status} />
          </div>
          {inv.status === "CANCELLED" && inv.cancelReason && <p className="mt-4 rounded-xl bg-warning-subtle px-4 py-3 text-sm text-warning-subtle-fg" role="status">{t(`billing.cancelReason.${inv.cancelReason}`)}</p>}
          {inv.status === "ISSUED" && <p className="mt-4 rounded-xl bg-cloud px-4 py-3 text-sm">{t("billing.unpaidExpires", { date: date(inv.expiresAt, { withTime: true }) })}</p>}
          <h2 className="mt-6 font-display text-lg">{t("billing.charges")}</h2>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-start text-xs uppercase tracking-wide text-steel"><th className="py-2 text-start font-bold">{t("billing.description")}</th><th className="py-2 text-end font-bold">{t("billing.qty")}</th><th className="py-2 text-end font-bold">{t("billing.unit")}</th><th className="py-2 text-end font-bold">{t("billing.amount")}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {inv.lines.map((l, i) => <tr key={i}><td className="py-2">{l.description}</td><td className="py-2 text-end">{l.quantity}</td><td className="py-2 text-end">{money(l.unitAmount)}</td><td className="py-2 text-end">{money(l.amount)}</td></tr>)}
            </tbody>
            <tfoot><tr className="font-display text-lg"><td className="pt-3" colSpan={3}>{t("billing.total")}</td><td className="pt-3 text-end" data-testid="invoice-total">{money(inv.total)}</td></tr></tfoot>
          </table>
          {inv.status === "ISSUED" && pay.data?.offered && !pay.data.processing && (
            <Link href={href(`/billing/${number}/pay`)} className="mt-5 inline-flex min-h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground" data-testid="pay-online">{t("billing.pay.payOnline")}</Link>
          )}
          {inv.status === "ISSUED" && pay.data?.processing && <p className="mt-4 rounded-xl bg-cloud px-4 py-3 text-sm" role="status">{t("billing.pay.processing")}</p>}
          {inv.status === "ISSUED" && <p className="mt-4 text-sm text-steel">{t("billing.payNote")}</p>}
          {inv.documentId && <Button className="mt-6" onClick={() => download(inv.documentId!).catch(() => toast.error(t("billing.openFailed")))}>{t("billing.download")}</Button>}
        </article>
      )}
    </div>
  )
}
