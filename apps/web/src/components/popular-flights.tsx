"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Hourglass, Info, Plane } from "lucide-react"
import { useRouter } from "next/navigation"

import type { FlightListingItem, FlightListingsView } from "@unitravel/contracts"
import { LoadingState } from "@unitravel/ui/product/states"

import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { ago } from "@/lib/relative-time"
import { useSession } from "@/lib/session"

import { Ltr } from "./badges"
import { FlightTrack } from "./flight-track"
import type { SearchParamsShape } from "./search-form"

/**
 * ADR-0032 B4 item from the contract. Price, price level, booking token and Google Flights link are deliberately absent:
 * the customer API never sends them (ADR-0029 A5), and the type gives nothing a way to read them.
 */
type PopularFlight = FlightListingItem

/** A wait this long usually means leaving the airside or a night at the airport, so customers should notice it. */
const LONG_LAYOVER_MIN = 240
const CABIN_KEY = { ECONOMY: "search.economy", PREMIUM_ECONOMY: "search.premium", BUSINESS: "search.business", FIRST: "search.first" } as const

/** Popular routes under the search form (ADR-0032 B4). Indicative schedules only: every card says where it came from and when. */
export function PopularFlights() {
  const { t } = useI18n()
  const q = useQuery({ queryKey: ["listings", "flights"], queryFn: () => api<FlightListingsView>("/v1/listings/flights"), staleTime: 60_000 })
  if (q.isLoading) return <section className="mt-10"><LoadingState label={t("popularFlights.loading")} rows={3} /></section>
  // NO_SOURCES, a spent budget or an unreachable API all leave nothing honest to list.
  const items = q.data?.items ?? []
  if (!items.length) return <EmptyRoutes />
  const routes = new Map<string, PopularFlight[]>()
  for (const f of items) routes.set(`${f.origin}-${f.destination}`, [...(routes.get(`${f.origin}-${f.destination}`) ?? []), f])
  return (
    <section className="mt-10" aria-labelledby="popular-routes-title" data-testid="popular-routes">
      <h2 id="popular-routes-title" className="font-display text-2xl md:text-3xl">{t("popularFlights.title")}</h2>
      <p className="mt-2 max-w-2xl text-sm text-steel">{t("popularFlights.lead")}</p>
      <p className="mt-3 flex items-start gap-2 text-xs text-steel" data-testid="popular-disclosure"><Info aria-hidden className="mt-0.5 size-4 shrink-0 text-royal" />{t("popularFlights.disclosure")}</p>
      {[...routes.entries()].map(([key, flights]) => (
        <section key={key} className="mt-6" aria-label={`${flights[0]!.origin} → ${flights[0]!.destination}`} data-testid="popular-route">
          <h3 className="mb-3 flex items-center gap-2 font-mono text-sm font-bold text-navy-950"><Ltr>{flights[0]!.origin}</Ltr><ArrowRight aria-hidden className="size-4 text-orange rtl:rotate-180" /><Ltr>{flights[0]!.destination}</Ltr></h3>
          <ul className="grid gap-3 md:grid-cols-2">{flights.map((f, i) => <PopularFlightCard key={i} f={f} />)}</ul>
        </section>
      ))}
    </section>
  )
}

