"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, Send } from "lucide-react"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import type { FlightRequestCustomerView, QuoteView, TravellerView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { Textarea } from "@unitravel/ui/components/textarea"

import { Ltr } from "@/components/badges"
import { ItineraryView } from "@/components/itinerary-view"
import { StatusTimeline } from "@/components/status-timeline"
import { TravellerForm } from "@/components/traveller-form"
import { api, ApiError, newIdempotencyKey } from "@/lib/api"
import { download } from "@/lib/documents"
import { useI18n } from "@/lib/i18n"
import { cacheGet, cacheSet, useRequireSignIn } from "@/lib/use-auth-redirect"

function QuoteCard({ q, ref, canAccept, onDone }: { q: QuoteView; ref: string; canAccept: boolean; onDone: () => void }) {
  const { t, money, date, clock, sep } = useI18n()
  const accept = useMutation({ mutationFn: (optionId: string) => api(`/v1/flight-requests/${ref}/quotes/${q.id}/accept`, { body: { optionId }, headers: { "idempotency-key": newIdempotencyKey() } }), onSuccess: onDone, onError: (e) => toast.error((e as ApiError).problem.detail ?? (e as Error).message) })
  const decline = useMutation({ mutationFn: () => api(`/v1/flight-requests/${ref}/quotes/${q.id}/decline`, { body: {} }), onSuccess: onDone })
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate">{q.status === "SENT" ? t("requests.validUntil", { time: date(q.validUntil!, { withTime: true }) }) : q.status}</p>
      {q.options.map((o) => {
        const segs = o.slices.flatMap((s) => s.segments)
        return (
          <article key={o.id} className={`rounded-lg border bg-white p-4 ${q.acceptedOptionId === o.id ? "border-moss" : "border-border"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{o.label}</h3>
                <ul className="mt-1 text-sm text-slate">{segs.map((s, i) => <li key={i}><Ltr>{s.marketing.carrier}{s.marketing.flightNumber}{sep}{s.origin.iata} {clock(s.departure.local)} → {s.destination.iata} {clock(s.arrival.local)}</Ltr>{sep}{date(s.departure.utc, { dateOnly: true, timeZone: s.departure.tz })}</li>)}</ul>
              </div>
              <p className="font-display text-2xl">{money(o.priceBreakdown.total)}</p>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline text-slate">{t("itinerary.baggage")}: </dt><dd className="inline">{o.baggage.map((b) => (b.checked.status === "KNOWN" ? (b.checked.value.pieces ? `${b.checked.value.pieces}×${b.checked.value.kgPerPiece ?? ""}kg` : "—") : "?")).join(" / ")}</dd></div>
              <div><dt className="inline text-slate">{t("truth.sources")}: </dt><dd className="inline">{o.source === "MANUAL" ? t("truth.MANUAL") : o.ticketingModel === "SEPARATE_TICKETS" ? t("truth.SEPARATE_TICKETS") : t("truth.SINGLE_TICKET")}</dd></div>
              {(["change", "refund"] as const).map((k) => <div key={k}><dt className="inline text-slate">{t(k === "change" ? "itinerary.change" : "itinerary.refund")}: </dt><dd className="inline">{o.conditions[k].status === "KNOWN" ? (o.conditions[k].value.allowed ? (o.conditions[k].value.penalty ? t("itinerary.allowedFee", { fee: money(o.conditions[k].value.penalty!) }) : t("itinerary.allowed")) : t("itinerary.notAllowed")) : "—"}</dd></div>)}
              <div className="sm:col-span-2 text-xs text-slate">{money(o.priceBreakdown.fare)} + {money(o.priceBreakdown.taxes)} + {money(o.priceBreakdown.serviceFee)}</div>
            </dl>
            {q.status === "SENT" && canAccept && <Button className="mt-3" onClick={() => accept.mutate(o.id)} disabled={accept.isPending}>{t("requests.accept")}</Button>}
          </article>
        )
      })}
      {q.status === "SENT" && <button className="text-sm text-slate underline" onClick={() => decline.mutate()}>{t("requests.decline")}</button>}
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
  const q = useQuery({ queryKey: ["request", ref], queryFn: async () => { const r = await api<FlightRequestCustomerView>(`/v1/flight-requests/${ref}`); cacheSet(`request:${ref}`, r); return r }, enabled: !!me, refetchInterval: 20_000 })
  const travellers = useQuery({ queryKey: ["travellers"], queryFn: () => api<TravellerView[]>("/v1/me/travellers"), enabled: !!me })
  const send = useMutation({ mutationFn: () => api(`/v1/flight-requests/${ref}/messages`, { body: { body: msg } }), onSuccess: () => { setMsg(""); void q.refetch() } })
  const cancel = useMutation({ mutationFn: () => api(`/v1/flight-requests/${ref}/cancel`, { body: {} }), onSuccess: () => void q.refetch() })
  const cached = !q.data && q.isError ? cacheGet<FlightRequestCustomerView>(`request:${ref}`) : null
  const r = q.data ?? cached?.data
  if (!r) return <div className="mx-auto max-w-4xl p-6">{q.isError ? (q.error as ApiError).message : <div className="h-64 animate-pulse rounded-lg bg-muted" />}</div>
  const missing = r.travellers.filter((x) => !x.documentComplete)
  const openQuote = r.quotes.find((x) => x.status === "SENT") ?? r.quotes[0]
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {cached && <p className="mb-4 rounded bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-fg">{t("requests.offline")} {t("requests.lastUpdated", { time: date(cached.at, { withTime: true }) })}</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="font-mono text-sm text-slate" dir="ltr">{r.ref}</p><h1 className="font-display text-3xl">{r.routeLabel}</h1></div>
        <span className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper">{r.statusLabel}</span>
      </div>
      {r.reservation && <p className="mt-3 text-sm text-moss">{t("requests.reservedUntil", { time: date(r.reservation.ticketingDeadline, { withTime: true }) })}</p>}
      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="space-y-8">
          {r.actions.includes("PROVIDE_PASSPORT") && missing.length > 0 && (
            <section className="rounded-lg border border-copper bg-accent p-4">
              <p className="font-medium">{t("requests.passportNeeded")}</p>
              <div className="mt-2 flex flex-wrap gap-2">{missing.map((m) => <Button key={m.travellerId} variant="outline" size="sm" onClick={() => setPassport(m.travellerId)}>{t("requests.provide")}{sep}{m.name}</Button>)}</div>
              {passport && <div className="mt-3"><TravellerForm withDocument initial={travellers.data?.find((x) => x.id === passport)} onSaved={() => { setPassport(null); void q.refetch() }} /></div>}
            </section>
          )}
          {openQuote && <section><h2 className="mb-3 text-xl font-semibold">{t("requests.quotes")}</h2><QuoteCard q={openQuote} ref={r.ref} canAccept={!missing.length} onDone={() => void qc.invalidateQueries({ queryKey: ["request", ref] })} /></section>}
          {r.tickets.length > 0 && (
            <section><h2 className="mb-3 text-xl font-semibold">{t("requests.tickets")}</h2>
              <ul className="space-y-2">{r.tickets.map((tk) => <li key={tk.ticketNumber} className="flex items-center justify-between rounded-md border border-moss/50 bg-success-subtle px-3 py-2 text-sm"><span>{tk.travellerName}{sep}<Ltr className="font-mono">{tk.ticketNumber}</Ltr>{sep}{tk.validatingCarrier}</span>{tk.documentId && <button onClick={() => void download(tk.documentId!)} className="flex items-center gap-1 underline"><Download className="size-3.5" />{t("requests.download")}</button>}</li>)}</ul>
            </section>
          )}
          <section>
            <h2 className="mb-3 text-xl font-semibold">{t("requests.messages")}</h2>
            <ul className="space-y-3">
              {r.messages.map((m) => (
                <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.direction === "TO_CUSTOMER" ? "bg-white border border-border" : "ms-auto bg-ink text-paper"}`}>
                  <p className="whitespace-pre-wrap">{m.body}</p><p className="mt-1 text-[11px] opacity-70">{m.authorName}{sep}{date(m.createdAt, { withTime: true })}</p>
                </li>
              ))}
            </ul>
            {r.actions.includes("MESSAGE") && (
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) send.mutate() }}>
                <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("requests.writeMessage")} className="min-h-11" aria-label={t("requests.writeMessage")} />
                <Button type="submit" disabled={send.isPending || !msg.trim()} aria-label={t("requests.send")}><Send className="size-4 rtl:-scale-x-100" /></Button>
              </form>
            )}
          </section>
          {r.snapshot && <section><h2 className="mb-3 text-xl font-semibold">{t("requests.snapshot")}</h2><ItineraryView it={r.snapshot.itinerary} /></section>}
        </div>
        <aside className="space-y-6">
          <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate">{t("requests.timeline")}</h2><StatusTimeline items={r.timeline} /></section>
          {r.documents.length > 0 && (
            <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate">{t("requests.documents")}</h2>
              <ul className="space-y-1 text-sm">{r.documents.map((d) => <li key={d.id}><button className="flex items-center gap-1.5 underline underline-offset-4" onClick={() => void download(d.id)}><Download className="size-3.5" />{d.filename}</button></li>)}</ul>
            </section>
          )}
          <section className="text-sm text-slate">{r.travellers.map((x) => <p key={x.travellerId}>{x.name}{sep}{x.passengerType}{sep}{x.documentComplete ? t("account.documentComplete") : t("account.documentMissing")}</p>)}</section>
          {r.actions.includes("CANCEL") && (confirmCancel
            ? <div className="rounded-md border border-brick/40 p-3 text-sm"><p>{t("requests.cancelConfirm")}</p><div className="mt-2 flex gap-2"><Button variant="destructive" size="sm" onClick={() => cancel.mutate()}>{t("common.yes")}</Button><Button variant="outline" size="sm" onClick={() => setConfirmCancel(false)}>{t("common.no")}</Button></div></div>
            : <Button variant="outline" onClick={() => setConfirmCancel(true)}>{t("requests.cancel")}</Button>)}
        </aside>
      </div>
    </div>
  )
}
