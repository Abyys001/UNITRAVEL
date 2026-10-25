"use client"

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react"
import { useState } from "react"

import type { Condition, Tri } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { SliceView } from "@/components/flight/itinerary"
import { Field, Tag } from "@/components/ui"
import { fmtDateTime, money } from "@/lib/format"
import { useSession } from "@/lib/session"

import { type DraftOption, emptySeg, type ManualSeg, manualSlice, badAmounts, normaliseBaggage, segCount, unknowns, ZONES } from "./model"

type Baggage = DraftOption["baggage"][number]

function TriSelect({ label, value, onChange, flagged, children }: { label: string; value: "UNKNOWN" | "KNOWN" | string; onChange: (v: string) => void; flagged: boolean; children: React.ReactNode }) {
  return (
    <label className={cn("block rounded-sm border p-1.5", flagged ? "border-danger bg-danger-subtle" : "border-rule")}>
      <span className="cap block">{label}</span>{flagged && <span className="block text-2xs text-danger">Unknown — confirm from fare rules</span>}
      <NativeSelect className="field-input mt-1" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={flagged}>{children}</NativeSelect>
    </label>
  )
}

function ConditionEditor({ label, value, onChange, currency }: { label: string; value: Tri<Condition>; onChange: (v: Tri<Condition>) => void; currency: string }) {
  const mode = value.status === "UNKNOWN" ? "UNKNOWN" : value.value.allowed ? (value.value.penalty ? "FEE" : "FREE") : "NO"
  return (
    <div className="space-y-1">
      <TriSelect label={label} value={mode} flagged={value.status === "UNKNOWN" || (mode === "FEE" && !(value.status === "KNOWN" && (value.value.penalty?.amountMinor ?? 0) > 0))} onChange={(m) => onChange(m === "UNKNOWN" ? { status: "UNKNOWN" } : m === "NO" ? { status: "KNOWN", value: { allowed: false } } : m === "FREE" ? { status: "KNOWN", value: { allowed: true } } : { status: "KNOWN", value: { allowed: true, penalty: { amountMinor: 0, currency } } })}>
        <option value="UNKNOWN">Unknown — not stated</option><option value="FREE">Allowed, no fee</option><option value="FEE">Allowed with a fee</option><option value="NO">Not allowed</option>
      </TriSelect>
      {mode === "FEE" && value.status === "KNOWN" && <input aria-label={`${label} fee`} className="field-input num" inputMode="decimal" defaultValue={value.value.penalty?.amountMinor ? (value.value.penalty.amountMinor / 100).toFixed(2) : ""} placeholder="fee amount" onBlur={(e) => onChange({ status: "KNOWN", value: { allowed: true, penalty: { amountMinor: Math.round(Number(e.target.value || 0) * 100), currency } } })} />}
    </div>
  )
}

function BaggageRow({ b, onChange, label }: { b: Baggage; onChange: (b: Baggage) => void; label: string }) {
  const checked = b.checked.status === "KNOWN" ? b.checked.value : null
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
      <div>
        <TriSelect label={`Checked bag · ${label}`} value={b.checked.status === "UNKNOWN" ? "UNKNOWN" : checked?.pieces === 0 ? "NONE" : "KNOWN"} flagged={b.checked.status === "UNKNOWN"} onChange={(v) => onChange({ ...b, checked: v === "UNKNOWN" ? { status: "UNKNOWN" } : v === "NONE" ? { status: "KNOWN", value: { pieces: 0 } } : { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } } })}>
          <option value="UNKNOWN">Unknown</option><option value="NONE">None included</option><option value="KNOWN">Included…</option>
        </TriSelect>
        {checked && checked.pieces !== 0 && (
          <div className="mt-1 flex gap-1">
            <input aria-label="Pieces" className="field-input num w-16" inputMode="numeric" value={checked.pieces ?? ""} onChange={(e) => onChange({ ...b, checked: { status: "KNOWN", value: { ...checked, pieces: e.target.value === "" ? undefined : Number(e.target.value) } } })} placeholder="pcs" />
            <input aria-label="Kg per piece" className="field-input num w-20" inputMode="decimal" value={checked.kgPerPiece ?? ""} onChange={(e) => onChange({ ...b, checked: { status: "KNOWN", value: { ...checked, kgPerPiece: e.target.value === "" ? undefined : Number(e.target.value) } } })} placeholder="kg/pc" />
          </div>
        )}
      </div>
      <TriSelect label="Cabin bag" value={b.cabin.status === "UNKNOWN" ? "UNKNOWN" : b.cabin.value ? "YES" : "NO"} flagged={false} onChange={(v) => onChange({ ...b, cabin: v === "UNKNOWN" ? { status: "UNKNOWN" } : { status: "KNOWN", value: v === "YES" } })}>
        <option value="UNKNOWN">Unknown</option><option value="YES">Included</option><option value="NO">Not included</option>
      </TriSelect>
    </div>
  )
}

