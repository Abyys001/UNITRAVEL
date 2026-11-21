"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Calculator, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"

import { TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { Empty, PageHead, Panel } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { human, money, toMajor, toMinor } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

type Rate = { id: string; service: string; currency: string; ratePerKgMinor: number; minimumChargeMinor: number; fuelSurchargePct: number; handlingFeeMinor: number; insurancePct: number; markupPct: number; marginFixedMinor: number; notes: string | null; updatedAt: string; updatedBy: string }
type Lane = { id: string; origin: string; destination: string; label: string; enabled: boolean; services: string[]; volumetricDivisor: number; rateCards: Rate[] }
type Pricing = { costMinor: number; markupPct: number; marginFixedMinor: number; discountPct: number; discountMinor: number; priceMinor: number; profitMinor: number; specialRate: { id: string; note: string | null } | null }
type Result = { weights: { actualKg: number; volumetricKg: number; chargeableKg: number; divisor: number }; rateSet: boolean; estimate: null | { currency: string; lines: { key: string; label: string; amountMinor: number }[]; totalMinor: number; note: string; pricing: Pricing } }
type Match = { userId: string; displayName: string; email: string | null; phone: string | null }
type Piece = { l: string; w: string; h: string; kg: string }

const field = "grid gap-1 text-meta font-medium"
const sel = "h-10 rounded-lg border border-rule-strong bg-surface px-2 text-body"

/** ADR-0046 D4: postage calculator (booklet 14.3 weights, 14.6 freight) and the rate cards it uses. */
export default function PostageCalculator() {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const lanesQ = useQuery({ queryKey: ["cargo-rates"], queryFn: () => api<Lane[]>("/v1/admin/cargo/rates") })
  const open = useMemo(() => (lanesQ.data ?? []).filter((l) => l.enabled), [lanesQ.data])
  const [laneId, setLaneId] = useState("")
  const [service, setService] = useState("")
  const [pieces, setPieces] = useState<Piece[]>([{ l: "", w: "", h: "", kg: "" }])
  const [value, setValue] = useState("")
  const [res, setRes] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [lookup, setLookup] = useState("")
  const [customer, setCustomer] = useState<Match | null>(null)
  const find = async () => { try { const r = await api<Match[]>(`/v1/admin/cargo/customers?q=${encodeURIComponent(lookup.trim())}`); setCustomer(r[0] ?? null); if (!r[0]) toast.error("No customer found") } catch (e) { toast.error(errText(e)) } }
  const lane = open.find((l) => l.id === laneId)
  useEffect(() => { if (!laneId && open[0]) setLaneId(open[0].id) }, [open, laneId])
  useEffect(() => { if (lane && !lane.services.includes(service)) setService(lane.services[0] ?? "") }, [lane, service])
  const card = lane?.rateCards.find((c) => c.service === service)

  const run = async () => {
    setBusy(true); setRes(null)
    try {
      const body = { laneId, service, pieces: pieces.map((p) => ({ lengthCm: Number(p.l), widthCm: Number(p.w), heightCm: Number(p.h), weightKg: Number(p.kg) })), ...(value && card ? { declaredValueMinor: toMinor(value, card.currency) } : {}), ...(customer ? { customerUserId: customer.userId } : {}) }
      setRes(await api<Result>("/v1/admin/cargo/calculate", { body }))
    } catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  const setP = (i: number, k: keyof Piece, v: string) => setPieces((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)))

  return (
    <div className="px-4 pb-10 md:px-6">
      <PageHead title={t("calc.title")} />
      {lanesQ.error ? <TileError error={lanesQ.error} onRetry={() => void lanesQ.refetch()} /> : !lanesQ.data ? <ListSkeleton rows={3} /> : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title={t("calc.title")}>
            <div className="grid gap-3" data-testid="calc-form">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={field}>{t("calc.lane")}<select className={sel} value={laneId} onChange={(e) => setLaneId(e.target.value)} data-testid="calc-lane">{open.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
                <label className={field}>{t("calc.service")}<select className={sel} value={service} onChange={(e) => setService(e.target.value)}>{(lane?.services ?? []).map((s) => <option key={s} value={s}>{human(s)}</option>)}</select></label>
              </div>
              <p className="text-meta font-medium">{t("calc.pieces")}</p>
              {pieces.map((p, i) => (
                <div key={i} className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] items-end gap-2">
                  {(["l", "w", "h", "kg"] as const).map((k) => <label key={k} className="grid gap-1 text-caption text-steel">{t(k === "kg" ? "calc.kg" : (`calc.${k}` as "calc.l"))}<Input inputMode="decimal" value={p[k]} onChange={(e) => setP(i, k, e.target.value)} className="num" /></label>)}
                  <Button size="icon" variant="ghost" aria-label={t("calc.rate.delete")} disabled={pieces.length === 1} onClick={() => setPieces((ps) => ps.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setPieces((ps) => [...ps, { l: "", w: "", h: "", kg: "" }])}><Plus className="size-4" />{t("calc.addPiece")}</Button>
              {card && card.insurancePct > 0 && <label className={field}>{t("calc.value")} ({card.currency})<Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="num w-48" /></label>}
              {can("cargo_request.create.any") && (
                <div className="grid gap-1 text-meta font-medium">{t("calc.customer")}
                  {customer ? <p className="flex items-center gap-2"><span className="rounded-md bg-surface-sunk px-2 py-1">{customer.displayName}{customer.email ? ` · ${customer.email}` : ""}</span><Button size="xs" variant="ghost" onClick={() => setCustomer(null)}>{t("calc.clearCustomer")}</Button></p>
                    : <div className="flex gap-2"><Input value={lookup} onChange={(e) => setLookup(e.target.value)} dir="ltr" /><Button variant="outline" onClick={() => void find()} disabled={lookup.trim().length < 3}>{t("calc.find")}</Button></div>}
                </div>
              )}
              <Button onClick={() => void run()} loading={busy} disabled={!laneId || !service} data-testid="calc-run"><Calculator className="size-4" />{t("calc.run")}</Button>
            </div>
            {res && (
              <div className="mt-4 grid gap-3" data-testid="calc-result">
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-surface-sunk p-2"><dt className="text-caption text-steel">{t("calc.actual")}</dt><dd className="num font-semibold">{res.weights.actualKg} kg</dd></div>
                  <div className="rounded-lg bg-surface-sunk p-2"><dt className="text-caption text-steel">{t("calc.volumetric")}</dt><dd className="num font-semibold">{res.weights.volumetricKg} kg</dd><dd className="text-caption text-steel">{t("calc.divisor", { d: res.weights.divisor })}</dd></div>
                  <div className="rounded-lg bg-navy-900 p-2 text-white"><dt className="text-caption opacity-80">{t("calc.chargeable")}</dt><dd className="num font-semibold">{res.weights.chargeableKg} kg</dd></div>
                </dl>
                {!res.estimate ? <p className="rounded-md bg-surface-sunk px-3 py-2 text-meta">{t("calc.noRate")}</p> : (
                  <div>
                    <ul className="ledger-rows">{res.estimate.lines.map((l) => <li key={l.key} className="flex justify-between gap-2 py-1"><span>{l.label}</span><span className="num">{money({ amountMinor: l.amountMinor, currency: res.estimate!.currency })}</span></li>)}</ul>
                    <p className="mt-2 flex justify-between border-t border-rule pt-2 font-semibold"><span>{t("calc.cost")}</span><span className="num" data-testid="calc-cost">{money({ amountMinor: res.estimate.pricing.costMinor, currency: res.estimate.currency })}</span></p>
                    <ul className="mt-1 text-meta text-steel">
                      {res.estimate.pricing.markupPct > 0 && <li>{t("calc.markup", { p: res.estimate.pricing.markupPct })}</li>}
                      {res.estimate.pricing.marginFixedMinor > 0 && <li className="flex justify-between"><span>{t("calc.margin")}</span><span className="num">{money({ amountMinor: res.estimate.pricing.marginFixedMinor, currency: res.estimate.currency })}</span></li>}
                      {res.estimate.pricing.discountMinor > 0 && <li className="flex justify-between"><span>{t("calc.discount", { p: res.estimate.pricing.discountPct })}</span><span className="num">−{money({ amountMinor: res.estimate.pricing.discountMinor, currency: res.estimate.currency })}</span></li>}
                      {res.estimate.pricing.specialRate && <li>{t("calc.special")}{res.estimate.pricing.specialRate.note ? `: ${res.estimate.pricing.specialRate.note}` : ""}</li>}
                    </ul>
                    <p className="mt-2 flex justify-between rounded-lg bg-navy-900 px-3 py-2 text-lead font-semibold text-white"><span>{t("calc.price")}</span><span className="num" data-testid="calc-total">{money({ amountMinor: res.estimate.pricing.priceMinor, currency: res.estimate.currency })}</span></p>
                    <p className={`mt-1 flex justify-between text-meta font-medium ${res.estimate.pricing.profitMinor < 0 ? "text-danger" : "text-success"}`}><span>{t("calc.profit")}</span><span className="num">{money({ amountMinor: res.estimate.pricing.profitMinor, currency: res.estimate.currency })}</span></p>
                    <p className="mt-1 text-caption text-steel">{t("calc.estimate")}</p>
                  </div>
                )}
              </div>
            )}
          </Panel>
          <Panel title={t("calc.rates")}>
            <p className="mb-3 text-meta text-steel">{t("calc.ratesHint")}</p>
            <ul className="grid gap-3" data-testid="rate-cards">
              {lanesQ.data.map((l) => (
                <li key={l.id} className="rounded-lg border border-rule p-3">
                  <p className="font-medium">{l.label}{!l.enabled && <span className="ms-2 text-caption text-steel">({t("calc.laneClosed")})</span>}</p>
                  <ul className="mt-2 grid gap-2">{l.services.map((s) => <RateRow key={s} lane={l} service={s} card={l.rateCards.find((c) => c.service === s)} canEdit={can("pricing.write")} onSaved={() => qc.invalidateQueries({ queryKey: ["cargo-rates"] })} />)}</ul>
                </li>
              ))}
            </ul>
          </Panel>
          <CustomerRates lanes={lanesQ.data} canEdit={can("pricing.write")} canFind={can("cargo_request.create.any")} />
        </div>
      )}
    </div>
  )
}

type CRate = { id: string; customerUserId: string; customerName: string; laneId: string | null; service: string | null; discountPct: number; markupPct: number | null; note: string | null }
function CustomerRates({ lanes, canEdit, canFind }: { lanes: Lane[]; canEdit: boolean; canFind: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["cargo-customer-rates"], queryFn: () => api<CRate[]>("/v1/admin/cargo/customer-rates") })
  const [lookup, setLookup] = useState("")
  const [who, setWho] = useState<Match | null>(null)
  const [f, setF] = useState({ laneId: "", service: "", discount: "0", markup: "", note: "" })
  const find = async () => { try { const r = await api<Match[]>(`/v1/admin/cargo/customers?q=${encodeURIComponent(lookup.trim())}`); setWho(r[0] ?? null); if (!r[0]) toast.error("No customer found") } catch (e) { toast.error(errText(e)) } }
  const add = async () => {
    try {
      await api("/v1/admin/cargo/customer-rates", { body: { customerUserId: who!.userId, laneId: f.laneId || null, service: f.service || null, discountPct: Number(f.discount || 0), markupPct: f.markup ? Number(f.markup) : null, note: f.note || null } })
      toast.success(t("crate.added")); setWho(null); setLookup(""); await qc.invalidateQueries({ queryKey: ["cargo-customer-rates"] })
    } catch (e) { toast.error(errText(e)) }
  }
  const remove = async (id: string) => { try { await api(`/v1/admin/cargo/customer-rates/${id}`, { method: "DELETE" }); await qc.invalidateQueries({ queryKey: ["cargo-customer-rates"] }) } catch (e) { toast.error(errText(e)) } }
  const laneLabel = (id: string | null) => (id ? lanes.find((l) => l.id === id)?.label ?? "?" : t("crate.allLanes"))
  return (
    <Panel title={t("crate.title")}>
      <p className="mb-3 text-meta text-steel">{t("crate.hint")}</p>
      {!q.data?.length ? <Empty>{t("crate.none")}</Empty> : (
        <ul className="ledger-rows mb-3" data-testid="customer-rates">{q.data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-meta">
            <span><span className="font-medium">{r.customerName}</span> · {laneLabel(r.laneId)} · {r.service ? human(r.service) : t("crate.allServices")}</span>
            <span className="num">{r.discountPct ? `−${r.discountPct}%` : ""}{r.markupPct != null ? ` · +${r.markupPct}%` : ""}{r.note ? ` · ${r.note}` : ""}</span>
            {canEdit && <Button size="icon" variant="ghost" aria-label={t("calc.rate.delete")} onClick={() => void remove(r.id)}><Trash2 className="size-4" /></Button>}
          </li>))}</ul>
      )}
      {canEdit && canFind && (
        <div className="grid gap-2 rounded-lg border border-rule p-3">
          {who ? <p className="text-meta"><span className="font-medium">{who.displayName}</span>{who.email ? ` · ${who.email}` : ""} <Button size="xs" variant="ghost" onClick={() => setWho(null)}>{t("calc.clearCustomer")}</Button></p>
            : <div className="flex gap-2"><Input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder={t("calc.customer")} dir="ltr" /><Button variant="outline" onClick={() => void find()} disabled={lookup.trim().length < 3}>{t("calc.find")}</Button></div>}
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={sel} value={f.laneId} onChange={(e) => setF({ ...f, laneId: e.target.value })}><option value="">{t("crate.allLanes")}</option>{lanes.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
            <select className={sel} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}><option value="">{t("crate.allServices")}</option>{["DOCUMENTS", "PARCEL", "EXCESS_BAGGAGE", "AIR_FREIGHT"].map((x) => <option key={x} value={x}>{human(x)}</option>)}</select>
            <label className={field}>{t("crate.discount")}<Input inputMode="decimal" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} className="num" /></label>
            <label className={field}>{t("crate.markup")}<Input inputMode="decimal" value={f.markup} onChange={(e) => setF({ ...f, markup: e.target.value })} className="num" /></label>
            <label className={`${field} sm:col-span-2`}>{t("calc.rate.notes")}<Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} dir="auto" /></label>
          </div>
          <Button size="sm" className="justify-self-start" disabled={!who} onClick={() => void add()}>{t("crate.add")}</Button>
        </div>
      )}
    </Panel>
  )
}

