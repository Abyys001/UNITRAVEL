"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowUpFromDot, Gauge, Globe, LoaderCircle, Plane, PlaneTakeoff, Radio, Search } from "lucide-react"
import { useState, type CSSProperties, type ReactNode } from "react"

import { LIVE_FLIGHT_REGIONS, type LiveFlightItem, type LiveFlightRegion, type LiveFlightsView } from "@unitravel/contracts"
import { Country, CountryFlag } from "@unitravel/ui/product/country"

import { Ltr } from "@/components/badges"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

const REFRESH_MS = 30_000
const PAGE_SIZE = 10
/** The contract's `limit` ceiling. */
const MAX_ROWS = 200
const ALTITUDE_SCALE_FT = 45_000
const SPEED_SCALE_KT = 600
const SKY_ARC = "M-20 45C200 -5 520 -5 820 40"
const REGION_FLAG: Record<LiveFlightRegion, string> = { EUROPE: "eu", TURKEY: "tr", UAE: "ae", IRAN: "ir" }

/** Aircraft in the air now (ADR-0027). A board of observations, kept apart from fares: nothing here can be booked. */
export function LiveFlights() {
  const { t, date } = useI18n()
  const [region, setRegion] = useState<LiveFlightRegion | null>(null)
  const [search, setSearch] = useState("")
  const [limit, setLimit] = useState(PAGE_SIZE)
  const callsign = search.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7)
  const params = new URLSearchParams({ limit: String(limit) })
  if (region) params.set("region", region)
  if (callsign) params.set("q", callsign)
  // One growing request rather than offset pages: the 30-second refresh then costs one call, and rows cannot shift between pages.
  const q = useQuery({
    queryKey: ["live-flights", region, callsign, limit],
    queryFn: () => api<LiveFlightsView>(`/v1/live-flights?${params.toString()}`),
    refetchInterval: REFRESH_MS,
    placeholderData: (previous) => previous,
  })
  // Switched off on this host, or unreachable: the search form above stands alone.
  if (q.isError || q.data?.notice === "OFF") return null
  const data = q.data
  const allCount = data ? LIVE_FLIGHT_REGIONS.reduce((n, r) => n + data.regions[r], 0) : 0
  const shown = data?.items.length ?? 0
  const total = data?.total ?? 0
  const nextPage = Math.min(PAGE_SIZE, total - shown, MAX_ROWS - shown)
  const pickRegion = (r: LiveFlightRegion | null) => { setRegion(r); setLimit(PAGE_SIZE) }

  return (
    <section className="sky mt-10 rounded-[28px] p-5 text-white md:p-8" aria-labelledby="live-flights-title" data-testid="live-flights">
      <div aria-hidden className="sky-radar"><span className="sky-sweep" /><span className="sky-blip" style={{ insetBlockStart: "32%", insetInlineStart: "26%" }} /><span className="sky-blip" style={{ insetBlockStart: "62%", insetInlineStart: "58%", animationDelay: "1.1s" }} /><span className="sky-blip" style={{ insetBlockStart: "44%", insetInlineStart: "72%", animationDelay: "2s" }} /></div>
      {/* Decoration only, without the usual map pin: this board must not suggest a route or destination (ADR-0027). */}
      <svg aria-hidden viewBox="0 0 800 60" className="pointer-events-none absolute inset-x-0 top-3 w-full overflow-visible opacity-60 rtl:-scale-x-100">
        <path d={SKY_ARC} fill="none" stroke="rgb(255 255 255 / 0.55)" strokeWidth="1.5" strokeDasharray="6 9" strokeLinecap="round" className="animate-dash" />
        <g className="fly-path" style={{ offsetPath: `path("${SKY_ARC}")`, "--fly-duration": "14s" } as CSSProperties}><path transform="scale(-1 1) translate(-12 -12)" fill="#fff" d="M2 13.2 9.5 12 14 3h2.6l-2.2 9 7.1-.6 2.2-3h1.8l-1 4.8 1 4.8h-1.8l-2.2-3-7.1-.6 2.2 9H14l-4.5-9L2 15.2z" /></g>
      </svg>

      <div className="relative">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold tracking-wide"><span aria-hidden className="sky-live" />{t("liveFlights.live")}</span>
            <h2 id="live-flights-title" className="mt-3 font-display text-3xl md:text-5xl">{t("liveFlights.title")}</h2>
            <p className="mt-3 text-sm leading-6 text-white/80">{t("liveFlights.lead")}</p>
          </div>
          {data && allCount > 0 && (
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-14 place-items-center rounded-2xl bg-orange text-navy-950 shadow-[0_12px_30px_-10px_rgb(255_134_23/0.8)]"><Plane className="size-7 rtl:-scale-x-100" /></span>
              <p><span key={allCount} className="sky-pop block font-display text-4xl leading-none tabular-nums"><Ltr>{allCount.toLocaleString("en-GB")}</Ltr></span><span className="mt-1 block text-xs text-white/75">{t("liveFlights.tracked")}</span></p>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("liveFlights.regionLabel")}>
            <RegionChip active={region === null} onClick={() => pickRegion(null)} icon={<Globe aria-hidden className="size-4" />} label={t("liveFlights.all")} count={allCount} />
            {LIVE_FLIGHT_REGIONS.map((r) => <RegionChip key={r} active={region === r} onClick={() => pickRegion(r)} icon={<CountryFlag code={REGION_FLAG[r]} />} label={t(`liveFlights.region.${r}`)} count={data?.regions[r] ?? 0} />)}
          </div>
          <label className="relative ms-auto block w-full sm:w-56">
            <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-steel" />
            <input type="search" dir="ltr" className="field h-10 w-full ps-10 text-navy-950" placeholder={t("liveFlights.searchPlaceholder")} aria-label={t("liveFlights.searchPlaceholder")} value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE_SIZE) }} />
          </label>
        </div>

        {data?.updatedAt && (
          <p className="mt-4 flex items-center gap-2 text-xs text-white/75">
            <svg key={q.dataUpdatedAt} aria-hidden viewBox="0 0 20 20" className="size-4 -rotate-90"><circle cx="10" cy="10" r="8" fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="3" /><circle cx="10" cy="10" r="8" fill="none" stroke="var(--color-cyan)" strokeWidth="3" pathLength="100" strokeDasharray="100" className="sky-timer" style={{ animationDuration: `${REFRESH_MS}ms` }} /></svg>
            {t("liveFlights.updated", { time: date(data.updatedAt, { withTime: true }) })}
          </p>
        )}

        {q.isLoading && (
          <div role="status" aria-label={t("liveFlights.loading")} className="mt-4 grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="sky-skeleton h-44 rounded-2xl" />)}
          </div>
        )}
        {data && shown === 0 && (
          <div role="status" className="mt-4 rounded-2xl border border-white/15 bg-white/5 px-6 py-12 text-center">
            <Radio aria-hidden className="mx-auto size-8 text-cyan" />
            <p className="mt-3 font-semibold">{data.notice === "NO_DATA" ? t("liveFlights.noData") : t("liveFlights.noMatch")}</p>
          </div>
        )}
        {data && shown > 0 && (
          <>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {data.items.map((f, i) => <FlightCard key={f.hex} flight={f} index={i} now={q.dataUpdatedAt} />)}
            </ul>

            <div className="mt-6 flex flex-col items-center gap-3">
              <div aria-hidden className="sky-progress"><span style={{ width: `${(shown / total) * 100}%` }} /></div>
              <p className="text-sm text-white/80" aria-live="polite">{t("liveFlights.showing", { shown, total })}</p>
              {nextPage > 0 && (
                <button type="button" className="sky-more" disabled={q.isFetching} onClick={() => setLimit(shown + nextPage)} data-testid="live-flights-more">
                  {q.isFetching ? <LoaderCircle aria-hidden className="size-5 animate-spin" /> : <PlaneTakeoff aria-hidden className="size-5 rtl:-scale-x-100" />}
                  {t("liveFlights.loadMore", { n: nextPage })}
                </button>
              )}
              {shown >= MAX_ROWS && total > shown && <p className="text-center text-sm text-white/80">{t("liveFlights.refine")}</p>}
            </div>
          </>
        )}

        <p className="mt-6 border-t border-white/10 pt-4 text-xs leading-5 text-white/70">
          {t("liveFlights.note")}{" "}
          <a className="underline" href="https://adsb.lol" target="_blank" rel="noopener noreferrer">adsb.lol</a>{", "}
          <a className="underline" href="https://opendatacommons.org/licenses/odbl/summary/" target="_blank" rel="noopener noreferrer">ODbL</a>
        </p>
      </div>
    </section>
  )
}

