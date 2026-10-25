"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Download, Send } from "lucide-react"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import type { FlightRequestCustomerView, QuoteView, TravellerView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { Textarea } from "@unitravel/ui/components/textarea"
import { DocumentCard } from "@unitravel/ui/product/document-card"
import { ErrorState, LoadingState } from "@unitravel/ui/product/states"
import { Stepper } from "@unitravel/ui/product/stepper"

import { Auto, Ltr, RouteLabel } from "@/components/badges"
import { ConfirmAccept } from "@/components/confirm-accept"
import { InvoiceDue } from "@/components/invoice-due"
import { BagText, ItineraryView } from "@/components/itinerary-view"
import { StatusTimeline } from "@/components/status-timeline"
import { TravellerForm } from "@/components/traveller-form"
import { api, ApiError, newIdempotencyKey } from "@/lib/api"
import { download } from "@/lib/documents"
import { useI18n } from "@/lib/i18n"
import { cacheGet, cacheSet, useRequireSignIn } from "@/lib/use-auth-redirect"

/** Position on the customer-facing path; closed requests (declined, cancelled, expired) have no progress to show. */
const STEP: Partial<Record<FlightRequestCustomerView["status"], number>> = { SUBMITTED: 0, COMPLIANCE_HOLD: 0, NEW: 0, IN_REVIEW: 1, AWAITING_CUSTOMER: 1, QUOTED: 2, ACCEPTED: 3, RESERVED: 3, TICKETED: 4, COMPLETED: 5 }
const STEP_KEYS = ["received", "review", "quote", "booked", "ticketed"] as const

