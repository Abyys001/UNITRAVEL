"use client"

import { useQuery } from "@tanstack/react-query"
import { Building2, ChevronDown, PlaneLanding, PlaneTakeoff, Search } from "lucide-react"
import { useId, useMemo, useRef, useState } from "react"

import type { Destination } from "@unitravel/contracts"
import { Popover, PopoverContent, PopoverTrigger } from "@unitravel/ui/components/popover"

import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

export interface PlaceValue { kind: "CITY" | "AIRPORT"; code: string; label: string; country?: string }

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ")

// Flags shipped in /public/flags (circle-flags, MIT); anything else falls back to the neutral globe flag.
const FLAGS = new Set("ae af am at au az be bh ca ch cn cz de dk es eu fi fr gb ge gr hk hu ie in iq ir it jp kr kw my nl no nz om pk pl pt qa ru sa se sg th tr us".split(" "))
export const flagSrc = (country?: string) => `/flags/${country && FLAGS.has(country.toLowerCase()) ? country.toLowerCase() : "xx"}.svg`

interface Option { id: string; value: PlaceValue; title: string; detail: string; code: string; sub: boolean; multi: boolean }
interface Group { country: string; name: string; options: Option[] }

/** Only places with a listed airport (GET /v1/destinations), grouped by country; a multi-airport city also offers each airport (ch. 11.3). */
function useDestinationGroups(q: string): { groups: Group[]; data: Destination[] } {
  const { t, locale, sep } = useI18n()
  const { data = [] } = useQuery({ queryKey: ["destinations"], queryFn: () => api<Destination[]>("/v1/destinations"), staleTime: 3_600_000 })
  return useMemo(() => {
    const fa = locale === "fa"
    const needle = fold(q.trim())
    const groups = new Map<string, Group>()
    for (const d of data) {
      const name = fa ? d.nameFa : d.nameEn
      const country = fa ? d.countryNameFa : d.countryNameEn
      const hay = fold([d.code, d.nameEn, d.nameFa, d.countryNameEn, d.countryNameFa, ...d.airports.flatMap((a) => [a.iata, a.nameEn, a.nameFa])].join(" "))
      if (needle && !hay.includes(needle)) continue
      const g = groups.get(d.country) ?? { country: d.country, name: country, options: [] }
      const multi = d.kind === "CITY"
      g.options.push({
        id: `${d.kind}-${d.code}`, value: { kind: d.kind, code: d.code, label: name, country: d.country }, multi, sub: false, code: d.code,
        title: multi ? t("search.allAirportsIn", { city: name }) : name,
        detail: multi ? t("search.airportsCount", { n: new Intl.NumberFormat(fa ? "fa-IR" : "en-GB").format(d.airports.length) }) : `${fa ? d.airports[0]!.nameFa : d.airports[0]!.nameEn}${sep}${country}`,
      })
      if (multi) for (const a of d.airports) g.options.push({ id: `AIRPORT-${a.iata}`, value: { kind: "AIRPORT", code: a.iata, label: fa ? a.nameFa : a.nameEn, country: d.country }, multi: false, sub: true, code: a.iata, title: fa ? a.nameFa : a.nameEn, detail: name })
      groups.set(d.country, g)
    }
    return { groups: [...groups.values()], data }
  }, [data, q, locale, sep, t])
}

