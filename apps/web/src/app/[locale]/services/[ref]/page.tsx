"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { Send } from "lucide-react"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import type { CustomerServiceRequestView, TravellerView } from "@unitravel/contracts"
import type { MessageKey } from "@unitravel/i18n"
import { Button } from "@unitravel/ui/components/button"
import { Textarea } from "@unitravel/ui/components/textarea"
import { ErrorState, LoadingState } from "@unitravel/ui/product/states"

import { Auto, Ltr } from "@/components/badges"
import { StatusTimeline } from "@/components/status-timeline"
import { api, ApiError } from "@/lib/api"
import { countryName } from "@/lib/countries"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

/** Readable rows for the request details; only fields the customer entered, labelled in the UI language. */
function DetailRows({ r }: { r: CustomerServiceRequestView }) {
  const { t, date, locale } = useI18n()
  const travellers = useQuery({ queryKey: ["travellers"], queryFn: () => api<TravellerView[]>("/v1/me/travellers"), enabled: Array.isArray(r.details.travellerIds) })
  const d = r.details as Record<string, unknown>
  const s = (k: string) => (typeof d[k] === "string" || typeof d[k] === "number" ? String(d[k]) : "")
  const day = (k: string) => (s(k) ? date(s(k), { dateOnly: true, year: true }) : "")
  const rows: [MessageKey, React.ReactNode][] = []
  const add = (k: MessageKey, v: React.ReactNode) => { if (v) rows.push([k, v]) }
  add("services.destinationCountry", s("destinationCountry") && countryName(s("destinationCountry"), locale))
  add("services.purpose", s("purpose") && t(`services.purposes.${s("purpose")}` as MessageKey))
  add("services.intendedTravelDate", day("intendedTravelDate"))
  add("services.linkedFlight", s("linkedFlightRequestRef") && <Ltr className="font-mono">{s("linkedFlightRequestRef")}</Ltr>)
  add("services.destination", s("destination") && <Auto>{s("destination")}</Auto>)
  add("services.approxDates", s("approxDates") && <Auto>{s("approxDates")}</Auto>)
  add("services.travellersCount", s("travellersCount"))
  add("services.bestTimeToCall", s("bestTimeToCall") && <Auto>{s("bestTimeToCall")}</Auto>)
  add("services.airport", s("airport") === "IKA" && t("services.airportIka"))
  add("services.direction", s("direction") && t(`services.directions.${s("direction")}` as MessageKey))
  add("services.flightNumber", s("flightNumber") && <Ltr className="font-mono">{s("flightNumber")}</Ltr>)
  add("services.date", day("date"))
  add("services.passengersCount", s("passengersCount"))
  add("services.region", s("destinationRegion") && t(`services.regions.${s("destinationRegion")}` as MessageKey))
  add("services.startDate", day("startDate"))
  add("services.endDate", day("endDate"))
  add("services.location", s("location") && <Auto>{s("location")}</Auto>)
  add("services.checkIn", day("checkIn"))
  add("services.checkOut", day("checkOut"))
  add("services.guests", s("guests"))
  add("services.rooms", s("rooms"))
  add("services.from", s("from") && <Auto>{s("from")}</Auto>)
  add("services.to", s("to") && <Auto>{s("to")}</Auto>)
  add("services.passengers", s("passengers"))
  const ids = Array.isArray(d.travellerIds) ? (d.travellerIds as string[]) : []
  const names = ids.map((id) => travellers.data?.find((x) => x.id === id)).filter((x): x is TravellerView => !!x).map((x) => (locale === "fa" && x.nameFa ? x.nameFa : `${x.givenNames} ${x.surname}`))
  add("services.travellers", names.length > 0 && <Auto>{names.join(locale === "fa" ? "، " : ", ")}</Auto>)
  add("services.note", s("note") && <span className="whitespace-pre-wrap" dir="auto">{s("note")}</span>)
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-steel">{t(k)}</dt><dd className="font-medium">{v}</dd></div>)}
    </dl>
  )
}

