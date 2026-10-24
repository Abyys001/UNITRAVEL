"use client"

import { ArrowRight } from "lucide-react"
import Link from "next/link"

import type { CustomerItinerary } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"

import { Ltr, TruthBadges } from "./badges"
import { FlightTrack } from "./flight-track"

export function segmentsOf(it: CustomerItinerary) {
  return it.components.flatMap((c) => c.slices.flatMap((s) => s.segments))
}

export function ResultCard({ it, searchId }: { it: CustomerItinerary; searchId: string }) {
  const { t, clock, duration, money, href, date, sep } = useI18n()
  const segs = segmentsOf(it)
  const first = segs[0]!
  const last = segs[segs.length - 1]!
  const route = [first.origin.iata, ...segs.map((s) => s.destination.iata)]
  const stops = it.connections.length
  const offset = Math.round((Date.parse(`${last.arrival.local.slice(0, 10)}T00:00:00Z`) - Date.parse(`${first.departure.local.slice(0, 10)}T00:00:00Z`)) / 86400000)
  return (
    <Link href={href(`/itinerary/${it.id}?s=${searchId}`)} className="card-brand card-lift group block overflow-hidden rounded-2xl focus-visible:outline-2 focus-visible:outline-orange">
      <div className="flex flex-col sm:flex-row">
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <p className="mb-3 flex flex-wrap items-center gap-x-2 text-xs font-semibold text-steel">
            <Ltr className="font-mono text-navy-950">{route.join(" → ")}</Ltr>
            <span>{date(first.departure.utc, { weekday: true, dateOnly: true, timeZone: first.departure.tz })}</span>
          </p>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="shrink-0">
              <p className="font-display text-2xl leading-none tabular-nums sm:text-3xl"><Ltr>{clock(first.departure.local)}</Ltr></p>
              <p className="mt-1 text-sm font-semibold"><Ltr>{first.origin.iata}</Ltr></p>
            </div>
            <FlightTrack stops={it.connections.map((c) => c.at)} label={duration(it.durationMin)} sub={stops === 0 ? t("results.direct") : t(stops === 1 ? "results.stops" : "results.stopsMany", { n: stops })} />
            <div className="shrink-0 text-end">
              <p className="font-display text-2xl leading-none tabular-nums sm:text-3xl"><Ltr>{clock(last.arrival.local)}{offset > 0 && <sup className="ms-0.5 text-xs font-bold text-danger">+{offset}</sup>}</Ltr></p>
              <p className="mt-1 text-sm font-semibold"><Ltr>{last.destination.iata}</Ltr></p>
            </div>
          </div>
          {it.connections.map((c, i) => (
            <p key={i} className="mt-2 text-xs text-steel">{t("results.layover", { time: duration(c.layoverMin), at: c.at })}{!c.protected && <span className="font-semibold text-danger">{sep}{t("truth.SEPARATE_TICKETS")}</span>}</p>
          ))}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <TruthBadges it={it} compact />
            <span className="text-xs text-steel"><Ltr>{[...new Set(segs.map((s) => `${s.marketing.carrier}${s.marketing.flightNumber}`))].join(sep)}</Ltr></span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-dashed border-haze bg-cloud/60 px-4 py-3 sm:w-48 sm:flex-col sm:items-end sm:justify-center sm:border-s sm:border-t-0 sm:px-5">
          <p className="text-xs text-steel sm:text-end">{t("results.priceInQuote")}</p>
          <span aria-hidden className="grid size-9 place-items-center rounded-full bg-orange text-navy-950"><ArrowRight className="arrow-nudge size-4" /></span>
        </div>
      </div>
    </Link>
  )
}