function ManualSegments({ onDone }: { onDone: (s: ReturnType<typeof manualSlice>) => void }) {
  const [segs, setSegs] = useState<ManualSeg[]>([emptySeg()])
  const up = (i: number, k: keyof ManualSeg) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setSegs(segs.map((s, j) => (j === i ? { ...s, [k]: e.target.value } : s)))
  const ok = segs.every((s) => s.carrier && s.flightNumber && /^[A-Za-z]{3}$/.test(s.from) && /^[A-Za-z]{3}$/.test(s.to) && s.dep && s.arr)
  return (
    <div className="space-y-2 rounded-md border border-dashed border-orange p-2" data-testid="manual-segments">
      <p className="cap">Type the segments from the reservation terminal — they are labelled MANUAL and attested by you</p>
      {segs.map((s, i) => (
        <div key={i} className="grid grid-cols-4 gap-1.5">
          <input aria-label="Carrier" placeholder="TK" className="field-input font-mono uppercase" maxLength={3} value={s.carrier} onChange={up(i, "carrier")} />
          <input aria-label="Flight number" placeholder="879" className="field-input font-mono" value={s.flightNumber} onChange={up(i, "flightNumber")} />
          <input aria-label="From" placeholder="IKA" className="field-input font-mono uppercase" maxLength={3} value={s.from} onChange={up(i, "from")} />
          <input aria-label="To" placeholder="IST" className="field-input font-mono uppercase" maxLength={3} value={s.to} onChange={up(i, "to")} />
          <input aria-label="Departure (local)" type="datetime-local" className="field-input col-span-2" value={s.dep} onChange={up(i, "dep")} />
          <NativeSelect aria-label="Departure zone" className="field-input col-span-2" value={s.depTz} onChange={up(i, "depTz")}>{ZONES.map((z) => <option key={z}>{z}</option>)}</NativeSelect>
          <input aria-label="Arrival (local)" type="datetime-local" className="field-input col-span-2" value={s.arr} onChange={up(i, "arr")} />
          <NativeSelect aria-label="Arrival zone" className="field-input col-span-2" value={s.arrTz} onChange={up(i, "arrTz")}>{ZONES.map((z) => <option key={z}>{z}</option>)}</NativeSelect>
          <input aria-label="Booking class" placeholder="Class" className="field-input font-mono uppercase" maxLength={2} value={s.bookingClass} onChange={up(i, "bookingClass")} />
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="button" size="xs" variant="ghost" onClick={() => setSegs([...segs, emptySeg()])}>+ Segment</Button>
        <Button type="button" size="xs" disabled={!ok} onClick={() => onDone(manualSlice(segs))}>Add slice</Button>
      </div>
    </div>
  )
}

export function OptionEditor({ o, index, count, currency, onChange, onRemove, onMove }: { o: DraftOption; index: number; count: number; currency: string; onChange: (o: DraftOption) => void; onRemove: () => void; onMove: (d: -1 | 1) => void }) {
  const { can } = useSession()
  const unk = unknowns(o)
  const bad = new Set(badAmounts(o))
  const amt = (k: "fare" | "taxes" | "serviceFee" | "internalCost") => ({ "aria-invalid": bad.has(k) || undefined, className: `field-input num${bad.has(k) ? " border-danger" : ""}` })
  const total = Math.round(Number(o.fare || 0) * 100) + Math.round(Number(o.taxes || 0) * 100) + Math.round(Number(o.serviceFee || 0) * 100)
  const segLabels = o.slices.flatMap((s) => s.segments.map((g) => `${g.marketing.carrier}${g.marketing.flightNumber} ${g.origin.iata}–${g.destination.iata}`))
  const diff = o.supplierPrice && !bad.size ? total - o.supplierPrice.amountMinor : null
  return (
    <section className="rounded-md border border-rule-strong bg-surface-raised" data-testid={`option-${index}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-rule bg-ledger px-3 py-2">
        <span className="num text-steel">Option {index + 1}</span>
        <input aria-label="Option label" className="field-input max-w-md flex-1 font-medium" value={o.label} onChange={(e) => onChange({ ...o, label: e.target.value })} />
        <Tag value={o.source} />
        {unk.length > 0 ? <span className="text-meta font-semibold text-danger" data-testid="unknown-count">{unk.length} unknown</span> : <span className="text-meta font-semibold text-success">all facts confirmed</span>}
        <span className="ms-auto flex gap-1">
          <Button type="button" size="icon-xs" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp /></Button>
          <Button type="button" size="icon-xs" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDown /></Button>
          <Button type="button" size="icon-xs" variant="ghost" onClick={onRemove} aria-label="Remove option"><Trash2 /></Button>
        </span>
      </header>
      <div className="grid gap-4 p-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          {o.slices.map((s, i) => <div key={i} className="flex items-start justify-between gap-2"><SliceView slice={s} index={i} />{o.source === "MANUAL" && <button type="button" className="text-caption text-danger underline" onClick={() => onChange({ ...o, slices: o.slices.filter((_, j) => j !== i), baggage: [] })}>remove</button>}</div>)}
          {o.source === "MANUAL" && <ManualSegments onDone={(sl) => { const slices = [...o.slices, sl]; onChange({ ...o, slices, baggage: normaliseBaggage(slices, o.baggage) }) }} />}
          <Field label="Ticketing" className="max-w-xs"><NativeSelect className="field-input" value={o.ticketingModel} onChange={(e) => onChange({ ...o, ticketingModel: e.target.value as DraftOption["ticketingModel"] })}><option value="SINGLE_TICKET">Single ticket</option><option value="SEPARATE_TICKETS">Separate tickets</option></NativeSelect></Field>
          {o.components.length > 0 && <p className="text-caption text-steel">Sources: {o.components.map((c) => `${c.provider} ${c.rung}${c.offerId ? ` ${c.offerId.slice(0, 12)}` : ""}${c.fetchedAt ? ` @ ${fmtDateTime(c.fetchedAt)}` : ""}`).join(" · ")}</p>}
        </div>
        <div className="space-y-3">
          <div>
            <p className="cap">Price · {currency}</p>
            <div className="mt-1 grid grid-cols-4 gap-1.5">
              <Field label="Fare"><input {...amt("fare")} inputMode="decimal" value={o.fare} onChange={(e) => onChange({ ...o, fare: e.target.value })} /></Field>
              <Field label="Taxes"><input {...amt("taxes")} inputMode="decimal" value={o.taxes} onChange={(e) => onChange({ ...o, taxes: e.target.value })} /></Field>
              <Field label="Service fee"><input {...amt("serviceFee")} inputMode="decimal" value={o.serviceFee} onChange={(e) => onChange({ ...o, serviceFee: e.target.value })} /></Field>
              <Field label="Total"><output className="field-input num flex items-center bg-ledger font-medium" data-testid="option-total">{bad.size ? "—" : money({ amountMinor: total, currency })}</output></Field>
            </div>
            {o.supplierExpiresAt && Date.parse(o.supplierExpiresAt) < Date.now() && <p className="mt-1 rounded-sm bg-danger-subtle px-1.5 py-1 text-caption text-danger" role="alert">The supplier offer expired {fmtDateTime(o.supplierExpiresAt)}. Validity cannot exceed it — re-check the price or add a fresh option from staff search.</p>}
            {o.supplierPrice && <p className="mt-1 text-caption text-steel">Supplier {money(o.supplierPrice)}{o.supplierFetchedAt && ` fetched ${fmtDateTime(o.supplierFetchedAt)}`}{diff !== null && <> · difference <span className={diff < 0 ? "text-danger" : ""}>{diff >= 0 ? "+" : ""}{money({ amountMinor: diff, currency })}</span></>}{o.supplierExpiresAt && ` · offer expires ${fmtDateTime(o.supplierExpiresAt)}`}</p>}
            {can("pricing.read.internal") && <Field label="Internal cost (never shown to the customer)" className="mt-1.5 max-w-48"><input {...amt("internalCost")} inputMode="decimal" value={o.internalCost} onChange={(e) => onChange({ ...o, internalCost: e.target.value })} /></Field>}
          </div>
          <div className="space-y-1.5">
            <p className="cap">Baggage per segment</p>
            {normaliseBaggage(o.slices, o.baggage).map((b, i) => <BaggageRow key={i} b={b} label={segLabels[i] ?? `segment ${i + 1}`} onChange={(nb) => onChange({ ...o, baggage: normaliseBaggage(o.slices, o.baggage).map((x, j) => (j === i ? nb : x)) })} />)}
            {!segCount(o.slices) && <p className="text-steel">Add a slice first.</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ConditionEditor label="Change" value={o.conditions.change} currency={currency} onChange={(v) => onChange({ ...o, conditions: { ...o.conditions, change: v } })} />
            <ConditionEditor label="Refund" value={o.conditions.refund} currency={currency} onChange={(v) => onChange({ ...o, conditions: { ...o.conditions, refund: v } })} />
          </div>
        </div>
      </div>
    </section>
  )
}

