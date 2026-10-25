"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { useParams } from "next/navigation"
import { useState } from "react"

import { Textarea } from "@unitravel/ui/components/textarea"
import { ErrorState, LoadingState } from "@unitravel/ui/product/states"

import { Auto } from "@/components/badges"
import { InvoiceDue } from "@/components/invoice-due"
import { StatusTimeline } from "@/components/status-timeline"
import { type TrackingEvent, TrackingTimeline } from "@/components/tracking-timeline"
import { api, ApiError } from "@/lib/api"
import { ConfirmAccept } from "@/components/confirm-accept"
import { download } from "@/lib/documents"
import { useI18n } from "@/lib/i18n"
import { localiseRanges } from "@/lib/text"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

interface CargoView { ref: string; status: string; statusLabel: string; service: string; lane: { label: string }; weights: { actualKg: number; volumetricKg: number; chargeableKg: number }; timeline: { at: string; label: string }[]; tracking: TrackingEvent[]; estimatedDeliveryAt: string | null; quotes: { id: string; status: string; validUntil: string | null; lines: Record<string, { amountMinor: number; currency: string } | string | boolean | object>; transitNote: string | null }[]; messages: { id: string; direction: string; body: string; authorName: string; createdAt: string }[]; documents: { id: string; filename: string }[]; booking: { awbNumber: string | null } | null; actions: string[]; notice: string | null }

export default function CargoDetail() {
  const { ref } = useParams<{ ref: string }>()
  const { t, date, money, sep, locale } = useI18n()
  const { me } = useRequireSignIn()
  const [msg, setMsg] = useState("")
  const q = useQuery({ queryKey: ["cargo", ref], queryFn: () => api<CargoView>(`/v1/cargo-requests/${ref}`), enabled: !!me, refetchInterval: 20_000 })
  const accept = useMutation({ mutationFn: (id: string) => api(`/v1/cargo-requests/${ref}/quotes/${id}/accept`, { body: {} }), onSuccess: () => void q.refetch() })
  const send = useMutation({ mutationFn: () => api(`/v1/cargo-requests/${ref}/messages`, { body: { body: msg } }), onSuccess: () => { setMsg(""); void q.refetch() } })
  const r = q.data
  if (!r) return <div className="mx-auto max-w-4xl px-4 py-8">{q.isError ? <ErrorState title={t("common.error")} body={(q.error as ApiError).message} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} /> : <LoadingState label={t("common.loading")} rows={4} />}</div>
  const quote = r.quotes.find((x) => x.status === "SENT") ?? r.quotes.find((x) => x.status === "ACCEPTED")
  const accepted = quote?.status === "ACCEPTED"
  const L = (k: string) => (t as (k: string) => string)(`cargo.quoteLines.${k}`)
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="font-mono text-sm text-steel" dir="ltr">{r.ref}</p><h1 className="font-display text-3xl md:text-4xl"><Auto>{r.lane.label}</Auto></h1><p className="text-steel">{t(`cargo.${r.service}` as never)}{sep}{t("cargo.weights", { actual: r.weights.actualKg, vol: r.weights.volumetricKg, charge: r.weights.chargeableKg })}</p></div>
        <span className="rounded-full bg-navy-950 px-4 py-1.5 text-sm font-semibold text-white">{r.statusLabel}</span>
      </div>
      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="space-y-8">
          {accepted && <InvoiceDue requestRef={r.ref} />}
          {quote && (
            <section className={`card-brand p-5 ${accepted ? "!border-2 !border-success" : ""}`}>
              <h2 className="font-display text-xl">{accepted ? t("flow.acceptedCargo") : t("requests.quotes")}</h2>
              <p className="text-sm text-steel">{!accepted && quote.validUntil && t("requests.validUntil", { time: date(quote.validUntil, { withTime: true }) })}{quote.transitNote && <>{!accepted && quote.validUntil ? sep : ""}<Auto>{localiseRanges(quote.transitNote, locale)}</Auto></>}</p>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                {(["fuelSurcharge", "securitySurcharge", "handling", "customsBrokerage", "insurance", "pickup", "delivery"] as const).map((k) => { const v = quote.lines[k] as { amountMinor: number; currency: string }; return v && v.amountMinor > 0 ? <div key={k} className="contents"><dt className="text-steel">{L(({ fuelSurcharge: "fuel", securitySurcharge: "security", handling: "handling", customsBrokerage: "customs", insurance: "insurance", pickup: "pickup", delivery: "delivery" } as const)[k])}</dt><dd>{money(v)}</dd></div> : null })}
                <dt className="text-steel">{L("freight")}</dt><dd>{money((quote.lines.freight as { amount: { amountMinor: number; currency: string } }).amount)}</dd>
                <dt className="text-steel">{L("duties")}</dt><dd>{quote.lines.dutiesTaxes === "PAYABLE_BY_CONSIGNEE" ? L("payableByConsignee") : money(quote.lines.dutiesTaxes as never)}</dd>
                <dt className="font-semibold">{t("requests.total")}</dt><dd className="font-display text-xl">{money(quote.lines.total as never)}</dd>
              </dl>
              {r.actions.includes("ACCEPT_QUOTE") && <ConfirmAccept label={r.lane.label} total={money(quote.lines.total as never)} pending={accept.isPending} onConfirm={() => accept.mutate(quote.id)} />}
            </section>
          )}
          <section><h2 className="font-display mb-3 text-xl">{t("cargo.tracking")}{r.booking?.awbNumber && <span className="ms-2 font-mono text-sm text-steel" dir="ltr">AWB {r.booking.awbNumber}</span>}</h2>
            {r.estimatedDeliveryAt && <p className="mb-3 text-sm"><span className="font-semibold">{t("shipments.eta")}:</span> {date(r.estimatedDeliveryAt, { dateOnly: true })}<span className="block text-xs text-steel">{t("shipments.etaNote")}</span></p>}
            <div className="card-brand p-5"><TrackingTimeline events={r.tracking} /></div>
          </section>
          <section><h2 className="font-display mb-3 text-xl">{t("requests.messages")}</h2>
            <ul className="space-y-3">{r.messages.map((m) => <li key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.direction === "TO_CUSTOMER" ? "card-brand !rounded-2xl" : "ms-auto bg-navy-950 text-white"}`}><p dir="auto" className="whitespace-pre-wrap">{m.body}</p><p className="mt-1 text-xs opacity-70"><Auto>{m.authorName}</Auto>{sep}{date(m.createdAt, { withTime: true })}</p></li>)}</ul>
            {r.actions.includes("MESSAGE") && <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) send.mutate() }}><Textarea className="rounded-xl bg-cloud" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("requests.writeMessage")} /><button type="submit" className="btn-orange self-end">{t("requests.send")}</button></form>}
          </section>
        </div>
        <aside className="space-y-6">
          <section className="card-brand p-5"><h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-steel">{t("requests.timeline")}</h2><StatusTimeline items={r.timeline} /></section>
          {r.documents.length > 0 && <section className="card-brand p-5"><h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-steel">{t("requests.documents")}</h2><ul className="space-y-1 text-sm">{r.documents.map((d) => <li key={d.id}><button className="flex items-center gap-1.5 underline" onClick={() => void download(d.id)}><Download className="size-3.5" />{d.filename}</button></li>)}</ul></section>}
          {r.notice && <p className="text-sm text-steel">{r.notice}</p>}
        </aside>
      </div>
    </div>
  )
}
