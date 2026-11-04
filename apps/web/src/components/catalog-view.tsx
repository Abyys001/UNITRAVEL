"use client"

import { ArrowRight, Hourglass, Info, Plane, SearchX } from "lucide-react"
import Link from "next/link"
import { useEffect } from "react"

import type { CatalogDateGroup, CatalogSearchResponse, PublicItinerary, PublicItineraryDetail, RiskFlag } from "@unitravel/contracts"
import { EmptyState } from "@unitravel/ui/product/states"

import { useI18n } from "@/lib/i18n"
import { ago } from "@/lib/relative-time"
import { useSession } from "@/lib/session"

import { Ltr, Tag } from "./badges"
import { FlightTrack } from "./flight-track"
import { type SearchParamsShape } from "./search-form"

/** Same encoding the search form and the request page use for `?q=` and `?manual=`. */
export const encodeShape = (p: SearchParamsShape) => btoa(unescape(encodeURIComponent(JSON.stringify(p))))

/** Ask-our-team link: the stage 22 manual request for this route and day (signed-out visitors sign in first). */
function useRequestHref(shape: SearchParamsShape, date = shape.date) {
  const { href } = useI18n()
  const { me } = useSession()
  const next = href(`/request/new?manual=${encodeURIComponent(encodeShape({ ...shape, date }))}`)
  return me ? next : href(`/sign-in?next=${encodeURIComponent(next)}`)
}

export function AskTeamLink({ shape, date, label }: { shape: SearchParamsShape; date?: string; label?: string }) {
  const { t } = useI18n()
  return <Link href={useRequestHref(shape, date)} className="btn-orange !px-4 !py-2 text-sm">{label ?? t("catalog.askTeam")}</Link>
}

/** Lets the request flow's back link return to this search (the old client page stored it too). */
export function SearchMemory() {
  useEffect(() => { sessionStorage.setItem("ut_last_search", `${location.pathname}${location.search}`) }, [])
  return null
}

export function DateLine({ iso }: { iso: string }) {
  const { date } = useI18n()
  return <p className="mb-6 mt-2 text-steel">{date(iso, { dateOnly: true, weekday: true })}</p>
}

const dayOffset = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000)

/** Flags on the result and on its layovers, once each; the self-transfer label is shown separately. */
function flagsOf(it: PublicItinerary) {
  return [...new Set<RiskFlag>([...it.riskFlags, ...it.layovers.flatMap((l) => l.flags)])].filter((f) => f !== "SEPARATE_TICKETS")
}

function Freshness({ iso, stale }: { iso: string; stale?: boolean }) {
  const { t, locale } = useI18n()
  return <p className={`text-xs ${stale ? "font-semibold text-orange-700" : "text-steel"}`}>{t("catalog.updated", { ago: ago(iso, locale) })}</p>
}

function Notices({ it }: { it: PublicItinerary }) {
  const { t } = useI18n()
  const flags = flagsOf(it)
  return (
    <>
      {(it.selfTransfer || flags.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {it.selfTransfer && <Tag kind="risk">{t("risk.SEPARATE_TICKETS")}</Tag>}
          {flags.map((f) => <Tag key={f} kind="risk">{t(`risk.${f}`)}</Tag>)}
        </div>
      )}
      {it.complianceReview && <p role="note" className="mt-3 rounded-xl border border-orange-700/40 bg-cloud px-3 py-2 text-xs text-navy-950" data-testid="iran-review-note">{t("popularFlights.iranNote")}</p>}
    </>
  )
}

function Layovers({ it }: { it: PublicItinerary }) {
  const { t, duration } = useI18n()
  if (!it.layovers.length) return null
  return (
    <ul className="mt-3 space-y-1 text-xs">
      {it.layovers.map((l, i) => (
        <li key={i} className="flex items-center gap-1.5 text-steel"><Hourglass aria-hidden className="size-3.5" />{t("results.layover", { time: duration(l.minutes), at: l.at })}</li>
      ))}
    </ul>
  )
}

function Summary({ it }: { it: PublicItinerary }) {
  const { t, clock, duration, sep } = useI18n()
  const offset = dayOffset(it.departLocal, it.arriveLocal)
  return (
    <div className="flex items-center gap-2 sm:gap-4">
      <div className="shrink-0">
        <p className="font-display text-2xl leading-none tabular-nums sm:text-3xl"><Ltr>{clock(it.departLocal)}</Ltr></p>
        <p className="mt-1 text-sm font-semibold"><Ltr>{it.origin}</Ltr></p>
      </div>
      <FlightTrack stops={it.layovers.map((l) => l.at)} label={duration(it.durationMin)} sub={it.stops === 0 ? t("results.direct") : t(it.stops === 1 ? "results.stops" : "results.stopsMany", { n: it.stops })} />
      <div className="shrink-0 text-end">
        <p className="font-display text-2xl leading-none tabular-nums sm:text-3xl"><Ltr>{clock(it.arriveLocal)}{offset > 0 && <sup className="ms-0.5 text-xs font-bold text-danger">+{offset}</sup>}</Ltr></p>
        <p className="mt-1 text-sm font-semibold"><Ltr>{it.destination}</Ltr></p>
      </div>
      <span className="sr-only">{it.carriers.join(sep)}</span>
    </div>
  )
}

