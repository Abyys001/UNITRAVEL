"use client"

import { useQuery } from "@tanstack/react-query"
import { Building2, PlaneLanding, PlaneTakeoff } from "lucide-react"
import { useId, useMemo } from "react"

import type { Destination } from "@unitravel/contracts"

import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

import { type ComboItem, ComboField } from "./form/combo-field"

export interface PlaceValue { kind: "CITY" | "AIRPORT"; code: string; label: string; country?: string }

// Flags shipped in /public/flags (circle-flags, MIT); anything else falls back to the neutral globe flag.
const FLAGS = new Set("ae af am at au az be bh ca ch cn cz de dk es eu fi fr gb ge gr hk hu ie in iq ir it jp kr kw my nl no nz om pk pl pt qa ru sa se sg th tr us".split(" "))
export const flagSrc = (country?: string) => `/flags/${country && FLAGS.has(country.toLowerCase()) ? country.toLowerCase() : "xx"}.svg`

interface Option extends ComboItem { place: PlaceValue; title: string; detail: string; code: string; sub: boolean; multi: boolean }

/** Only places with a listed airport (GET /v1/destinations), grouped by country; a multi-airport city also offers each airport (ch. 11.3). */
function useDestinationOptions(): { options: Option[]; groupNames: Map<string, string>; data: Destination[] } {
  const { t, locale, sep } = useI18n()
  const { data = [] } = useQuery({ queryKey: ["destinations"], queryFn: () => api<Destination[]>("/v1/destinations"), staleTime: 3_600_000 })
  return useMemo(() => {
    const fa = locale === "fa"
    const options: Option[] = []
    const groupNames = new Map<string, string>()
    for (const d of data) {
      const name = fa ? d.nameFa : d.nameEn
      const country = fa ? d.countryNameFa : d.countryNameEn
      groupNames.set(d.country, country)
      // Every row of a destination carries the whole destination's words, so a search for one airport still shows its city.
      const keywords = [d.code, d.nameEn, d.nameFa, d.countryNameEn, d.countryNameFa, ...d.airports.flatMap((a) => [a.iata, a.nameEn, a.nameFa])]
      const multi = d.kind === "CITY"
      const title = multi ? t("search.allAirportsIn", { city: name }) : name
      options.push({
        value: `${d.kind}-${d.code}`, label: title, keywords, group: d.country, place: { kind: d.kind, code: d.code, label: name, country: d.country }, multi, sub: false, code: d.code, title,
        detail: multi ? t("search.airportsCount", { n: new Intl.NumberFormat(fa ? "fa-IR" : "en-GB").format(d.airports.length) }) : `${fa ? d.airports[0]!.nameFa : d.airports[0]!.nameEn}${sep}${country}`,
      })
      if (multi) for (const a of d.airports) options.push({ value: `AIRPORT-${a.iata}`, label: fa ? a.nameFa : a.nameEn, keywords, group: d.country, place: { kind: "AIRPORT", code: a.iata, label: fa ? a.nameFa : a.nameEn, country: d.country }, multi: false, sub: true, code: a.iata, title: fa ? a.nameFa : a.nameEn, detail: name })
    }
    return { options, groupNames, data }
  }, [data, locale, sep, t])
}

/** From/To dropdown: a searchable listbox of cities and airports with country flags; never free text. */
export function DestinationPicker({ label, value, onChange, direction }: { label: string; value: PlaceValue; onChange: (v: PlaceValue) => void; direction: "from" | "to" }) {
  const { t } = useI18n()
  const id = useId()
  const { options, groupNames, data } = useDestinationOptions()
  // Searches restored from a link carry no country; look it up so the flag still shows.
  const country = value.country ?? data.find((d) => d.code === value.code || d.airports.some((a) => a.iata === value.code))?.country
  const Leg = direction === "from" ? PlaneTakeoff : PlaneLanding

  return (
    <ComboField<Option>
      id={id} label={label} items={options} value={`${value.kind}-${value.code}`} onChange={(_, o) => onChange(o.place)} testId={`dest-${direction}`}
      placeholder={t("search.destSearch")} emptyText={t("search.destEmpty")} className="" labelClassName="text-xs font-medium uppercase tracking-wide text-steel"
      triggerClassName="group flex h-16 w-full items-center gap-3 rounded-xl border border-line bg-cloud/60 px-3 text-start outline-none transition-colors hover:border-steel/50 focus-visible:border-orange focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-orange/35 data-[popup-open]:border-orange data-[popup-open]:bg-white"
      groupLabel={(c) => <><img src={flagSrc(c)} alt="" width={14} height={14} className="size-3.5 rounded-full" />{groupNames.get(c)}</>}
      itemClassName={(o) => `pe-3 ${o.sub ? "ps-11" : "ps-3"}`}
      renderValue={(_, valueId) => (
        <>
          <span className="relative shrink-0">
            <img src={flagSrc(country)} alt="" width={32} height={32} className="size-8 rounded-full ring-2 ring-white" />
            <span className="absolute -bottom-1 -end-1 grid size-4.5 place-items-center rounded-full bg-navy-900 text-white ring-2 ring-white"><Leg className="size-2.5" aria-hidden /></span>
          </span>
          <span id={valueId} className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-navy-950">{value.label}</span>
            <span className="block truncate text-xs text-steel">{value.kind === "CITY" ? t("search.allAirports") : value.code}</span>
          </span>
          <span className="shrink-0 rounded-md bg-navy-900/5 px-1.5 py-0.5 font-mono text-xs font-semibold text-navy-900" dir="ltr">{value.code}</span>
        </>
      )}
      renderItem={(o, { selected }) => {
        const Icon = o.multi ? Building2 : Leg
        return (
          <>
            <span className={`grid shrink-0 place-items-center rounded-full ${o.sub ? "size-6 text-steel" : "size-8 bg-navy-900/5 text-navy-900"}`}><Icon className={o.sub ? "size-3.5" : "size-4"} aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-navy-950">{o.title}</span>
              {!o.sub && <span className="block truncate text-xs text-steel">{o.detail}</span>}
            </span>
            <span className={`shrink-0 font-mono text-xs ${selected ? "rounded-md bg-orange px-1.5 py-0.5 text-navy-950" : "text-steel"}`} dir="ltr">{o.code}</span>
          </>
        )
      }}
    />
  )
}
