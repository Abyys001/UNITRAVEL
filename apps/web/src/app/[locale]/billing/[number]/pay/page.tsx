"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import type { CheckoutSessionView, CustomerPaymentState } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { PaymentState } from "@unitravel/ui/product/payment-state"
import { ErrorState, LoadingState } from "@unitravel/ui/product/states"

import { Ltr } from "@/components/badges"
import { api, ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { mountEmbeddedCheckout } from "@/lib/stripe-js"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

/** Pay an invoice by card (ADR-0007). The amount is the invoice's; this page only asks the server for a session. */
export default function PayPage() {
  const { number } = useParams<{ number: string }>()
  const { t, href, money } = useI18n()
  const { me } = useRequireSignIn()
  const target = useRef<HTMLDivElement>(null)
  const [session, setSession] = useState<CheckoutSessionView | null>(null)
  const [mountError, setMountError] = useState(false)

  const q = useQuery({ queryKey: ["pay", number], enabled: !!me, retry: false, queryFn: () => api<CustomerPaymentState>(`/v1/billing/invoices/${encodeURIComponent(number)}/payment`) })
  const start = useMutation({
    mutationFn: () => api<CheckoutSessionView>(`/v1/billing/invoices/${encodeURIComponent(number)}/checkout-session`, { method: "POST", body: {} }),
    onSuccess: setSession,
    onError: () => void q.refetch(),
  })

  useEffect(() => {
    if (!session || session.provider !== "STRIPE" || !session.publishableKey || !target.current) return
    let destroy: (() => void) | undefined
    let cancelled = false
    mountEmbeddedCheckout(session.publishableKey, session.clientSecret, target.current).then((d) => { if (cancelled) d(); else destroy = d }).catch(() => setMountError(true))
    return () => { cancelled = true; destroy?.() }
  }, [session])

  const s = q.data
  const notFound = q.error instanceof ApiError && q.error.problem.status === 404
  const back = <Link href={href(`/billing/${number}`)} className="text-sm font-semibold underline">{t("billing.pay.backToInvoice")}</Link>
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      {back}
      {q.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}
      {notFound && <ErrorState className="mt-6" title={t("billing.notFound")} />}
      {q.isError && !notFound && <ErrorState className="mt-6" title={t("common.error")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />}
      {s && (
        <section className="card-brand mt-4 p-5 md:p-7" data-testid="pay-page">
          <h1 className="font-display text-2xl md:text-3xl">{t("billing.pay.title")} <Ltr className="font-mono">{s.invoiceNumber}</Ltr></h1>
          <p className="mt-3 text-sm text-steel">{t("billing.pay.amountDue")}</p>
          <p className="font-display text-3xl" data-testid="pay-amount">{money(s.total)}</p>
          {s.invoiceStatus === "PAID" && <PaymentState className="mt-4" kind="paid" body={t("billing.pay.alreadyPaid")} />}
          {s.invoiceStatus !== "PAID" && s.invoiceStatus !== "ISSUED" && <PaymentState className="mt-4" kind="closed" body={t("billing.pay.closed")} />}
          {s.invoiceStatus === "ISSUED" && s.processing && <PaymentState className="mt-4" kind="processing" body={t("billing.pay.processing")} />}
          {s.invoiceStatus === "ISSUED" && !s.processing && !s.offered && (
            <PaymentState className="mt-4" kind="unavailable" body={s.reasons.includes("EXPIRES_TOO_SOON") ? t("billing.pay.tooSoon") : t("billing.pay.notOffered")} />
          )}
          {s.invoiceStatus === "ISSUED" && !s.processing && s.offered && (
            <div className="mt-4">
              <p className="text-sm text-steel">{t("billing.pay.intro")}</p>
              <p className="mt-2 text-xs font-semibold text-steel" data-testid="pay-test-mode">{t("billing.pay.testMode")}</p>
              {!session && <Button className="mt-4" disabled={start.isPending} onClick={() => start.mutate()} data-testid="pay-start">{start.isPending ? t("billing.pay.loading") : t("billing.pay.start")}</Button>}
              {start.isError && !session && <p className="mt-3 text-sm text-danger" role="alert">{t("billing.pay.loadFailed")}</p>}
              {session?.provider === "STRIPE" && <div ref={target} className="mt-4" data-testid="stripe-embedded" />}
              {mountError && <p className="mt-3 text-sm text-danger" role="alert">{t("billing.pay.loadFailed")}</p>}
              {session?.provider === "FAKE" && <FakeForm session={session} number={number} />}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/** Local only: stands in for the card form. It posts to the API's FAKE simulator, which delivers a signed event to the real webhook handler. */
function FakeForm({ session, number }: { session: CheckoutSessionView; number: string }) {
  const { t, href } = useI18n()
  const [busy, setBusy] = useState(false)
  const id = session.clientSecret.split("_secret_")[0]!
  const send = async (kind: "paid" | "async_failed") => {
    setBusy(true)
    try {
      await api(`/v1/dev-sink/payments/${encodeURIComponent(id)}/deliver`, { method: "POST", body: { kind } })
      window.location.assign(href(`/billing/${number}/pay/return?session_id=${encodeURIComponent(id)}`))
    } finally { setBusy(false) }
  }
  return (
    <div className="mt-4 rounded-xl border border-dashed border-line p-4" data-testid="fake-checkout">
      <h2 className="font-display text-lg">{t("billing.pay.fakeTitle")}</h2>
      <p className="mt-1 text-sm text-steel">{t("billing.pay.fakeNote")}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => void send("paid")} data-testid="fake-pay">{t("billing.pay.fakePay")}</Button>
        <Button variant="outline" disabled={busy} onClick={() => void send("async_failed")} data-testid="fake-fail">{t("billing.pay.fakeFail")}</Button>
      </div>
    </div>
  )
}
