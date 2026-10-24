"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import type { Itinerary, QuoteOptionInput } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { BentoGrid, BentoTile, Stat } from "@/components/bento"
import { SliceView } from "@/components/flight/itinerary"
import { badAmounts, type DraftOption, fromInput, fromItinerary, toInput, unknowns } from "@/components/quote/model"
import { OptionEditor } from "@/components/quote/option-editor"
import { ListSkeleton } from "@/components/case"
import { ErrorLine, Field, Loading, PageHead, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, money } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import type { FlightDetail, StaffQuote } from "@/lib/types"

interface Working { quoteId: string | null; rowVersion: number | null; currency: string; validUntil: string; options: DraftOption[] }
const storeKey = (ref: string) => `ut_quote_draft_${ref}`
const toLocal = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

/** Quote builder (ch. 15.5): add options → confirm every UNKNOWN → price → validity → preview → send. */
function Builder() {
  const { ref } = useParams<{ ref: string }>()
  const params = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()
  const { can } = useSession()
  const t = useT()
  const detail = useQuery({ queryKey: ["fr-detail", ref], queryFn: () => api<FlightDetail>(`/v1/admin/flight-requests/${ref}`) })
  const [w, setW] = useState<Working | null>(null)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [blockedBy, setBlockedBy] = useState<string[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const loaded = useRef(false)

  // Working copy survives the round trip to staff search ("Add to quote") via sessionStorage.
  useEffect(() => {
    if (!detail.data || loaded.current) return
    loaded.current = true
    const stored = sessionStorage.getItem(storeKey(ref))
    const qid = params.get("quote")
    const fromServer = (q: StaffQuote): Working => ({ quoteId: q.id, rowVersion: q.rowVersion, currency: q.currency, validUntil: q.validUntil ? toLocal(q.validUntil) : "", options: q.options.map((o) => fromInput({ ...o, internalCostMinor: o.internalCostMinor ?? undefined, components: o.components ?? [] } as QuoteOptionInput)) })
    let base: Working = stored ? JSON.parse(stored) as Working : { quoteId: null, rowVersion: null, currency: "GBP", validUntil: "", options: [] }
    const serverDraft = detail.data.quotes.find((q) => q.id === qid && q.status === "DRAFT")
    if (!stored && serverDraft) base = fromServer(serverDraft)
    const add = params.get("add")
    if (add) {
      api<{ itinerary: Itinerary }>(`/v1/admin/itineraries/${encodeURIComponent(add)}`).then(({ itinerary: it }) => {
        setW({ ...base, options: [...base.options, fromInput(fromItinerary(it))] })
        router.replace(`/requests/${ref}/quote`)
        toast.success("Itinerary added to the quote")
      }, (e) => { setW(base); toast.error(errText(e)) })
    } else setW(base)
  }, [detail.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (w) sessionStorage.setItem(storeKey(ref), JSON.stringify(w)) }, [w, ref])

  if (detail.error) return <div className="p-5"><ErrorLine error={detail.error} /></div>
  if (!detail.data || !w) return <><Loading label="Opening the quote builder…" /><ListSkeleton rows={5} /></>
  const d = detail.data
  const set = (p: Partial<Working>) => { setW({ ...w, ...p }); setBlockedBy(null) }
  const addSnapshot = async () => { try { const o = await api<QuoteOptionInput>(`/v1/admin/flight-requests/${ref}/quotes/from-snapshot`); set({ options: [...w.options, fromInput(o)] }) } catch (e) { toast.error(errText(e)) } }
  const addManual = () => set({ options: [...w.options, fromInput({ label: "Manual option", source: "MANUAL", slices: [], components: [], priceBreakdown: { fare: { amountMinor: 0, currency: w.currency }, taxes: { amountMinor: 0, currency: w.currency }, serviceFee: { amountMinor: 0, currency: w.currency }, total: { amountMinor: 0, currency: w.currency } }, baggage: [], conditions: { change: { status: "UNKNOWN" }, refund: { status: "UNKNOWN" } }, ticketingModel: "SINGLE_TICKET" })] })
  const totalUnknown = w.options.reduce((n, o) => n + unknowns(o).length, 0)
  const badPrice = w.options.some((o) => badAmounts(o).length > 0)

  const save = async (): Promise<string | null> => {
    setSaving(true); setErr(null)
    try {
      const body = { currency: w.currency, validUntil: w.validUntil ? new Date(w.validUntil).toISOString() : undefined, options: w.options.map((o) => toInput(o, w.currency)) }
      const q = w.quoteId
        ? await api<StaffQuote>(`/v1/admin/flight-requests/${ref}/quotes/${w.quoteId}`, { method: "PATCH", body, headers: w.rowVersion != null ? { "if-match": String(w.rowVersion) } : {} })
        : await api<StaffQuote>(`/v1/admin/flight-requests/${ref}/quotes`, { body })
      setW({ ...w, quoteId: q.id, rowVersion: q.rowVersion, validUntil: q.validUntil ? toLocal(q.validUntil) : w.validUntil })
      setBlockedBy(q.sendBlockedBy ?? [])
      await qc.invalidateQueries({ queryKey: ["fr-detail", ref] })
      toast.success(`Draft v${q.version} saved`)
      return q.id
    } catch (e) { setErr(e); return null } finally { setSaving(false) }
  }
  const send = async () => {
    const id = await save()
    if (!id) return
    const fresh = await api<StaffQuote>(`/v1/admin/flight-requests/${ref}/quotes/${id}`)
    if (fresh.sendBlockedBy?.length) { setBlockedBy(fresh.sendBlockedBy); return }
    try {
      const latest = await api<FlightDetail>(`/v1/admin/flight-requests/${ref}`)
      await api(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { body: { quoteId: id }, headers: { "if-match": String(latest.version) } })
      sessionStorage.removeItem(storeKey(ref))
      await qc.invalidateQueries({ queryKey: ["fr-detail", ref] })
      toast.success("Quote sent — the customer has been notified")
      router.push(`/requests/${ref}`)
    } catch (e) { setErr(e) }
  }
  const discard = () => { sessionStorage.removeItem(storeKey(ref)); loaded.current = false; setW(null); router.replace(`/requests/${ref}`) }
  const sendAction = d.actions.find((a) => a.command === "send_quote")

  return (
    <div>
      <PageHead kicker={<><Link href={`/requests/${ref}`} className="num hover:underline">{ref}</Link> · {d.routeLabel} · {d.customer.preferredLocale === "fa" ? "customer reads Persian" : "customer reads English"}</>} title={w.quoteId ? "Quote draft" : "New quote"}>
        <Button size="sm" variant="outline" onClick={() => void addSnapshot()} disabled={!d.snapshot || w.options.length >= 5 || !can("pricing.read.internal")}>+ From snapshot</Button>
        <Button size="sm" variant="outline" render={<Link href={`/search?ref=${ref}`} />} disabled={w.options.length >= 5}>+ From staff search</Button>
        <Button size="sm" variant="outline" onClick={addManual} disabled={w.options.length >= 5}>+ Manual entry</Button>
      </PageHead>
      <div className="mx-auto max-w-6xl space-y-3 px-5 py-4">
        <BentoGrid className="max-sm:grid-cols-2 max-sm:gap-2">
          <BentoTile size="s" title={t("quote.options")}><Stat label={<span className="sr-only">{t("quote.options")}</span>} value={<>{w.options.length}<span className="text-[14px] text-steel"> / 5</span></>} /></BentoTile>
          <BentoTile size="s" title={t("quote.unknown")} tone={totalUnknown ? "alert" : "default"}>
            <p className={cn("num text-[28px] leading-none font-semibold", totalUnknown ? "text-danger" : "text-ink")} data-testid="unknown-total">{totalUnknown}</p>
            <p className={cn("mt-1 text-[12px]", totalUnknown ? "font-medium text-danger" : "text-steel")}>{totalUnknown ? t("quote.unknown.blocks") : t("quote.unknown.none")}</p>
          </BentoTile>
          <BentoTile size="s" title={t("quote.valid")}><p className="num text-[15px] font-medium">{w.validUntil ? fmtDateTime(new Date(w.validUntil).toISOString()) : "—"}</p>{!w.validUntil && <p className="mt-1 text-[12px] text-steel">{t("quote.valid.default")}</p>}</BentoTile>
          <BentoTile size="s" title={t("quote.total")}><p className="num text-[22px] leading-tight font-semibold">{w.options.length && !badPrice ? money(w.options.map((o) => toInput(o, w.currency).priceBreakdown.total).reduce((a, b) => (b.amountMinor < a.amountMinor ? b : a))) : "—"}</p></BentoTile>
        </BentoGrid>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Currency" className="w-28"><NativeSelect className="field-input" value={w.currency} onChange={(e) => set({ currency: e.target.value })}>{["GBP", "EUR", "USD"].map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
          <Field label="Valid until" hint="Blank = workflow default (24 h); never later than the supplier's offer expiry." className="w-64"><input type="datetime-local" className="field-input" value={w.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></Field>
        </div>
        {!w.options.length && <p className="rounded-md border border-dashed border-rule-strong p-6 text-center text-steel">Add an option from the customer&apos;s snapshot, a staff search, or type it in manually.</p>}
        {w.options.map((o, i) => (
          <OptionEditor key={o.key} o={o} index={i} count={w.options.length} currency={w.currency}
            onChange={(n) => set({ options: w.options.map((x) => (x.key === o.key ? n : x)) })}
            onRemove={() => set({ options: w.options.filter((x) => x.key !== o.key) })}
            onMove={(dir) => { const a = [...w.options]; const j = i + dir; [a[i], a[j]] = [a[j]!, a[i]!]; set({ options: a }) }} />
        ))}
        {preview && w.options.length > 0 && (
          <section className="rounded-md border-2 border-ink bg-surface-raised p-4" data-testid="quote-preview" aria-label="Customer preview">
            <p className="cap">Customer preview · as the customer will see it{d.customer.preferredLocale === "fa" ? " (shown here in English; the customer app renders Persian labels)" : ""}</p>
            <p className="mt-1 font-display text-xl">Your options for {d.routeLabel}</p>
            <p className="text-steel">Valid until {w.validUntil ? fmtDateTime(new Date(w.validUntil).toISOString()) : "24 hours after sending"}. Prices are not held until you accept and we reserve.</p>
            <ol className="mt-3 grid gap-3 md:grid-cols-2">
              {w.options.map((o) => { const inp = toInput(o, w.currency); return (
                <li key={o.key} className="rounded-md border border-rule bg-surface-raised p-3">
                  <p className="flex justify-between font-medium"><span>{o.label}</span><span className="num">{money(inp.priceBreakdown.total)}</span></p>
                  {o.ticketingModel === "SEPARATE_TICKETS" && <p className="font-mono text-[10px] text-danger">SEPARATE TICKETS</p>}
                  <div className="mt-1 space-y-1">{o.slices.map((s, i) => <SliceView key={i} slice={s} />)}</div>
                  <p className="mt-1 text-[12px] text-steel">Baggage: {inp.baggage.map((b) => (b.checked.status === "KNOWN" ? (b.checked.value.pieces ? `${b.checked.value.pieces}×${b.checked.value.kgPerPiece ?? "?"} kg` : "none") : "to be confirmed")).join(" · ")} · Change: {o.conditions.change.status === "KNOWN" ? (o.conditions.change.value.allowed ? (o.conditions.change.value.penalty ? `fee ${money(o.conditions.change.value.penalty)}` : "free") : "not allowed") : "to be confirmed"} · Refund: {o.conditions.refund.status === "KNOWN" ? (o.conditions.refund.value.allowed ? (o.conditions.refund.value.penalty ? `fee ${money(o.conditions.refund.value.penalty)}` : "free") : "not allowed") : "to be confirmed"}</p>
                  <p className="text-[11px] text-steel">Fare {money(inp.priceBreakdown.fare)} · taxes {money(inp.priceBreakdown.taxes)} · service fee {money(inp.priceBreakdown.serviceFee)}</p>
                </li>
              ) })}
            </ol>
          </section>
        )}
        <ErrorLine error={err} />
        {blockedBy && blockedBy.length > 0 && <div role="alert" className="rounded-sm border border-danger bg-danger-subtle p-2 text-danger" data-testid="send-blocked"><p className="font-medium">Sending is blocked:</p><ul className="list-disc ps-5">{blockedBy.map((b) => <li key={b}>{b}</li>)}</ul></div>}
      </div>
      <footer className="sticky bottom-[calc(3rem+env(safe-area-inset-bottom))] z-20 border-t border-rule bg-surface-raised/95 px-5 py-2 backdrop-blur md:bottom-0">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          {w.quoteId && <Tag value="DRAFT" />}
          {err ? <span role="alert" className="max-w-xl truncate text-danger" title={errText(err)}>{errText(err)}</span> : null}
          {sendAction && !sendAction.allowed && <span className="text-[11px] text-steel">{sendAction.reason}</span>}
          <span className="ms-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={discard}>Discard working copy</Button>
            <Button size="sm" variant="outline" onClick={() => setPreview((p) => !p)} disabled={!w.options.length}>{preview ? "Hide preview" : "Preview"}</Button>
            <Button size="sm" variant="outline" onClick={() => void save()} loading={saving} disabled={!w.options.length}>Save draft</Button>
            <Button size="sm" onClick={() => void send()} disabled={!w.options.length || totalUnknown > 0 || badPrice || saving} title={totalUnknown ? "Confirm every unknown fact first" : badPrice ? "Fix the highlighted amounts" : undefined}>Send quote</Button>
          </span>
        </div>
      </footer>
    </div>
  )
}

export default function QuotePage() {
  return <Suspense><Builder /></Suspense>
}