function QuoteCard({ q, ref, canAccept, onDone }: { q: QuoteView; ref: string; canAccept: boolean; onDone: () => void }) {
  const { t, money, date, clock, sep } = useI18n()
  const accept = useMutation({ mutationFn: (optionId: string) => api(`/v1/flight-requests/${ref}/quotes/${q.id}/accept`, { body: { optionId }, headers: { "idempotency-key": newIdempotencyKey() } }), onSuccess: onDone, onError: (e) => toast.error((e as ApiError).problem.detail ?? (e as Error).message) })
  const decline = useMutation({ mutationFn: () => api(`/v1/flight-requests/${ref}/quotes/${q.id}/decline`, { body: {} }), onSuccess: onDone })
  return (
    <div className="space-y-3">
      <p className="text-sm text-steel">{q.status === "SENT" ? t("requests.validUntil", { time: date(q.validUntil!, { withTime: true }) }) : t(`billing.quoteStatus.${q.status}` as never)}</p>
      {q.options.map((o) => {
        const segs = o.slices.flatMap((s) => s.segments)
        return (
          <article key={o.id} aria-current={q.acceptedOptionId === o.id ? "true" : undefined} className={`card-brand p-5 ${q.acceptedOptionId === o.id ? "!border-success !border-2" : ""}`}>
            {q.acceptedOptionId === o.id && <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-3 py-1 text-xs font-bold text-success" data-testid="accepted-option"><CheckCircle2 className="size-3.5" />{t("flow.yourChoice")}</p>}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg"><Auto>{o.label}</Auto></h3>
                <ul className="mt-1 text-sm text-steel">{segs.map((s, i) => <li key={i}><Ltr>{s.marketing.carrier}{s.marketing.flightNumber}{sep}{s.origin.iata} {clock(s.departure.local)} → {s.destination.iata} {clock(s.arrival.local)}</Ltr>{sep}{date(s.departure.utc, { dateOnly: true, timeZone: s.departure.tz })}</li>)}</ul>
              </div>
              <p className="font-display text-3xl tabular-nums text-navy-900">{money(o.priceBreakdown.total)}</p>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><dt className="text-steel">{t("itinerary.baggage")}</dt><dd><ul>{segs.map((s, i) => <li key={i}><Ltr>{s.marketing.carrier}{s.marketing.flightNumber}</Ltr>{sep}<BagText b={o.baggage[i]} /></li>)}</ul></dd></div>
              <div><dt className="inline text-steel">{t("flow.ticketType")}: </dt><dd className="inline">{o.source === "MANUAL" ? t("truth.MANUAL") : o.ticketingModel === "SEPARATE_TICKETS" ? t("truth.SEPARATE_TICKETS") : t("truth.SINGLE_TICKET")}</dd></div>
              {(["change", "refund"] as const).map((k) => <div key={k}><dt className="inline text-steel">{t(k === "change" ? "itinerary.change" : "itinerary.refund")}: </dt><dd className="inline">{o.conditions[k].status === "KNOWN" ? (o.conditions[k].value.allowed ? (o.conditions[k].value.penalty ? t("itinerary.allowedFee", { fee: money(o.conditions[k].value.penalty!) }) : t("itinerary.allowed")) : t("itinerary.notAllowed")) : "—"}</dd></div>)}
            </dl>
            <p className="mt-2 text-xs text-steel"><Ltr>{money(o.priceBreakdown.fare)} + {money(o.priceBreakdown.taxes)} + {money(o.priceBreakdown.serviceFee)}</Ltr></p>
            {q.status === "SENT" && canAccept && <ConfirmAccept label={o.label} total={money(o.priceBreakdown.total)} pending={accept.isPending} onConfirm={() => accept.mutate(o.id)} />}
          </article>
        )
      })}
      {q.status === "SENT" && <button className="text-sm font-medium text-steel underline underline-offset-4 hover:text-navy-950" onClick={() => decline.mutate()}>{t("requests.decline")}</button>}
    </div>
  )
}

export default function RequestDetail() {
  const { ref } = useParams<{ ref: string }>()
  const { t, date, sep } = useI18n()
  const { me } = useRequireSignIn()
  const qc = useQueryClient()
  const [msg, setMsg] = useState("")
  const [passport, setPassport] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [justSent, setJustSent] = useState(false)
  useEffect(() => {
    try { if (sessionStorage.getItem(`sent:${ref}`)) { setJustSent(true); sessionStorage.removeItem(`sent:${ref}`) } } catch { /* storage unavailable */ }
  }, [ref])
  const q = useQuery({ queryKey: ["request", ref], queryFn: async () => { const r = await api<FlightRequestCustomerView>(`/v1/flight-requests/${ref}`); cacheSet(`request:${ref}`, r); return r }, enabled: !!me, refetchInterval: 20_000 })
  const travellers = useQuery({ queryKey: ["travellers"], queryFn: () => api<TravellerView[]>("/v1/me/travellers"), enabled: !!me })
  const send = useMutation({ mutationFn: () => api(`/v1/flight-requests/${ref}/messages`, { body: { body: msg } }), onSuccess: () => { setMsg(""); void q.refetch() } })
  const cancel = useMutation({ mutationFn: () => api(`/v1/flight-requests/${ref}/cancel`, { body: {} }), onSuccess: () => void q.refetch() })
  const cached = !q.data && q.isError ? cacheGet<FlightRequestCustomerView>(`request:${ref}`) : null
  const r = q.data ?? cached?.data
  if (!r) return <div className="mx-auto max-w-4xl px-4 py-8">{q.isError ? <ErrorState title={t("requests.loadFailed")} body={(q.error as ApiError).message} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} /> : <LoadingState label={t("common.loading")} rows={4} />}</div>
  const missing = r.travellers.filter((x) => !x.documentComplete)
  const openQuote = r.quotes.find((x) => x.status === "SENT") ?? r.quotes[0]
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      {justSent && <div role="status" data-testid="request-sent" className="mb-4 rounded-xl border-s-4 border-success bg-success-subtle px-4 py-3 text-sm"><p className="font-semibold">{t("request.sentTitle")}</p><p>{t("request.sentBody", { ref: r.ref })}</p></div>}
      {cached && <p className="mb-4 rounded-xl bg-warning-subtle px-4 py-2.5 text-sm text-warning-subtle-fg">{t("requests.offline")} {t("requests.lastUpdated", { time: date(cached.at, { withTime: true }) })}</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="font-mono text-sm font-medium text-steel" dir="ltr">{r.ref}</p><h1 className="font-display text-3xl md:text-4xl"><RouteLabel label={r.routeLabel} /></h1></div>
        <span className="rounded-full bg-navy-950 px-4 py-1.5 text-sm font-semibold text-white">{r.statusLabel}</span>
      </div>
      {STEP[r.status] !== undefined && (
        <Stepper className="mt-6" label={t("requests.progress.label")} current={STEP[r.status]!} labels={{ done: t("requests.progress.done"), current: t("requests.progress.current"), todo: t("requests.progress.todo") }}
          steps={STEP_KEYS.map((k) => ({ key: k, label: t(`requests.progress.${k}`) }))} />
      )}
      {r.reservation && <p className="mt-3 text-sm font-semibold text-success">{t("requests.reservedUntil", { time: date(r.reservation.ticketingDeadline, { withTime: true }) })}</p>}
      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="space-y-8">
          {r.actions.includes("PROVIDE_PASSPORT") && missing.length > 0 && (
            <section className="rounded-2xl border border-orange bg-warning-subtle p-5">
              <p className="font-medium">{t("requests.passportNeeded")}</p>
              <div className="mt-2 flex flex-wrap gap-2">{missing.map((m) => <Button key={m.travellerId} variant="outline" className="rounded-xl border-navy-900 text-navy-900" size="sm" onClick={() => setPassport(m.travellerId)}>{t("requests.provide")}{sep}{m.name}</Button>)}</div>
              {passport && <div className="mt-3"><TravellerForm withDocument initial={travellers.data?.find((x) => x.id === passport)} onSaved={() => { setPassport(null); void q.refetch() }} /></div>}
            </section>
          )}
          {r.status === "ACCEPTED" && <InvoiceDue requestRef={r.ref} />}
          {openQuote && <section><h2 className="font-display mb-3 text-xl">{t("requests.quotes")}</h2><QuoteCard q={openQuote} ref={r.ref} canAccept={!missing.length} onDone={() => void qc.invalidateQueries({ queryKey: ["request", ref] })} /></section>}
          {r.tickets.length > 0 && (
            <section><h2 className="font-display mb-3 text-xl">{t("requests.tickets")}</h2>
              <ul className="space-y-2">{r.tickets.map((tk) => (
                <li key={tk.ticketNumber}>
                  <DocumentCard tone="success" title={<>{tk.travellerName}{sep}<Ltr className="font-mono">{tk.ticketNumber}</Ltr></>} meta={tk.validatingCarrier}
                    actions={tk.documentId ? <button onClick={() => void download(tk.documentId!)} className="flex items-center gap-1 font-semibold underline"><Download className="size-3.5" />{t("requests.download")}</button> : undefined} />
                </li>
              ))}</ul>
            </section>
          )}
          <section>
            <h2 className="font-display mb-3 text-xl">{t("requests.messages")}</h2>
            <ul className="space-y-3">
              {r.messages.map((m) => (
                <li key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.direction === "TO_CUSTOMER" ? "card-brand !rounded-2xl" : "ms-auto bg-navy-950 text-white"}`}>
                  <p className="whitespace-pre-wrap" dir="auto">{m.body}</p><p className="mt-1 text-xs opacity-70"><Auto>{m.authorName}</Auto>{sep}{date(m.createdAt, { withTime: true })}</p>
                </li>
              ))}
            </ul>
            {r.actions.includes("MESSAGE") && (
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) send.mutate() }}>
                <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("requests.writeMessage")} className="min-h-11 rounded-xl bg-cloud" aria-label={t("requests.writeMessage")} />
                <button type="submit" className="btn-orange self-end !px-4" disabled={send.isPending || !msg.trim()} aria-label={t("requests.send")}><Send className="size-4 rtl:-scale-x-100" /></button>
              </form>
            )}
          </section>
          {r.snapshot && <section><h2 className="font-display mb-3 text-xl">{t("requests.snapshot")}</h2><ItineraryView it={r.snapshot.itinerary} /></section>}
        </div>
        <aside className="space-y-6">
          <section className="card-brand p-5"><h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-steel">{t("requests.timeline")}</h2><StatusTimeline items={r.timeline} /></section>
          {r.documents.length > 0 && (
            <section className="card-brand p-5"><h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-steel">{t("requests.documents")}</h2>
              <ul className="space-y-2">{r.documents.map((d) => <li key={d.id}><DocumentCard title={d.filename} actions={<button className="flex items-center gap-1 font-semibold underline underline-offset-4" onClick={() => void download(d.id)}><Download className="size-3.5" />{t("requests.download")}</button>} /></li>)}</ul>
            </section>
          )}
          <section className="card-brand space-y-1 p-5 text-sm text-steel">{r.travellers.map((x) => <p key={x.travellerId}><Auto>{x.name}</Auto>{sep}{t(`paxType.${x.passengerType}` as never)}{sep}{x.documentComplete ? t("account.documentComplete") : t("account.documentMissing")}</p>)}</section>
          {r.actions.includes("CANCEL") && (confirmCancel
            ? <div className="card-brand !border-danger/40 p-4 text-sm"><p>{t("requests.cancelConfirm")}</p><div className="mt-2 flex gap-2"><Button variant="destructive" size="sm" onClick={() => cancel.mutate()}>{t("common.yes")}</Button><Button variant="outline" className="rounded-xl border-navy-900 text-navy-900" size="sm" onClick={() => setConfirmCancel(false)}>{t("common.no")}</Button></div></div>
            : <Button variant="outline" className="rounded-xl border-navy-900 text-navy-900" onClick={() => setConfirmCancel(true)}>{t("requests.cancel")}</Button>)}
        </aside>
      </div>
    </div>
  )
}
