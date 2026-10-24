"use client"

import { AlertTriangle, Luggage, ShieldCheck } from "lucide-react"

import type { CustomerItinerary, SegmentBaggage } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"

import { Ltr, RiskFlags, TruthBadges } from "./badges"
import { FlightTrack } from "./flight-track"

function BagText({ b }: { b?: SegmentBaggage }) {
  const { t, sep } = useI18n()
  if (!b || b.checked.status === "UNKNOWN") return <span className="text-warning-subtle-fg">{t("itinerary.unknown")}</span>
  const v = b.checked.value
  if (!v.pieces) return <span>{t("itinerary.noChecked")}</span>
  return <span>{v.kgPerPiece ? t("itinerary.bags", { pieces: v.pieces, kg: v.kgPerPiece }) : t("itinerary.bagsPieces", { pieces: v.pieces })}</span>
}

/** Itinerary detail (ch. 11.3): every segment, every connection with self-transfer advice, baggage only when known. */
export function ItineraryView({ it }: { it: CustomerItinerary }) {
  const { t, clock, duration, date, money, locale, sep } = useI18n()
  let componentStart = 0
  return (
    <div className="space-y-5">
      <TruthBadges it={it} />
      {it.gateway && (
        <div className="rounded-2xl border border-orange/60 bg-warning-subtle p-4 text-sm">
          <p className="font-semibold">{t("itinerary.gatewayAccess", { gateway: it.gateway.iata, access: it.gateway.access })}</p>
          {it.gateway.dayOffset > 0 && <p className="mt-1 text-steel">{t("itinerary.dayOffset", { gateway: it.gateway.iata, n: it.gateway.dayOffset })}</p>}
        </div>
      )}
      {it.components.map((comp, ci) => {
        const segs = comp.slices.flatMap((s) => s.segments)
        const startIdx = componentStart
        componentStart += segs.length
        return (
          <section key={ci} className="card-brand overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-cloud px-4 py-2.5 text-xs font-semibold text-steel">
              <span>{it.components.length > 1 ? `${t("truth.SEPARATE_TICKETS")}${sep}${ci + 1}/${it.components.length}` : t("truth.SINGLE_TICKET")}</span>
              <span className="text-navy-950">{comp.brand.status === "KNOWN" && comp.brand.value.name}</span>
            </header>
            <ol className="divide-y divide-line">
              {segs.map((s, si) => {
                const bag = it.baggage[startIdx + si]
                return (
                  <li key={si} className="px-4 py-4 sm:px-5">
                    <div className="flex items-center gap-2 sm:gap-4">
                      <div className="shrink-0">
                        <p className="font-display text-xl leading-none tabular-nums sm:text-2xl"><Ltr>{clock(s.departure.local)}</Ltr></p>
                        <p className="mt-1 text-sm font-semibold"><Ltr>{s.origin.iata}</Ltr></p>
                      </div>
                      <FlightTrack label={duration(Math.round((Date.parse(s.arrival.utc) - Date.parse(s.departure.utc)) / 60000))} />
                      <div className="shrink-0 text-end">
                        <p className="font-display text-xl leading-none tabular-nums sm:text-2xl"><Ltr>{clock(s.arrival.local)}</Ltr></p>
                        <p className="mt-1 text-sm font-semibold"><Ltr>{s.destination.iata}</Ltr></p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-steel">
                      <Ltr className="font-semibold text-navy-950">{s.marketing.carrier} {s.marketing.flightNumber}</Ltr>
                      {s.operating.carrier !== s.marketing.carrier && <>{sep}{t("itinerary.operatedBy", { carrier: s.operating.carrier })}</>}
                      {s.aircraft && <>{sep}{t("itinerary.aircraft", { code: s.aircraft })}</>}
                      {sep}{date(s.departure.utc, { weekday: true, dateOnly: true, timeZone: s.departure.tz })}
                      {s.origin.terminal && <>{sep}{t("itinerary.terminal", { t: s.origin.terminal })}</>}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm"><Luggage className="size-3.5 text-steel" aria-hidden />{t("itinerary.baggage")}: <BagText b={bag} /></p>
                  </li>
                )
              })}
            </ol>
            <footer className="grid gap-1 border-t border-line bg-cloud/60 px-4 py-3 text-sm sm:grid-cols-2 sm:px-5">
              {(["change", "refund"] as const).map((k) => {
                const c = comp.conditions[k]
                return <p key={k}><span className="text-steel">{t(k === "change" ? "itinerary.change" : "itinerary.refund")}: </span>
                  {c.status === "UNKNOWN" ? <span className="font-semibold text-warning-subtle-fg">{t("itinerary.unknown")}</span> : !c.value.allowed ? t("itinerary.notAllowed") : t("itinerary.allowed")}</p>
              })}
            </footer>
          </section>
        )
      })}
      {it.connections.map((c, i) => (
        <div key={i} className={`rounded-2xl border p-4 text-sm ${c.protected ? "border-success/40 bg-success-subtle" : "border-danger/40 bg-danger-subtle"}`}>
          <p className="flex items-center gap-2 font-semibold">{c.protected ? <ShieldCheck className="size-4 text-success" aria-hidden /> : <AlertTriangle className="size-4 text-danger" aria-hidden />}
            {t("results.layover", { time: duration(c.layoverMin), at: c.at })}{c.departAirport !== c.at && <> → <Ltr>{c.departAirport}</Ltr></>}</p>
          <p className="mt-1">{c.protected ? t("itinerary.protectedConn") : t("itinerary.selfTransfer")}</p>
          {!c.protected && <p className="mt-1 font-semibold text-danger">{t("itinerary.notProtected", { n: i + 1 })}</p>}
          {c.advisory && <p className="mt-1 text-steel" lang={locale}>{c.advisory}</p>}
          <p className="mt-1 text-steel">{t("itinerary.entryRules")}</p>
          <div className="mt-2"><RiskFlags flags={c.flags} /></div>
        </div>
      ))}
    </div>
  )
}
