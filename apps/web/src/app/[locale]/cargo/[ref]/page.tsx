"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { Download, MapPin } from "lucide-react"
import { useParams } from "next/navigation"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { Textarea } from "@unitravel/ui/components/textarea"

import { StatusTimeline } from "@/components/status-timeline"
import { api, ApiError } from "@/lib/api"
import { download } from "@/lib/documents"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

interface CargoView { ref: string; status: string; statusLabel: string; service: string; lane: { label: string }; weights: { actualKg: number; volumetricKg: number; chargeableKg: number }; timeline: { at: string; label: string }[]; tracking: { id: string; eventCode: string; location: string; occurredAt: string; description?: string }[]; quotes: { id: string; status: string; validUntil: string | null; lines: Record<string, { amountMinor: number; currency: string } | string | boolean | object>; transitNote: string | null }[]; messages: { id: string; direction: string; body: string; authorName: string; createdAt: string }[]; documents: { id: string; filename: string }[]; booking: { awbNumber: string | null } | null; actions: string[]; notice: string | null }

export default function CargoDetail() {
  const { ref } = useParams<{ ref: string }>()
  const { t, date, money, sep } = useI18n()
  const { me } = useRequireSignIn()
  const [msg, setMsg] = useState("")
  const q = useQuery({ queryKey: ["cargo", ref], queryFn: () => api<CargoView>(`/v1/cargo-requests/${ref}`), enabled: !!me, refetchInterval: 20_000 })
  const accept = useMutation({ mutationFn: (id: string) => api(`/v1/cargo-requests/${ref}/quotes/${id}/accept`, { body: {} }), onSuccess: () => void q.refetch() })
  const send = useMutation({ mutationFn: () => api(`/v1/cargo-requests/${ref}/messages`, { body: { body: msg } }), onSuccess: () => { setMsg(""); void q.refetch() } })
  const r = q.data
  if (!r) return <div className="mx-auto max-w-4xl p-6">{q.isError ? (q.error as ApiError).message : <div className="h-64 animate-pulse rounded-lg bg-muted" />}</div>
  const quote = r.quotes.find((x) => x.status === "SENT")
  const L = (k: string) => (t as (k: string) => string)(`cargo.quoteLines.${k}`)
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="font-mono text-sm text-slate" dir="ltr">{r.ref}</p><h1 className="font-display text-3xl">{r.lane.label}</h1><p className="text-slate">{t(`cargo.${r.service}` as never)}{sep}{t("cargo.weights", { actual: r.weights.actualKg, vol: r.weights.volumetricKg, charge: r.weights.chargeableKg })}</p></div>
        <span className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper">{r.statusLabel}</span>
      </div>
      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="space-y-8">
          {quote && (
            <section className="rounded-lg border border-border bg-white p-4">
              <h2 className="text-xl font-semibold">{t("requests.quotes")}</h2>
              <p className="text-sm text-slate">{quote.validUntil && t("requests.validUntil", { time: date(quote.validUntil, { withTime: true }) })}{quote.transitNote ? `${sep}${quote.transitNote}` : ""}</p>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                {(["fuelSurcharge", "securitySurcharge", "handling", "customsBrokerage", "insurance", "pickup", "delivery"] as const).map((k) => { const v = quote.lines[k] as { amountMinor: number; currency: string }; return v && v.amountMinor > 0 ? <div key={k} className="contents"><dt className="text-slate">{L(({ fuelSurcharge: "fuel", securitySurcharge: "security", handling: "handling", customsBrokerage: "customs", insurance: "insurance", pickup: "pickup", delivery: "delivery" } as const)[k])}</dt><dd>{money(v)}</dd></div> : null })}
                <dt className="text-slate">{L("freight")}</dt><dd>{money((quote.lines.freight as { amount: { amountMinor: number; currency: string } }).amount)}</dd>
                <dt className="text-slate">{L("duties")}</dt><dd>{quote.lines.dutiesTaxes === "PAYABLE_BY_CONSIGNEE" ? L("payableByConsignee") : money(quote.lines.dutiesTaxes as never)}</dd>
                <dt className="font-semibold">{t("requests.total")}</dt><dd className="font-display text-xl">{money(quote.lines.total as never)}</dd>
              </dl>
              {r.actions.includes("ACCEPT_QUOTE") && <Button className="mt-3" onClick={() => accept.mutate(quote.id)} disabled={accept.isPending}>{t("requests.accept")}</Button>}
            </section>
          )}
          <section><h2 className="mb-3 text-xl font-semibold">{t("cargo.tracking")}{r.booking?.awbNumber && <span className="ms-2 font-mono text-sm text-slate" dir="ltr">AWB {r.booking.awbNumber}</span>}</h2>
            <ol className="space-y-2">{r.tracking.map((e) => <li key={e.id} className="flex gap-3 rounded-md border border-border bg-white px-3 py-2 text-sm"><MapPin className="mt-0.5 size-4 text-copper-700" /><span><span className="font-medium">{e.eventCode}</span>{sep}{e.location}<span className="block text-xs text-slate">{date(e.occurredAt, { withTime: true })}{e.description ? `${sep}${e.description}` : ""}</span></span></li>)}</ol>
          </section>
          <section><h2 className="mb-3 text-xl font-semibold">{t("requests.messages")}</h2>
            <ul className="space-y-3">{r.messages.map((m) => <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.direction === "TO_CUSTOMER" ? "border border-border bg-white" : "ms-auto bg-ink text-paper"}`}><p>{m.body}</p><p className="mt-1 text-[11px] opacity-70">{m.authorName}{sep}{date(m.createdAt, { withTime: true })}</p></li>)}</ul>
            {r.actions.includes("MESSAGE") && <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) send.mutate() }}><Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("requests.writeMessage")} /><Button type="submit">{t("requests.send")}</Button></form>}
          </section>
        </div>
        <aside className="space-y-6">
          <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate">{t("requests.timeline")}</h2><StatusTimeline items={r.timeline} /></section>
          {r.documents.length > 0 && <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate">{t("requests.documents")}</h2><ul className="space-y-1 text-sm">{r.documents.map((d) => <li key={d.id}><button className="flex items-center gap-1.5 underline" onClick={() => void download(d.id)}><Download className="size-3.5" />{d.filename}</button></li>)}</ul></section>}
          {r.notice && <p className="text-sm text-slate">{r.notice}</p>}
        </aside>
      </div>
    </div>
  )
}