function FlightCard({ flight: f, index, now }: { flight: LiveFlightItem; index: number; now: number }) {
  const { t } = useI18n()
  const minutes = Math.max(0, Math.floor((now - Date.parse(f.seenAt)) / 60_000))
  return (
    <li className="sky-card" style={{ "--i": index % PAGE_SIZE } as CSSProperties} data-testid="live-flight">
      <div className="flex items-center gap-3">
        <span aria-hidden className="sky-disc"><Plane className="sky-plane size-5 rtl:-scale-x-100" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-white/70">{t("liveFlights.callsign")}</p>
          <p className="truncate font-mono text-xl font-bold tracking-wider"><Ltr>{f.callsign}</Ltr></p>
        </div>
        <div className="text-end">
          <p className="text-[11px] font-semibold text-white/70">{t("liveFlights.aircraft")}</p>
          <p className="mt-0.5 inline-block rounded-lg bg-white/12 px-2 py-0.5 font-mono text-sm font-semibold">{f.aircraftType ? <Ltr>{f.aircraftType}</Ltr> : "—"}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <Meter icon={<ArrowUpFromDot aria-hidden className="size-3.5" />} label={t("liveFlights.altitude")} value={`${f.altitudeFt.toLocaleString("en-GB")} ft`} ratio={f.altitudeFt / ALTITUDE_SCALE_FT} tone="sky-fill-cyan" />
        <Meter icon={<Gauge aria-hidden className="size-3.5" />} label={t("liveFlights.speed")} value={f.groundSpeedKt === null ? null : `${f.groundSpeedKt} kt`} ratio={(f.groundSpeedKt ?? 0) / SPEED_SCALE_KT} tone="sky-fill-orange" />
      </dl>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-white/10 pt-3 text-xs text-white/80">
        <Country code={REGION_FLAG[f.region]}>{t(`liveFlights.region.${f.region}`)}</Country>
        <span className="inline-flex items-center gap-1.5"><Radio aria-hidden className="size-3.5 text-cyan" />{minutes === 0 ? t("liveFlights.seenNow") : t("liveFlights.seenMinutes", { n: minutes })}</span>
      </div>
    </li>
  )
}

function Meter({ icon, label, value, ratio, tone }: { icon: ReactNode; label: string; value: string | null; ratio: number; tone: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-white/70">{icon}{label}</dt>
      <dd className="mt-1 text-sm font-bold">{value === null ? "—" : <Ltr>{value}</Ltr>}</dd>
      <dd aria-hidden className="sky-meter mt-1.5"><span className={tone} style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} /></dd>
    </div>
  )
}

function RegionChip({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count: number }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors ${active ? "border-white bg-white text-navy-950" : "border-white/25 bg-white/8 text-white hover:border-orange hover:bg-white/15"}`}>
      {icon}{label} <span className={active ? "text-steel" : "text-white/70"}><Ltr>{count.toLocaleString("en-GB")}</Ltr></span>
    </button>
  )
}
