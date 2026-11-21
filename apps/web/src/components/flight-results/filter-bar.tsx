"use client"

import { ChevronDown, SlidersHorizontal } from "lucide-react"
import { useState } from "react"

import { SelectField } from "@/components/form"
import { useI18n } from "@/lib/i18n"

import { activeFilterCount, type DepWindow, type ResultFilters, SORTS, STOPS, type StopsFilter, type SortKey, WINDOWS } from "./filters"

/** Base UI treats "" as "no selection", so the any-option needs a real value. */
const ALL = "all"

/** Stops, airline (derived from the results), departure window and sort. Below `md` the controls collapse into a disclosure. */
export function FilterBar({ filters, airlines, onChange, onClear }: {
  filters: ResultFilters
  airlines: { code: string; count: number }[]
  onChange: (patch: Partial<ResultFilters>) => void
  onClear: () => void
}) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const nf = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB")
  const active = activeFilterCount(filters)
  const stopLabel: Record<StopsFilter, string> = { any: t("guide.flights.stopsAny"), direct: t("guide.flights.stopsDirect"), max1: t("guide.flights.stopsMax1") }
  const depLabel: Record<DepWindow, string> = { night: t("guide.flights.depNight"), morning: t("guide.flights.depMorning"), afternoon: t("guide.flights.depAfternoon"), evening: t("guide.flights.depEvening") }
  const sortLabel: Record<SortKey, string> = { departure: t("guide.flights.sortDeparture"), arrival: t("guide.flights.sortArrival"), duration: t("guide.flights.sortDuration") }
  const airlineOptions = [{ value: ALL, label: t("guide.flights.airlineAny") }, ...airlines.map((a) => ({ value: a.code, label: t("guide.flights.airlineOption", { code: a.code, n: nf.format(a.count) }) }))]
  return (
    <section aria-label={t("guide.flights.filtersTitle")} className="card-brand mb-5 rounded-2xl p-3 sm:p-4" data-testid="flight-filters">
      <div className="flex items-center justify-between gap-2 md:hidden">
        <button
          type="button" aria-expanded={open} aria-controls="flight-filter-panel" onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-navy-900 focus-visible:outline-2 focus-visible:outline-orange"
        >
          <SlidersHorizontal aria-hidden className="size-4" />{t("guide.flights.filtersToggle")}
          {active > 0 && <span className="rounded-full bg-orange-700 px-2 py-0.5 text-xs text-white">{t("guide.flights.filtersActive", { n: nf.format(active) })}</span>}
          <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      <div id="flight-filter-panel" className={`${open ? "grid" : "hidden"} mt-3 gap-3 sm:grid-cols-2 md:mt-0 md:grid lg:grid-cols-4`}>
        <SelectField id="flt-stops" label={t("guide.flights.stopsLabel")} value={filters.stops} options={STOPS.map((v) => ({ value: v, label: stopLabel[v] }))} onChange={(v) => onChange({ stops: v as StopsFilter })} />
        <SelectField id="flt-airline" label={t("guide.flights.airlineLabel")} value={filters.airline || ALL} options={airlineOptions} onChange={(v) => onChange({ airline: v === ALL ? "" : v })} />
        <SelectField id="flt-dep" label={t("guide.flights.depLabel")} value={filters.dep || ALL} options={[{ value: ALL, label: t("guide.flights.depAny") }, ...WINDOWS.map((v) => ({ value: v, label: depLabel[v] }))]} onChange={(v) => onChange({ dep: v === ALL ? "" : (v as DepWindow) })} />
        <SelectField id="flt-sort" label={t("guide.flights.sortLabel")} value={filters.sort} options={SORTS.map((v) => ({ value: v, label: sortLabel[v] }))} onChange={(v) => onChange({ sort: v as SortKey })} />
      </div>
      {active > 0 && (
        <p className="mt-3"><button type="button" onClick={onClear} className="text-sm font-semibold text-orange-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-orange" data-testid="clear-filters">{t("guide.flights.clear")}</button></p>
      )}
    </section>
  )
}
