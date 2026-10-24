"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import type { CustomerPaymentState } from "@unitravel/contracts"
import { PaymentState } from "@unitravel/ui/product/payment-state"
import { LoadingState } from "@unitravel/ui/product/states"

import { Ltr } from "@/components/badges"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

const GIVE_UP_MS = 90_000

/**
 * Where Stripe sends the customer back. The URL carries no proof: this page only reads our database through the API
 * (ADR-0007 P7) and keeps asking while the confirmation (the signed webhook) is still on its way.
 */
export default function PayReturnPage() {
  const { number } = useParams<{ number: string }>()
  const { t, href } = useI18n()
  const { me } = useRequireSignIn()
  const [startedAt] = useState(() => Date.now())
  const [, tick] = useState(0)
  const q = useQuery({
    queryKey: ["pay-return", number], enabled: !!me, retry: false,
    queryFn: () => api<CustomerPaymentState>(`/v1/billing/invoices/${encodeURIComponent(number)}/payment`),
    refetchInterval: (query) => (query.state.data?.invoiceStatus === "ISSUED" && query.state.data.session?.status === "OPEN" ? 2000 : false),
  })
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(i) }, [])
  const s = q.data
  const waited = Date.now() - startedAt > GIVE_UP_MS
  const view = !s ? "loading" : s.invoiceStatus === "PAID" ? "paid" : s.session?.status === "FAILED" ? "failed" : s.session?.status === "EXPIRED" ? "expired" : s.invoiceStatus !== "ISSUED" ? "closed" : waited ? "waiting" : "confirming"
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <section className="card-brand p-5 md:p-7" data-testid="pay-return" data-state={view}>
        <h1 className="font-display text-2xl md:text-3xl">{t("billing.pay.returnTitle")}{s && <> <Ltr className="font-mono">{s.invoiceNumber}</Ltr></>}</h1>
        {view === "loading" && <LoadingState className="mt-6" label={t("common.loading")} rows={1} />}
        {view === "confirming" && <PaymentState className="mt-4" kind="processing" body={t("billing.pay.confirming")} />}
        {view === "paid" && <PaymentState className="mt-4" kind="paid" body={t("billing.pay.confirmed")} />}
        {view === "failed" && <PaymentState className="mt-4" kind="failed" body={t("billing.pay.failed")} />}
        {view === "expired" && <PaymentState className="mt-4" kind="expired" body={t("billing.pay.expired")} />}
        {view === "waiting" && <PaymentState className="mt-4" kind="processing" body={t("billing.pay.stillWaiting")} />}
        {view === "closed" && <PaymentState className="mt-4" kind="closed" body={t("billing.pay.closed")} />}
        <div className="mt-6 flex flex-wrap gap-4 text-sm font-semibold">
          {(view === "failed" || view === "expired") && <Link href={href(`/billing/${number}/pay`)} className="underline">{t("billing.pay.tryAgain")}</Link>}
          <Link href={href(`/billing/${number}`)} className="underline">{t("billing.pay.backToInvoice")}</Link>
        </div>
      </section>
    </div>
  )
}