function RateRow({ lane, service, card, canEdit, onSaved }: { lane: Lane; service: string; card?: Rate; canEdit: boolean; onSaved: () => Promise<unknown> }) {
  const t = useT()
  const [edit, setEdit] = useState(false)
  const cur = card?.currency ?? "GBP"
  const [f, setF] = useState(() => ({ currency: cur, perKg: card ? toMajor(card.ratePerKgMinor, cur) : "", min: card ? toMajor(card.minimumChargeMinor, cur) : "0", fuel: String(card?.fuelSurchargePct ?? 0), handling: card ? toMajor(card.handlingFeeMinor, cur) : "0", ins: String(card?.insurancePct ?? 0), notes: card?.notes ?? "" }))
  const [mk, setMk] = useState(() => ({ markup: String(card?.markupPct ?? 0), margin: card ? toMajor(card.marginFixedMinor, cur) : "0" }))
  const save = async () => {
    try {
      await api("/v1/admin/cargo/rates", { method: "PUT", body: { laneId: lane.id, service, currency: f.currency, ratePerKgMinor: toMinor(f.perKg, f.currency), minimumChargeMinor: toMinor(f.min, f.currency), fuelSurchargePct: Number(f.fuel), handlingFeeMinor: toMinor(f.handling, f.currency), insurancePct: Number(f.ins), markupPct: Number(mk.markup || 0), marginFixedMinor: toMinor(mk.margin || "0", f.currency), notes: f.notes || null } })
      toast.success(t("calc.rate.saved")); setEdit(false); await onSaved()
    } catch (e) { toast.error(errText(e)) }
  }
  const remove = async () => { try { await api(`/v1/admin/cargo/rates/${card!.id}`, { method: "DELETE" }); toast.success(t("calc.rate.deleted")); await onSaved() } catch (e) { toast.error(errText(e)) } }
  return (
    <li className="rounded-md bg-surface-sunk px-2 py-1.5 text-meta">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{human(service)}</span>
        <span className="num text-steel">{card ? `${money({ amountMinor: card.ratePerKgMinor, currency: card.currency })}/kg · min ${money({ amountMinor: card.minimumChargeMinor, currency: card.currency })}${card.fuelSurchargePct ? ` · fuel ${card.fuelSurchargePct}%` : ""}${card.handlingFeeMinor ? ` · +${money({ amountMinor: card.handlingFeeMinor, currency: card.currency })}` : ""}${card.markupPct ? ` · markup ${card.markupPct}%` : ""}` : t("calc.rate.none")}</span>
        {canEdit && !edit && <Button size="xs" variant="ghost" onClick={() => setEdit(true)}>{t("calc.rate.edit")}</Button>}
      </div>
      {edit && (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className={field}>{t("calc.rate.currency")}<Input value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></label>
          <label className={field}>{t("calc.rate.perKg")}<Input inputMode="decimal" value={f.perKg} onChange={(e) => setF({ ...f, perKg: e.target.value })} className="num" /></label>
          <label className={field}>{t("calc.rate.min")}<Input inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} className="num" /></label>
          <label className={field}>{t("calc.rate.fuel")}<Input inputMode="decimal" value={f.fuel} onChange={(e) => setF({ ...f, fuel: e.target.value })} className="num" /></label>
          <label className={field}>{t("calc.rate.handling")}<Input inputMode="decimal" value={f.handling} onChange={(e) => setF({ ...f, handling: e.target.value })} className="num" /></label>
          <label className={field}>{t("calc.rate.ins")}<Input inputMode="decimal" value={f.ins} onChange={(e) => setF({ ...f, ins: e.target.value })} className="num" /></label>
          <label className={field}>{t("calc.rate.markup")}<Input inputMode="decimal" value={mk.markup} onChange={(e) => setMk({ ...mk, markup: e.target.value })} className="num" /></label>
          <label className={field}>{t("calc.rate.marginFixed")}<Input inputMode="decimal" value={mk.margin} onChange={(e) => setMk({ ...mk, margin: e.target.value })} className="num" /></label>
          <label className={`${field} sm:col-span-3`}>{t("calc.rate.notes")}<Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} dir="auto" /></label>
          <div className="flex gap-2 sm:col-span-3">
            <Button size="sm" onClick={() => void save()} disabled={!f.perKg}>{t("calc.rate.save")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>{t("common.cancel")}</Button>
            {card && <Button size="sm" variant="ghost" className="ms-auto text-danger" onClick={() => void remove()}><Trash2 className="size-4" />{t("calc.rate.delete")}</Button>}
          </div>
        </div>
      )}
    </li>
  )
}