/** From/To dropdown: a searchable listbox of cities and airports with country flags; never free text. */
export function DestinationPicker({ label, value, onChange, direction }: { label: string; value: PlaceValue; onChange: (v: PlaceValue) => void; direction: "from" | "to" }) {
  const { t } = useI18n()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const { groups, data } = useDestinationGroups(q)
  // Searches restored from a link carry no country; look it up so the flag still shows.
  const country = value.country ?? data.find((d) => d.code === value.code || d.airports.some((a) => a.iata === value.code))?.country
  const flat = groups.flatMap((g) => g.options)
  const Leg = direction === "from" ? PlaneTakeoff : PlaneLanding

  const pick = (o: Option) => { onChange(o.value); setOpen(false) }
  const focusOption = (i: number) => {
    setActive(i)
    listRef.current?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" })
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); focusOption(Math.min(active + 1, flat.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusOption(Math.max(active - 1, 0)) }
    else if (e.key === "Home") { e.preventDefault(); focusOption(0) }
    else if (e.key === "End") { e.preventDefault(); focusOption(flat.length - 1) }
    else if (e.key === "Enter" && flat[active]) { e.preventDefault(); pick(flat[active]!) }
  }
  const onOpenChange = (o: boolean) => {
    setOpen(o)
    if (o) { setQ(""); setActive(0) }
  }

  let index = -1
  return (
    <div className="min-w-0">
      <span id={`${id}-label`} className="mb-1 block text-xs font-medium uppercase tracking-wide text-steel">{label}</span>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          type="button" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" data-testid={`dest-${direction}`}
          className="group flex h-16 w-full items-center gap-3 rounded-xl border border-line bg-cloud/60 px-3 text-start outline-none transition-colors hover:border-steel/50 focus-visible:border-orange focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-orange/35 data-[popup-open]:border-orange data-[popup-open]:bg-white"
        >
          <span className="relative shrink-0">
            <img src={flagSrc(country)} alt="" width={32} height={32} className="size-8 rounded-full ring-2 ring-white" />
            <span className="absolute -bottom-1 -end-1 grid size-4.5 place-items-center rounded-full bg-navy-900 text-white ring-2 ring-white"><Leg className="size-2.5" aria-hidden /></span>
          </span>
          <span id={`${id}-value`} className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-navy-950">{value.label}</span>
            <span className="block truncate text-xs text-steel">{value.kind === "CITY" ? t("search.allAirports") : value.code}</span>
          </span>
          <span className="shrink-0 rounded-md bg-navy-900/5 px-1.5 py-0.5 font-mono text-xs font-semibold text-navy-900" dir="ltr">{value.code}</span>
          <ChevronDown className="size-4 shrink-0 text-steel transition-transform group-data-[popup-open]:rotate-180" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} initialFocus={inputRef} style={{ background: "#fff", backdropFilter: "none" }} className="w-[min(calc(100vw-2rem),24rem)] gap-0 overflow-hidden rounded-2xl p-0">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-steel" aria-hidden />
            <input
              ref={inputRef} type="search" role="combobox" aria-expanded aria-controls={`${id}-list`} aria-activedescendant={flat[active] ? `${id}-${flat[active]!.id}` : undefined}
              aria-label={t("search.destSearch")} placeholder={t("search.destSearch")} autoComplete="off" value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0) }} onKeyDown={onKeyDown}
              className="h-12 w-full bg-transparent text-base text-navy-950 outline-none placeholder:text-steel/70"
            />
          </div>
          <div ref={listRef} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain py-1">
            {groups.length === 0 ? <p className="px-4 py-6 text-center text-sm text-steel">{t("search.destEmpty")}</p> : groups.map((g) => (
              <div key={g.country} role="group" aria-labelledby={`${id}-g-${g.country}`}>
                <div id={`${id}-g-${g.country}`} className="sticky top-0 z-10 flex items-center gap-2 bg-white/95 px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-steel">
                  <img src={flagSrc(g.country)} alt="" width={14} height={14} className="size-3.5 rounded-full" />{g.name}
                </div>
                {g.options.map((o) => {
                  const i = ++index
                  const selected = o.value.kind === value.kind && o.code === value.code
                  const Icon = o.multi ? Building2 : Leg
                  return (
                    <div
                      key={o.id} id={`${id}-${o.id}`} data-index={i} role="option" aria-selected={selected}
                      onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseMove={() => active !== i && setActive(i)}
                      className={`mx-1 flex cursor-pointer items-center gap-3 rounded-lg py-2 pe-3 ${o.sub ? "ps-11" : "ps-3"} ${i === active ? "bg-orange/10" : ""} ${selected ? "font-semibold" : ""}`}
                    >
                      <span className={`grid shrink-0 place-items-center rounded-full ${o.sub ? "size-6 text-steel" : "size-8 bg-navy-900/5 text-navy-900"}`}><Icon className={o.sub ? "size-3.5" : "size-4"} aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-navy-950">{o.title}</span>
                        {!o.sub && <span className="block truncate text-xs text-steel">{o.detail}</span>}
                      </span>
                      <span className={`shrink-0 font-mono text-xs ${selected ? "rounded-md bg-orange px-1.5 py-0.5 text-navy-950" : "text-steel"}`} dir="ltr">{o.code}</span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