function PopularFlightCard({ f }: { f: PopularFlight }) {
  const { t, clock, duration, date, href, locale, sep } = useI18n()
  const { me } = useSession()
  const router = useRouter()
  const segs = f.segments ?? []
  const first = segs[0]
  // Airline logos in the source point at Google's servers (no Google services on user-facing paths), so the code is the mark.
  const carriers = segs.length ? [...new Map(segs.map((s) => [s.marketing.carrier, s.carrierName ?? s.marketing.carrier])).entries()] : f.carriers.map((c) => [c, c] as const)
  const operators = [...new Set(segs.filter((s) => s.operating.carrier !== s.marketing.carrier).map((s) => s.operating.carrier))]
  const layovers = segs.slice(1).map((s, i) => ({ at: s.origin.iata, min: Math.round((Date.parse(s.departure.utc) - Date.parse(segs[i]!.arrival.utc)) / 60_000) }))
  const aircraft = [...new Set(segs.flatMap((s) => (s.aircraft ? [s.aircraft] : [])))]
  const cabin = first?.cabin
  const request = () => {
    // With an offer reference this is the same ITINERARY request a search result makes; without one, the manual request for this route and day.
    const manual: SearchParamsShape = {
      trip: "ONE_WAY", from: { kind: "AIRPORT", code: f.origin, label: f.origin }, to: { kind: "AIRPORT", code: f.destination, label: f.destination },
      date: f.departureDate, adt: 1, chd: [], inf: 0, cabin: cabin ?? "ECONOMY", flex: false, st: true, ac: false, on: true, gw: true, stops: 2, lay: [240, 360],
    }
    const next = f.offerRef
      ? href(`/request/new?s=${encodeURIComponent(f.offerRef.searchId)}&i=${encodeURIComponent(f.offerRef.itineraryId)}`)
      : href(`/request/new?manual=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(manual)))))}`)
    router.push(me ? next : href(`/sign-in?next=${encodeURIComponent(next)}`))
  }
  return (
    <li className="card-brand flex flex-col rounded-2xl p-4 sm:p-5" data-testid="popular-flight">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-navy-900 font-mono text-sm font-bold text-white">{carriers[0]?.[0] ?? <Plane className="size-4" />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-navy-950">{carriers.map(([, name]) => name).join(sep)}</p>
          {segs.length > 0 && <p className="text-xs text-steel"><Ltr className="font-mono">{segs.map((s) => `${s.marketing.carrier} ${s.marketing.flightNumber}`).join(" · ")}</Ltr></p>}
          {operators.length > 0 && <p className="text-xs text-steel">{t("popularFlights.operatedBy", { carrier: operators.join(sep) })}</p>}
        </div>
        <p className="shrink-0 text-end text-xs text-steel">{t("popularFlights.departs", { date: date(f.departureDate, { dateOnly: true, weekday: true }) })}</p>
      </div>

      <div className="mt-4 flex items-center gap-2 sm:gap-4">
        <div className="shrink-0">
          <p className="font-display text-2xl leading-none tabular-nums"><Ltr>{clock(f.departureLocal)}</Ltr></p>
          <p className="mt-1 text-sm font-semibold"><Ltr>{f.origin}</Ltr></p>
        </div>
        <FlightTrack stops={layovers.map((l) => l.at)} label={duration(f.durationMin)} sub={f.stops === 0 ? t("results.direct") : t(f.stops === 1 ? "results.stops" : "results.stopsMany", { n: f.stops })} />
        <div className="shrink-0 text-end">
          <p className="font-display text-2xl leading-none tabular-nums"><Ltr>{clock(f.arrivalLocal)}</Ltr></p>
          <p className="mt-1 text-sm font-semibold"><Ltr>{f.destination}</Ltr></p>
        </div>
      </div>

      {layovers.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {layovers.map((l, i) => l.min >= LONG_LAYOVER_MIN
            ? <li key={i} className="flex items-center gap-1.5 font-semibold text-orange-700" data-testid="long-layover"><Hourglass aria-hidden className="size-3.5" />{t("results.layover", { time: duration(l.min), at: l.at })}{sep}{t("popularFlights.longLayover")}</li>
            : <li key={i} className="text-steel">{t("results.layover", { time: duration(l.min), at: l.at })}</li>)}
        </ul>
      )}

      {(aircraft.length > 0 || cabin) && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {aircraft.length > 0 && <div className="flex gap-1.5"><dt className="text-steel">{t("popularFlights.aircraft")}</dt><dd className="font-semibold"><Ltr>{aircraft.join(", ")}</Ltr></dd></div>}
          {cabin && <div className="flex gap-1.5"><dt className="text-steel">{t("popularFlights.cabin")}</dt><dd className="font-semibold">{t(CABIN_KEY[cabin])}</dd></div>}
        </dl>
      )}

      {f.complianceReview && <p role="note" className="mt-3 rounded-xl border border-orange-700/40 bg-cloud px-3 py-2 text-xs text-navy-950" data-testid="iran-review-note">{t("popularFlights.iranNote")}</p>}

      <div aria-hidden className="min-h-4 flex-1" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-haze pt-3">
        <p className="text-xs text-steel">{t("popularFlights.source", { ago: ago(f.fetchedAt, locale) })}</p>
        <button type="button" onClick={request} className="btn-orange !px-4 !py-2 text-sm">{t("popularFlights.request")}</button>
      </div>
    </li>
  )
}

/** Nothing listed: point at the form above, which takes the route and dates and ends in a request to our team. */
function EmptyRoutes() {
  const { t } = useI18n()
  const toForm = () => {
    const form = document.getElementById("flight-request")
    form?.scrollIntoView({ behavior: "smooth", block: "start" })
    form?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true })
  }
  return (
    <section role="status" className="card-brand mt-10 rounded-2xl px-6 py-10 text-center" data-testid="popular-empty">
      <Plane aria-hidden className="mx-auto size-8 text-royal rtl:-scale-x-100" />
      <p className="mx-auto mt-3 max-w-xl font-semibold text-navy-950">{t("popularFlights.empty")}</p>
      <button type="button" onClick={toForm} className="btn-orange mt-5">{t("popularFlights.emptyAction")}</button>
    </section>
  )
}