function ResultCard({ it, stale }: { it: PublicItinerary; stale: boolean }) {
  const { href, sep, date, t } = useI18n()
  return (
    <li>
      <Link href={href(`/flights/results/${it.id}`)} className="card-brand card-lift block rounded-2xl p-4 focus-visible:outline-2 focus-visible:outline-orange sm:p-5" data-testid="catalog-result">
        <p className="mb-3 flex flex-wrap items-center gap-x-2 text-xs font-semibold text-steel">
          <Ltr className="font-mono text-navy-950">{[it.origin, ...it.layovers.map((l) => l.at), it.destination].join(" → ")}</Ltr>
          <span>{date(it.departureDate, { dateOnly: true, weekday: true })}</span>
        </p>
        <Summary it={it} />
        <Layovers it={it} />
        <Notices it={it} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-haze pt-3">
          <span className="text-xs text-steel"><Ltr>{it.flightNumbers.join(sep)}</Ltr></span>
          <span className="flex flex-col items-end gap-0.5 text-end">
            <Freshness iso={it.fetchedAt} stale={stale} />
            <span className="text-xs font-semibold text-navy-950">{t("catalog.confirmed")}</span>
          </span>
        </div>
      </Link>
    </li>
  )
}

function NoticeLine({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  return <p role="note" className={`mb-4 flex items-start gap-2 rounded-xl px-4 py-2.5 text-sm ${tone === "warn" ? "bg-warning-subtle text-warning-subtle-fg" : "bg-info-subtle text-info-subtle-fg"}`}><Info aria-hidden className="mt-0.5 size-4 shrink-0" />{children}</p>
}

function ResultList({ results, stale }: { results: PublicItinerary[]; stale: boolean }) {
  return <ul className="space-y-4">{results.map((r) => <ResultCard key={r.id} it={r} stale={stale} />)}</ul>
}

/** EMPTY, NOT_TRACKED and UNAVAILABLE: always an explanation and a way forward, never an error. */
function NoFlights({ data, shape }: { data: CatalogSearchResponse; shape: SearchParamsShape }) {
  const { t, href, date } = useI18n()
  const title = data.state === "NOT_TRACKED" ? t("catalog.notTrackedTitle") : data.state === "UNAVAILABLE" ? t("catalog.unavailableTitle") : t("catalog.emptyTitle")
  const body = data.state === "NOT_TRACKED" ? t("catalog.notTrackedBody") : data.state === "UNAVAILABLE" ? t("results.noSources") : t("catalog.emptyBody")
  const nearby = data.state === "EMPTY" ? data.nearbyDates : []
  return (
    <div data-testid={`catalog-${data.state.toLowerCase()}`}>
      <EmptyState icon={<SearchX />} title={title} body={body} action={<AskTeamLink shape={shape} label={t("results.askTeam")} />} />
      {nearby.length > 0 && (
        <section className="mt-6" aria-labelledby="nearby-dates">
          <h2 id="nearby-dates" className="text-sm font-semibold text-navy-950">{t("catalog.nearby")}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {nearby.map((d) => <li key={d}><Link href={href(`/search?q=${encodeURIComponent(encodeShape({ ...shape, date: d }))}`)} className="inline-block rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-navy-950 hover:border-navy-900/40">{date(d, { dateOnly: true, weekday: true })}</Link></li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

function DateGroup({ g, shape }: { g: CatalogDateGroup; shape: SearchParamsShape }) {
  const { t, date } = useI18n()
  const listed = g.results.length > 0
  return (
    <section aria-label={date(g.date, { dateOnly: true, weekday: true })} data-testid="catalog-date-group">
      <h2 className="mb-3 font-display text-xl">{date(g.date, { dateOnly: true, weekday: true })}</h2>
      {g.state === "STALE" && listed && <NoticeLine tone="warn">{t("catalog.stale")}</NoticeLine>}
      {listed
        ? <ResultList results={g.results} stale={g.state === "STALE"} />
        : <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-haze px-4 py-3"><p className="text-sm text-steel">{t("catalog.noFlights")}</p><AskTeamLink shape={shape} date={g.date} label={t("catalog.askTeam")} /></div>}
    </section>
  )
}

export function CatalogSearchView({ data, shape }: { data: CatalogSearchResponse; shape: SearchParamsShape }) {
  const { t } = useI18n()
  const grouped = data.dates.length > 1
  const anyListed = grouped ? data.dates.some((g) => g.results.length > 0) : data.results.length > 0
  const showing = (data.state === "RESULTS" || data.state === "STALE" || grouped) && anyListed
  return (
    <div aria-live="polite">
      {data.partyNote && <NoticeLine>{t("catalog.partyNote")}</NoticeLine>}
      {showing ? (
        <>
          {data.state === "STALE" && !grouped && <NoticeLine tone="warn">{t("catalog.stale")}</NoticeLine>}
          {grouped
            ? <div className="space-y-8">{data.dates.map((g) => <DateGroup key={g.date} g={g} shape={shape} />)}</div>
            : <ResultList results={data.results} stale={data.state === "STALE"} />}
        </>
      ) : <NoFlights data={data} shape={shape} />}
    </div>
  )
}

export function CatalogDetailView({ d, shape }: { d: PublicItineraryDetail; shape: SearchParamsShape }) {
  const { t, clock, duration, date, href, locale, sep } = useI18n()
  const gaps = d.legs.slice(1).map((leg, i) => ({ at: leg.from.iata, min: d.layovers[i]?.minutes, flags: d.layovers[i]?.flags ?? [] }))
  return (
    <article data-testid="catalog-detail">
      <p className="mb-4"><Link href={href("/flights")} className="text-sm font-semibold text-orange-700 underline underline-offset-4">{t("catalog.backToSearch")}</Link></p>
      <h1 className="font-display text-3xl md:text-4xl"><Ltr>{d.origin}</Ltr> <ArrowRight className="mx-1 inline size-7 text-orange rtl:rotate-180" aria-label="→" /> <Ltr>{d.destination}</Ltr></h1>
      <p className="mb-6 mt-2 text-steel">{date(d.departureDate, { dateOnly: true, weekday: true })}{sep}{t("catalog.total")}: {duration(d.durationMin)}{sep}{d.stops === 0 ? t("results.direct") : t(d.stops === 1 ? "results.stops" : "results.stopsMany", { n: d.stops })}</p>
      {!d.isCurrent && <NoticeLine tone="warn"><span data-testid="no-longer-listed">{t("catalog.noLongerListed")} {t("catalog.lastSeen", { ago: ago(d.lastSeenAt, locale) })}</span></NoticeLine>}
      <div className="card-brand rounded-2xl p-4 sm:p-5">
        <ol className="space-y-5">
          {d.legs.map((leg, i) => (
            <li key={i}>
              {i > 0 && gaps[i - 1] && (
                <p className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-orange-700"><Hourglass aria-hidden className="size-4" />
                  {gaps[i - 1]!.min !== undefined ? t("catalog.layoverAt", { at: gaps[i - 1]!.at, time: duration(gaps[i - 1]!.min!) }) : gaps[i - 1]!.at}
                  {gaps[i - 1]!.flags.filter((f) => f !== "SEPARATE_TICKETS").map((f) => <span key={f} className="ms-1"><Tag kind="risk">{t(`risk.${f}`)}</Tag></span>)}
                </p>
              )}
              <p className="mb-2 flex flex-wrap items-center gap-x-2 text-sm font-semibold"><Plane aria-hidden className="size-4 text-royal rtl:-scale-x-100" />{t("catalog.leg", { n: i + 1 })}{sep}<Ltr className="font-mono">{leg.carrier} {leg.flightNumber}</Ltr>{leg.operatingCarrier && leg.operatingCarrier !== leg.carrier && <span className="text-xs font-normal text-steel">{t("catalog.operatedBy", { carrier: leg.operatingCarrier })}</span>}</p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div><p className="font-display text-2xl tabular-nums"><Ltr>{clock(leg.from.local)}</Ltr></p><p className="text-sm font-semibold"><Ltr>{leg.from.iata}</Ltr></p>{leg.from.terminal && <p className="text-xs text-steel">{t("catalog.terminal", { terminal: leg.from.terminal })}</p>}</div>
                <p className="text-xs font-semibold text-steel">{duration(leg.durationMin)}</p>
                <div className="text-end"><p className="font-display text-2xl tabular-nums"><Ltr>{clock(leg.to.local)}</Ltr></p><p className="text-sm font-semibold"><Ltr>{leg.to.iata}</Ltr></p>{leg.to.terminal && <p className="text-xs text-steel">{t("catalog.terminal", { terminal: leg.to.terminal })}</p>}</div>
              </div>
              {leg.aircraft && <p className="mt-2 text-xs text-steel">{t("catalog.aircraft")}: <Ltr className="font-semibold text-navy-950">{leg.aircraft}</Ltr></p>}
            </li>
          ))}
        </ol>
        <Notices it={d} />
        {d.selfTransfer && <p className="mt-3 text-xs text-steel">{t("catalog.selfTransferNote")}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-haze pt-4">
          <div><Freshness iso={d.fetchedAt} /><p className="text-xs font-semibold text-navy-950">{t("catalog.confirmed")}</p></div>
          <AskTeamLink shape={shape} label={t("catalog.requestFlight")} />
        </div>
      </div>
    </article>
  )
}
