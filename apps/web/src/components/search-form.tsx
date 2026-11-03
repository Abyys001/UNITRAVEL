"use client"

import { ArrowLeftRight, ArrowRight, Baby, CalendarDays, CalendarPlus, ChevronDown, Clock, Luggage, MapPinned, Minus, Moon, PersonStanding, Plus, Route, Search, Shuffle, User, Users, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useId, useRef, useState } from "react"

import { NativeSelect } from "@unitravel/ui/components/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@unitravel/ui/components/popover"
import { Switch } from "@unitravel/ui/components/switch"

import { useI18n } from "@/lib/i18n"

import { Calendar, useDateParts } from "./calendar"
import { DestinationPicker, type PlaceValue } from "./destination-picker"

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
const addDays = (d: string, n: number) => iso(new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000))
const MAX_PASSENGERS = 9

/** Depart and return as one control on the shared calendar; a one-way trip offers "add return" in the same place. */
function TripDatesField({ p, setP }: { p: SearchParamsShape; setP: React.Dispatch<React.SetStateAction<SearchParamsShape>> }) {
  const { t } = useI18n()
  const parts = useDateParts()
  const [open, setOpen] = useState<false | "start" | "end">(false)
  // Which half was clicked; Base UI reports the open change separately from the trigger's click.
  const intent = useRef<"start" | "end">("start")
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const onOpenChange = (o: boolean) => {
    // On phones there is no room above or below for a month grid; bring the field to the top so it opens downwards.
    if (o && window.matchMedia("(max-width: 767px)").matches) fieldRef.current?.scrollIntoView({ block: "start" })
    setOpen(o ? intent.current : false)
  }
  const cursorRef = useRef<HTMLButtonElement | null>(null)
  const today = iso(new Date())
  const isReturn = p.trip === "RETURN"
  const part = (label: string, d: string) => (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-xs font-medium uppercase tracking-wide text-steel">{label} · <span className="normal-case">{parts(d).weekday}</span></span>
      <span className="mt-0.5 block truncate text-base font-semibold text-navy-950">{parts(d).date}</span>
    </span>
  )
  const segment = "flex min-w-0 flex-1 items-center gap-3 px-3 text-start outline-none transition-colors hover:bg-white/70 focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-orange/35 data-[popup-open]:bg-white"
  return (
    <Popover open={!!open} onOpenChange={onOpenChange}>
      <div ref={fieldRef} className={`flex h-16 scroll-mt-20 items-stretch overflow-hidden rounded-xl border bg-cloud/60 transition-colors ${open ? "border-orange" : "border-line hover:border-steel/50"}`}>
        <PopoverTrigger type="button" data-testid="flight-depart" className={segment} onClick={() => { intent.current = "start" }} aria-label={`${t("search.date")}: ${parts(p.date).weekday} ${parts(p.date).date}`}>
          <CalendarDays className="size-5 shrink-0 text-orange-700" aria-hidden />
          {part(t("search.date"), p.date)}
        </PopoverTrigger>
        <span className="my-3 w-px shrink-0 bg-line" aria-hidden />
        {isReturn && p.ret ? (
          <span className="relative flex min-w-0 flex-1">
            <PopoverTrigger type="button" data-testid="flight-return" className={`${segment} pe-9`} onClick={() => { intent.current = "end" }} aria-label={`${t("search.returnDate")}: ${parts(p.ret).weekday} ${parts(p.ret).date}`}>
              <ArrowRight className="size-4 shrink-0 text-orange-700 rtl:rotate-180" aria-hidden />
              {part(t("search.returnDate"), p.ret)}
            </PopoverTrigger>
            <button type="button" aria-label={t("search.oneWay")} onClick={() => setP((x) => ({ ...x, trip: "ONE_WAY", ret: undefined }))} className="absolute end-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-steel outline-none hover:bg-navy-900/5 hover:text-navy-950 focus-visible:ring-[3px] focus-visible:ring-royal/50 pointer-coarse:size-11"><X className="size-4" aria-hidden /></button>
          </span>
        ) : (
          <PopoverTrigger type="button" data-testid="flight-add-return" className={`${segment} text-sm font-semibold text-steel hover:text-navy-950`} onClick={() => { intent.current = "end" }}>
            <CalendarPlus className="size-5 shrink-0" aria-hidden />{t("search.return")}
          </PopoverTrigger>
        )}
      </div>
      <PopoverContent align="start" sideOffset={8} initialFocus={cursorRef} style={{ background: "#fff", backdropFilter: "none" }} className="w-[min(calc(100vw-2rem),22rem)] rounded-2xl p-4 md:w-[42rem]">
        {open && (
          <Calendar
            key={`${p.trip}-${open}`} mode={isReturn || open === "end" ? "range" : "single"} start={p.date} end={p.ret ?? null} initialPicking={open} min={today} today={today} minSpan={0} cursorRef={cursorRef} testId="flight-calendar"
            labels={{ start: t("search.date"), end: t("search.returnDate"), pickStart: t("search.pickDepart"), pickEnd: t("search.pickReturn") }}
            onCommit={(a, b) => { setP((x) => (b ? { ...x, trip: "RETURN", date: a, ret: b } : { ...x, date: a })); setOpen(false) }}
            footer={
              <label className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm font-medium text-navy-950 has-checked:border-orange has-checked:bg-orange/10 pointer-coarse:min-h-11">
                <input type="checkbox" checked={p.flex} onChange={(e) => setP((x) => ({ ...x, flex: e.target.checked }))} className="size-4 accent-orange" />
                {t("search.flex")}<span className="sr-only">{t("search.flexHint")}</span>
              </label>
            }
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function Stepper({ label, hint, icon: Icon, value, onChange, min = 0, max }: { label: string; hint: string; icon: React.ComponentType<{ className?: string }>; value: number; onChange: (n: number) => void; min?: number; max: number }) {
  const { locale } = useI18n()
  const id = useId()
  const btn = "grid size-8 place-items-center rounded-full text-navy-900 outline-none transition-colors enabled:hover:bg-white enabled:hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:text-steel/40 pointer-coarse:size-11"
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-900/5 text-navy-900"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span id={id} className="block text-sm font-semibold text-navy-950">{label}</span>
        <span className="block text-xs text-steel">{hint}</span>
      </span>
      <span role="group" aria-labelledby={id} className="flex items-center gap-1 rounded-full border border-line bg-cloud p-0.5">
        <button type="button" className={btn} aria-label={`− ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus className="size-4" /></button>
        <output aria-live="polite" className="w-6 text-center text-sm font-bold tabular-nums text-navy-950">{new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB").format(value)}</output>
        <button type="button" className={btn} aria-label={`+ ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus className="size-4" /></button>
      </span>
    </div>
  )
}

function ToggleRow({ icon: Icon, label, hint, checked, onChange }: { icon: React.ComponentType<{ className?: string }>; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className={`grid size-9 shrink-0 place-items-center rounded-full transition-colors ${checked ? "bg-orange/15 text-orange-700" : "bg-navy-900/5 text-steel"}`}><Icon className="size-4.5" /></span>
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer text-sm font-semibold text-navy-950">{label}</label>
        <span id={`${id}-hint`} className="block text-xs leading-relaxed text-steel">{hint}</span>
      </span>
      <Switch id={id} aria-describedby={`${id}-hint`} checked={checked} onCheckedChange={onChange} className="mt-1" />
    </div>
  )
}

/** Travellers and connection preferences: a summary line that opens two cards (ch. 11.3). */
function TravellersPanel({ p, set }: { p: SearchParamsShape; set: <K extends keyof SearchParamsShape>(k: K, v: SearchParamsShape[K]) => void }) {
  const { t, locale, sep } = useI18n()
  const [open, setOpen] = useState(false)
  const num = (n: number) => new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB").format(n)
  const total = p.adt + p.chd.length + p.inf
  const room = MAX_PASSENGERS - total
  const stopsText = p.stops === 0 ? t("search.direct") : p.stops === 1 ? t("search.stopsUpToOne") : t("search.stopsUpTo", { n: num(p.stops) })
  const card = "rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgb(10_27_61/0.04)]"
  const heading = (Icon: React.ComponentType<{ className?: string }>, title: string, badge?: string) => (
    <div className="mb-1 flex items-center gap-2 border-b border-line pb-3">
      <Icon className="size-4 text-orange-700" />
      <h3 className="text-sm font-bold text-navy-950">{title}</h3>
      {badge ? <span className="ms-auto rounded-full bg-navy-900 px-2 py-0.5 text-xs font-semibold text-white">{badge}</span> : null}
    </div>
  )
  const setLay = (i: 0 | 1, h: number) => {
    const next: [number, number] = [...p.lay]
    next[i] = h * 60
    if (next[0] > next[1]) next[i === 0 ? 1 : 0] = h * 60
    set("lay", next)
  }
  const hourStepper = (i: 0 | 1, lo: number, hi: number) => {
    const h = p.lay[i] / 60
    return (
      <span className="flex items-center gap-1 rounded-full border border-line bg-cloud p-0.5">
        <button type="button" aria-label={`− ${t("search.layoverWindow")}`} disabled={h <= lo} onClick={() => setLay(i, h - 1)} className="grid size-7 place-items-center rounded-full outline-none enabled:hover:bg-white focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:text-steel/40 pointer-coarse:size-11"><Minus className="size-3.5" /></button>
        <span className="min-w-12 text-center text-sm font-semibold tabular-nums text-navy-950">{t("search.hours", { n: num(h) })}</span>
        <button type="button" aria-label={`+ ${t("search.layoverWindow")}`} disabled={h >= hi} onClick={() => setLay(i, h + 1)} className="grid size-7 place-items-center rounded-full outline-none enabled:hover:bg-white focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:text-steel/40 pointer-coarse:size-11"><Plus className="size-3.5" /></button>
      </span>
    )
  }
  return (
    <div className="@container mt-3 rounded-2xl border border-line bg-cloud/40">
      <button
        type="button" aria-expanded={open} aria-controls="search-prefs" onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-4 py-3 text-start outline-none transition-colors hover:bg-white/60 focus-visible:ring-[3px] focus-visible:ring-royal/50 pointer-coarse:min-h-11"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-navy-950"><Users className="size-4 text-orange-700" aria-hidden />{t("search.travellers")}{sep}{t("search.preferences")}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-navy-900">
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-line">{total === 1 ? t("search.travellersOne") : t("search.travellersMany", { n: num(total) })}</span>
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-line">{stopsText}</span>
          {p.st && <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-line">{t("truth.SEPARATE_TICKETS")}</span>}
        </span>
        <ChevronDown className={`ms-auto size-4 text-steel transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div id="search-prefs" className="grid gap-3 px-3 pb-3 @3xl:grid-cols-2">
          <section className={card} aria-label={t("search.travellers")}>
            {heading(Users, t("search.travellers"), num(total))}
            <div className="divide-y divide-line/70">
              <Stepper icon={User} label={t("search.adults")} hint={t("search.adultsHint")} value={p.adt} min={1} max={p.adt + room} onChange={(n) => { set("adt", n); if (p.inf > n) set("inf", n) }} />
              <Stepper icon={PersonStanding} label={t("search.children")} hint={t("search.childrenHint")} value={p.chd.length} max={p.chd.length + room} onChange={(n) => set("chd", n > p.chd.length ? [...p.chd, 8] : p.chd.slice(0, n))} />
              {p.chd.length > 0 && (
                <fieldset className="py-2.5">
                  <legend className="mb-2 text-xs font-medium text-steel">{t("search.agesLabel")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {p.chd.map((age, i) => (
                      <label key={i} className="flex items-center gap-1.5 rounded-full border border-line bg-cloud ps-3 text-xs text-steel">
                        <span className="sr-only">{t("search.childAge", { n: i + 1 })}</span><span aria-hidden>{num(i + 1)}</span>
                        <NativeSelect value={age} onChange={(e) => set("chd", p.chd.map((a, j) => (j === i ? Number(e.target.value) : a)))} className="h-8 rounded-full border-0 bg-white py-0 ps-2 pe-7 text-sm font-semibold text-navy-950 pointer-coarse:h-11">
                          {Array.from({ length: 10 }, (_, k) => k + 2).map((a) => <option key={a} value={a}>{num(a)}</option>)}
                        </NativeSelect>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <Stepper icon={Baby} label={t("search.infants")} hint={p.inf >= p.adt ? t("search.infantsLimit") : t("search.infantsHint")} value={p.inf} max={Math.min(p.adt, p.inf + room)} onChange={(n) => set("inf", n)} />
            </div>
          </section>
          <section className={card} aria-label={t("search.connections")}>
            {heading(Route, t("search.connections"))}
            <div className="py-2.5">
              <p id="stops-label" className="mb-2 text-sm font-semibold text-navy-950">{t("search.maxStops")}</p>
              <div role="radiogroup" aria-labelledby="stops-label" className="grid grid-cols-3 gap-1 rounded-xl bg-cloud p-1">
                {[0, 1, 2].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={p.stops === n} onClick={() => set("stops", n)} className={`rounded-lg py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-royal/50 pointer-coarse:min-h-11 ${p.stops === n ? "bg-navy-900 text-white shadow-sm" : "text-steel hover:text-navy-950"}`}>
                    {n === 0 ? t("search.direct") : num(n)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-b border-line/70 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-900/5 text-steel"><Clock className="size-4.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-navy-950">{t("search.layoverWindow")}</span>
                <span className="block text-xs text-steel">{t("search.layoverHint")}</span>
              </span>
              <span className="ms-auto flex items-center gap-1.5" dir="ltr">{hourStepper(0, 1, 12)}<span className="text-steel">–</span>{hourStepper(1, 1, 20)}</span>
            </div>
            <div className="divide-y divide-line/70">
              <ToggleRow icon={Luggage} label={t("search.selfTransfer")} hint={t("search.selfTransferHint")} checked={p.st} onChange={(v) => set("st", v)} />
              <ToggleRow icon={Shuffle} label={t("search.airportChange")} hint={t("search.airportChangeHint")} checked={p.ac} onChange={(v) => set("ac", v)} />
              <ToggleRow icon={Moon} label={t("search.overnight")} hint={t("search.overnightHint")} checked={p.on} onChange={(v) => set("on", v)} />
              <ToggleRow icon={MapPinned} label={t("search.gatewaysShort")} hint={t("search.gateways")} checked={p.gw} onChange={(v) => set("gw", v)} />
            </div>
          </section>
          <div className="flex justify-end @3xl:col-span-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-navy-900 px-5 py-2 text-sm font-semibold text-white outline-none transition-colors hover:bg-navy-950 focus-visible:ring-[3px] focus-visible:ring-royal/50 pointer-coarse:min-h-11">{t("search.done")}</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The search form (ch. 11.3): gateway departures default on for restricted-origin countries. */
export function SearchForm({ initial }: { initial?: Partial<SearchParamsShape> }) {
  const { t, href, locale } = useI18n()
  const router = useRouter()
  const [p, setP] = useState<SearchParamsShape>(() => {
    const date = iso(new Date(Date.now() + 23 * 86400_000))
    return {
      trip: "ONE_WAY", from: { kind: "CITY", code: "THR", label: locale === "fa" ? "تهران" : "Tehran", country: "IR" }, to: { kind: "CITY", code: "LON", label: locale === "fa" ? "لندن" : "London", country: "GB" },
      date, adt: 1, chd: [], inf: 0, cabin: "ECONOMY", flex: false, st: true, ac: false, on: true, gw: true, stops: 2, lay: [240, 360], ...initial,
    }
  })
  const set = <K extends keyof SearchParamsShape>(k: K, v: SearchParamsShape[K]) => setP((x) => ({ ...x, [k]: v }))
  const setTrip = (trip: SearchParamsShape["trip"]) => setP((x) => ({ ...x, trip, ret: trip === "RETURN" ? (x.ret ?? addDays(x.date, 7)) : undefined }))
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    router.push(href(`/search?q=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(p)))))}`))
  }
  return (
    <form onSubmit={submit} className="rounded-[24px] border border-white/60 bg-white p-4 text-navy-950 shadow-[var(--shadow-lift)] md:p-6" aria-label={t("search.submit")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-full bg-cloud p-1 text-sm font-semibold" role="radiogroup">
          {(["ONE_WAY", "RETURN"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={p.trip === k} onClick={() => setTrip(k)} className={`rounded-full px-4 py-1.5 transition-colors pointer-coarse:min-h-11 ${p.trip === k ? "bg-navy-900 text-white shadow-sm" : "text-steel hover:text-navy-950"}`}>{t(k === "ONE_WAY" ? "search.oneWay" : "search.return")}</button>
          ))}
        </div>
        <label className="text-xs font-medium uppercase tracking-wide text-steel">
          <span className="sr-only">{t("search.cabin")}</span>
          <NativeSelect value={p.cabin} onChange={(e) => set("cabin", e.target.value)} aria-label={t("search.cabin")} className="h-9 rounded-full border border-line bg-cloud ps-4 pe-8 text-sm font-semibold normal-case tracking-normal text-navy-950 pointer-coarse:h-11">
            <option value="ECONOMY">{t("search.economy")}</option><option value="PREMIUM_ECONOMY">{t("search.premium")}</option><option value="BUSINESS">{t("search.business")}</option><option value="FIRST">{t("search.first")}</option>
          </NativeSelect>
        </label>
      </div>
      <div className="relative grid gap-3 md:grid-cols-2">
        <DestinationPicker direction="from" label={t("search.from")} value={p.from} onChange={(v) => set("from", v)} />
        <button type="button" className="absolute start-1/2 top-[calc(50%+0.625rem)] z-10 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-orange bg-white p-2 text-navy-900 shadow-sm transition-transform hover:rotate-180 md:block rtl:translate-x-1/2" aria-label="Swap" onClick={() => setP((x) => ({ ...x, from: x.to, to: x.from }))}><ArrowLeftRight className="size-4" /></button>
        <DestinationPicker direction="to" label={t("search.to")} value={p.to} onChange={(v) => set("to", v)} />
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-steel">{t(p.trip === "RETURN" ? "search.return" : "search.oneWay")}{p.flex ? ` · ${t("search.flex")}` : ""}</span>
        <TripDatesField p={p} setP={setP} />
      </div>
      <TravellersPanel p={p} set={set} />
      <button type="submit" className="btn-orange mt-5 h-13 w-full text-base"><Search className="size-5" />{t("search.submit")}</button>
    </form>
  )
}
