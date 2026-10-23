"use client"

import Link from "next/link"

import type { Itinerary } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"

import { Ltr, TruthBadges } from "./badges"

export function segmentsOf(it: Itinerary) {
  return it.components.flatMap((c) => c.slices.flatMap((s) => s.segments))
}

export function ResultCard({ it, searchId }: { it: Itinerary; searchId: string }) {
  const { t, clock, duration, money, href, date, sep } = useI18n()
  const segs = segmentsOf(it)
  const first = segs[0]!
  const last = segs[segs.length - 1]!
  const route = [first.origin.iata, ...segs.map((s) => s.destination.iata)]
  const stops = it.connections.length
  const offset = Math.round((Date.parse(`${last.arrival.local.slice(0, 10)}T00:00:00Z`) - Date.parse(`${first.departure.local.slice(0, 10)}T00:00:00Z`)) / 86400000)
  return (
    <Link href={href(`/itinerary/${it.id}?s=${searchId}`)} className="group block rounded-lg border border-border bg-white p-4 transition hover:border-copper hover:shadow-[0_12px_30px_-20px_rgba(15,34,56,.5)] focus-visible:outline-copper">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-medium"><Ltr>{route.join(" → ")}</Ltr></p>
          <p className="mt-1 text-sm text-slate">
            <Ltr>{clock(first.departure.local)} – {clock(last.arrival.local)}{offset > 0 && <sup className="ms-0.5 text-brick">+{offset}</sup>}</Ltr>
            {sep}{duration(it.durationMin)}{sep}{stops === 0 ? t("results.direct") : t(stops === 1 ? "results.stops" : "results.stopsMany", { n: stops })}
            {sep}<span className="text-slate/80">{date(first.departure.utc, { weekday: true, dateOnly: true, timeZone: first.departure.tz })}</span>
          </p>
          {it.connections.map((c, i) => (
            <p key={i} className="mt-1 text-sm text-slate">{t("results.layover", { time: duration(c.layoverMin), at: c.at })}{!c.protected && <span className="text-brick">{sep}{t("truth.SEPARATE_TICKETS")}</span>}</p>
          ))}
        </div>
        <div className="shrink-0 text-end">
          <p className="font-display text-2xl tabular-nums">{money(it.price.total)}</p>
          <p className="text-xs text-slate">{t("results.perTotal")}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <TruthBadges it={it} compact />
        <span className="text-xs text-slate"><Ltr>{[...new Set(segs.map((s) => `${s.marketing.carrier}${s.marketing.flightNumber}`))].join(sep)}</Ltr></span>
      </div>
    </Link>
  )
}