export default function ServiceRequestDetail() {
  const { ref } = useParams<{ ref: string }>()
  const { t, date, money, sep } = useI18n()
  const { me } = useRequireSignIn()
  const [msg, setMsg] = useState("")
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [justSent, setJustSent] = useState(false)
  useEffect(() => {
    try { if (sessionStorage.getItem(`sent:${ref}`)) { setJustSent(true); sessionStorage.removeItem(`sent:${ref}`) } } catch { /* storage unavailable */ }
  }, [ref])
  const q = useQuery({ queryKey: ["service-request", ref], queryFn: () => api<CustomerServiceRequestView>(`/v1/service-requests/${ref}`), enabled: !!me, refetchInterval: 20_000 })
  const send = useMutation({ mutationFn: () => api(`/v1/service-requests/${ref}/messages`, { body: { body: msg, documentIds: [] } }), onSuccess: () => { setMsg(""); void q.refetch() } })
  const cancel = useMutation({ mutationFn: () => api(`/v1/service-requests/${ref}/cancel`, { body: {} }), onSuccess: () => { setConfirmCancel(false); void q.refetch() } })
  const accept = useMutation({ mutationFn: () => api(`/v1/service-requests/${ref}/quote/accept`, { body: {} }), onSuccess: () => void q.refetch() })
  const r = q.data
  if (!r) return <div className="mx-auto max-w-4xl px-4 py-8">{q.isError ? <ErrorState title={t("requests.loadFailed")} body={(q.error as ApiError).message} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} /> : <LoadingState label={t("common.loading")} rows={4} />}</div>
  const quote = r.quote
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      {justSent && <div role="status" data-testid="request-sent" className="mb-4 rounded-xl border-s-4 border-success bg-success-subtle px-4 py-3 text-sm"><p className="font-semibold">{t("services.sentTitle")}</p><p>{t("services.sentBody", { ref: r.ref })}</p></div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="font-mono text-sm font-medium text-steel" dir="ltr">{r.ref}</p><h1 className="font-display text-3xl md:text-4xl">{t(`services.types.${r.type}`)}</h1></div>
        <span className="rounded-full bg-navy-950 px-4 py-1.5 text-sm font-semibold text-white" data-testid="service-status">{t(`services.status.${r.status}`)}</span>
      </div>
      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="space-y-8">
          {quote && (
            <section className="card-brand p-5" data-testid="service-quote">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-xl">{t("services.quote")}</h2>
                <span className="rounded-full border border-navy-900/30 bg-cloud px-3 py-1 text-xs font-semibold text-navy-900">{t(`services.quoteStatus.${quote.status}`)}</span>
              </div>
              {quote.quotationNumber && <p className="mt-1 text-xs text-steel"><Ltr className="font-mono">{quote.quotationNumber}</Ltr></p>}
              <table className="mt-4 w-full text-sm">
                <tbody className="divide-y divide-line">
                  {quote.lines.map((l, i) => (
                    <tr key={i}><td className="py-2"><Auto>{l.label}</Auto><span className="block text-xs text-steel">{t(`services.lines.${l.kind}`)}</span></td><td className="py-2 text-end tabular-nums">{l.kind === "CLUB_DISCOUNT" ? "−" : ""}{money(l.amount)}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-navy-950"><th scope="row" className="py-2 text-start">{t("services.total")}</th><td className="py-2 text-end text-lg font-bold tabular-nums">{money(quote.total)}</td></tr></tfoot>
              </table>
              {quote.note && <p className="mt-3 whitespace-pre-wrap text-sm text-steel" dir="auto">{quote.note}</p>}
              <p className="mt-3 text-sm text-steel">{t("services.validUntil", { time: date(quote.validUntil, { withTime: true }) })}</p>
              {r.canAcceptQuote && (
                <div className="mt-4">
                  <p className="mb-2 text-sm">{t("services.acceptHint")}</p>
                  <button className="btn-orange" onClick={() => accept.mutate()} disabled={accept.isPending}>{t("services.accept")}</button>
                  {accept.error && <p role="alert" className="mt-2 text-sm text-danger">{(accept.error as ApiError).message}</p>}
                </div>
              )}
            </section>
          )}
          <section><h2 className="font-display mb-3 text-xl">{t("services.details")}</h2><div className="card-brand p-5"><DetailRows r={r} /></div></section>
          <section>
            <h2 className="font-display mb-3 text-xl">{t("requests.messages")}</h2>
            <ul className="space-y-3">
              {r.messages.map((m) => (
                <li key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.direction === "TO_CUSTOMER" ? "card-brand !rounded-2xl" : "ms-auto bg-navy-950 text-white"}`}>
                  <p className="whitespace-pre-wrap" dir="auto">{m.body}</p><p className="mt-1 text-xs opacity-70"><Auto>{m.authorName}</Auto>{sep}{date(m.createdAt, { withTime: true })}</p>
                </li>
              ))}
            </ul>
            {!["COMPLETED", "CANCELLED", "CLOSED_NO_RESPONSE", "DECLINED"].includes(r.status) && (
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) send.mutate() }}>
                <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("requests.writeMessage")} className="min-h-11 rounded-xl bg-cloud" aria-label={t("requests.writeMessage")} />
                <button type="submit" className="btn-orange self-end !px-4" disabled={send.isPending || !msg.trim()} aria-label={t("requests.send")}><Send className="size-4 rtl:-scale-x-100" /></button>
              </form>
            )}
          </section>
        </div>
        <aside className="space-y-6">
          <section className="card-brand p-5"><h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-steel">{t("requests.timeline")}</h2><StatusTimeline items={r.timeline} /></section>
          {r.canCancel && (confirmCancel
            ? <div className="card-brand !border-danger/40 p-4 text-sm"><p>{t("services.cancelConfirm")}</p><div className="mt-2 flex gap-2"><Button variant="destructive" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>{t("common.yes")}</Button><Button variant="outline" className="rounded-xl border-navy-900 text-navy-900" size="sm" onClick={() => setConfirmCancel(false)}>{t("common.no")}</Button></div></div>
            : <Button variant="outline" className="rounded-xl border-navy-900 text-navy-900" onClick={() => setConfirmCancel(true)}>{t("services.cancel")}</Button>)}
        </aside>
      </div>
    </div>
  )
}
