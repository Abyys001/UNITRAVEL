"use client"

import { ArrowLeftRight, Minus, Plus, Search, Settings2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Switch } from "@unitravel/ui/components/switch"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { useI18n } from "@/lib/i18n"

import { type PlaceValue, PlaceInput } from "./place-input"

export interface SearchParamsShape { trip: "ONE_WAY" | "RETURN"; from: PlaceValue; to: PlaceValue; date: string; ret?: string; adt: number; chd: number[]; inf: number; cabin: string; flex: boolean; st: boolean; ac: boolean; on: boolean; gw: boolean; stops: number; lay: [number, number] }

export function toQuery(p: SearchParamsShape) {
  const place = (v: PlaceValue) => (v.kind === "CITY" ? { city: v.code } : { airport: v.code })
  const slices = [{ from: place(p.from), to: place(p.to), date: p.date, flexDays: p.flex ? 3 : 0 }]
  if (p.trip === "RETURN" && p.ret) slices.push({ from: place(p.to), to: place(p.from), date: p.ret, flexDays: p.flex ? 3 : 0 })
  return {
    tripType: p.trip, slices, cabin: p.cabin,
    passengers: [...Array.from({ length: p.adt }, () => ({ type: "ADT" })), ...p.chd.map((age) => ({ type: "CHD", age })), ...Array.from({ length: p.inf }, () => ({ type: "INF" }))],
    preferences: { allowSelfTransfer: p.st, allowAirportChange: p.ac, allowOvernight: p.on, includeGateways: p.gw, maxStops: p.stops, preferredLayoverMin: p.lay },
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** The search form (ch. 11.3): gateway departures default on for restricted-origin countries. */
export function SearchForm({ initial }: { initial?: Partial<SearchParamsShape> }) {
  const { t, href, locale, sep } = useI18n()
  const router = useRouter()
  const [p, setP] = useState<SearchParamsShape>({
    trip: "ONE_WAY", from: { kind: "CITY", code: "THR", label: locale === "fa" ? "تهران" : "Tehran" }, to: { kind: "CITY", code: "LON", label: locale === "fa" ? "لندن" : "London" },
    date: iso(new Date(Date.now() + 23 * 86400_000)), adt: 1, chd: [], inf: 0, cabin: "ECONOMY", flex: false, st: true, ac: false, on: true, gw: true, stops: 2, lay: [240, 360], ...initial,
  })
  const [more, setMore] = useState(false)
  const set = <K extends keyof SearchParamsShape>(k: K, v: SearchParamsShape[K]) => setP((x) => ({ ...x, [k]: v }))
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    router.push(href(`/search?q=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(p)))))}`))
  }
  const Counter = ({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (n: number) => void; min?: number }) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <button type="button" className="rounded-lg border border-line p-1.5 disabled:opacity-40" aria-label={`− ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus className="size-3.5" /></button>
        <span className="w-5 text-center tabular-nums">{value}</span>
        <button type="button" className="rounded-lg border border-line p-1.5" aria-label={`+ ${label}`} onClick={() => onChange(value + 1)}><Plus className="size-3.5" /></button>
      </span>
    </div>
  )
  return (
    <form onSubmit={submit} className="rounded-[24px] border border-white/60 bg-white p-4 text-navy-950 shadow-[var(--shadow-lift)] md:p-6" aria-label={t("search.submit")}>
      <div className="mb-4 inline-flex gap-1 rounded-full bg-cloud p-1 text-sm font-semibold" role="radiogroup">
        {(["ONE_WAY", "RETURN"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={p.trip === k} onClick={() => set("trip", k)} className={`rounded-full px-4 py-1.5 transition-colors ${p.trip === k ? "bg-navy-900 text-white shadow-sm" : "text-steel hover:text-navy-950"}`}>{t(k === "ONE_WAY" ? "search.oneWay" : "search.return")}</button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
        <PlaceInput name="from" label={t("search.from")} value={p.from} onChange={(v) => set("from", v)} />
        <button type="button" className="mt-5 hidden self-center rounded-full border-2 border-orange bg-white p-2 text-navy-900 transition-transform hover:rotate-180 md:block" aria-label="Swap" onClick={() => setP((x) => ({ ...x, from: x.to, to: x.from }))}><ArrowLeftRight className="size-4" /></button>
        <PlaceInput name="to" label={t("search.to")} value={p.to} onChange={(v) => set("to", v)} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium uppercase tracking-wide text-steel">{t("search.date")}
          <input type="date" required value={p.date} min={iso(new Date())} onChange={(e) => set("date", e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-cloud/60 px-3 text-base text-navy-950 focus:bg-white normal-case tracking-normal" />
        </label>
        {p.trip === "RETURN" ? (
          <label className="text-xs font-medium uppercase tracking-wide text-steel">{t("search.returnDate")}
            <input type="date" required value={p.ret ?? ""} min={p.date} onChange={(e) => set("ret", e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-cloud/60 px-3 text-base text-navy-950 focus:bg-white normal-case tracking-normal" />
          </label>
        ) : null}
        <label className="text-xs font-medium uppercase tracking-wide text-steel">{t("search.cabin")}
          <NativeSelect value={p.cabin} onChange={(e) => set("cabin", e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-cloud/60 px-3 text-base text-navy-950 focus:bg-white normal-case tracking-normal">
            <option value="ECONOMY">{t("search.economy")}</option><option value="PREMIUM_ECONOMY">{t("search.premium")}</option><option value="BUSINESS">{t("search.business")}</option><option value="FIRST">{t("search.first")}</option>
          </NativeSelect>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={p.flex} onChange={(e) => set("flex", e.target.checked)} className="size-4 accent-orange" />{t("search.flex")}</label>
      </div>
      <details className="mt-3 rounded-xl border border-line px-3 py-2" open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><Settings2 className="size-4 text-orange-700" />{t("search.travellers")}{sep}{t("search.preferences")}</summary>
        <div className="mt-3 grid gap-6 md:grid-cols-2">
          <div>
            <Counter label={t("search.adults")} value={p.adt} min={1} onChange={(n) => set("adt", n)} />
            <Counter label={t("search.children")} value={p.chd.length} onChange={(n) => set("chd", n > p.chd.length ? [...p.chd, 8] : p.chd.slice(0, n))} />
            {p.chd.map((age, i) => (
              <label key={i} className="ms-4 flex items-center justify-between py-1 text-sm text-steel">{t("search.childAge", { n: i + 1 })}
                <NativeSelect value={age} onChange={(e) => set("chd", p.chd.map((a, j) => (j === i ? Number(e.target.value) : a)))} className="field py-1">{Array.from({ length: 10 }, (_, k) => k + 2).map((a) => <option key={a}>{a}</option>)}</NativeSelect>
              </label>
            ))}
            <Counter label={t("search.infants")} value={p.inf} onChange={(n) => set("inf", Math.min(n, p.adt))} />
          </div>
          <div className="space-y-2.5 text-sm">
            <label className="flex items-center justify-between gap-3">{t("search.selfTransfer")}<Switch checked={p.st} onCheckedChange={(v) => set("st", v)} /></label>
            <label className="flex items-center justify-between gap-3">{t("search.airportChange")}<Switch checked={p.ac} onCheckedChange={(v) => set("ac", v)} /></label>
            <label className="flex items-center justify-between gap-3">{t("search.overnight")}<Switch checked={p.on} onCheckedChange={(v) => set("on", v)} /></label>
            <label className="flex items-center justify-between gap-3">{t("search.maxStops")}
              <NativeSelect value={p.stops} onChange={(e) => set("stops", Number(e.target.value))} className="field py-1">{[0, 1, 2].map((n) => <option key={n}>{n}</option>)}</NativeSelect>
            </label>
            <label className="flex items-center justify-between gap-3">{t("search.layoverWindow")}
              <span className="flex items-center gap-1" dir="ltr"><input type="number" min={1} max={12} value={p.lay[0] / 60} onChange={(e) => set("lay", [Number(e.target.value) * 60, p.lay[1]])} className="field w-16 py-1" />–<input type="number" min={1} max={20} value={p.lay[1] / 60} onChange={(e) => set("lay", [p.lay[0], Number(e.target.value) * 60])} className="field w-16 py-1" /> h</span>
            </label>
            <label className="flex items-start justify-between gap-3">{t("search.gateways")}<Switch checked={p.gw} onCheckedChange={(v) => set("gw", v)} /></label>
          </div>
        </div>
      </details>
      <button type="submit" className="btn-orange mt-5 h-13 w-full text-base"><Search className="size-5" />{t("search.submit")}</button>
    </form>
  )
}
