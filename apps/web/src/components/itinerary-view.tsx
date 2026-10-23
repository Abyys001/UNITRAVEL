"use client"

import { AlertTriangle, Luggage, Plane, ShieldCheck } from "lucide-react"

import type { Itinerary, SegmentBaggage } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"

import { Ltr, RiskFlags, TruthBadges } from "./badges"

function BagText({ b }: { b?: SegmentBaggage }) {
  const { t, sep } = useI18n()
  if (!b || b.checked.status === "UNKNOWN") return <span className="text-warning-subtle-fg">{t("itinerary.unknown")}</span>
  const v = b.checked.value
  if (!v.pieces) return <span>{t("itinerary.noChecked")}</span>
  return <span>{v.kgPerPiece ? t("itinerary.bags", { pieces: v.pieces, kg: v.kgPerPiece }) : t("itinerary.bagsPieces", { pieces: v.pieces })}</span>
}

/** Itinerary detail (ch. 11.3): every segment, every connection with self-transfer advice, baggage only when known. */
export function ItineraryView({ it }: { it: Itinerary }) {
  const { t, clock, duration, date, money, locale, sep } = useI18n()
  let componentStart = 0
  return (
    <div className="space-y-4">
      <TruthBadges it={it} />
      {it.gateway && (
        <div className="rounded-lg border border-copper/50 bg-accent p-4 text-sm">
          <p className="font-medium">{t("itinerary.gatewayAccess", { gateway: it.gateway.iata, access: it.gateway.access })}</p>
          {it.gateway.dayOffset > 0 && <p className="mt-1 text-slate">{t("itinerary.dayOffset", { gateway: it.gateway.iata, n: it.gateway.dayOffset })}</p>}
        </div>
      )}
      {it.components.map((comp, ci) => {
        const segs = comp.slices.flatMap((s) => s.segments)
        const startIdx = componentStart
        componentStart += segs.length
        return (
          <section key={ci} className="rounded-lg border border-border bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs text-slate">
              <span>{it.components.length > 1 ? `${t("truth.SEPARATE_TICKETS")}${sep}${ci + 1}/${it.components.length}` : t("truth.SINGLE_TICKET")}</span>
              <span>{money(comp.price.total)}{comp.brand.status === "KNOWN" && `${sep}${comp.brand.value.name}`}</span>
            </header>
            <ol className="divide-y divide-border">
              {segs.map((s, si) => {
                const bag = it.baggage[startIdx + si]
                return (
                  <li key={si} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <Plane className="mt-1 size-4 shrink-0 text-copper-700 rtl:-scale-x-100" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium"><Ltr>{clock(s.departure.local)} {s.origin.iata}</Ltr> → <Ltr>{clock(s.arrival.local)} {s.destination.iata}</Ltr>
                          <span className="ms-2 text-sm font-normal text-slate">{duration(Math.round((Date.parse(s.arrival.utc) - Date.parse(s.departure.utc)) / 60000))}</span></p>
                        <p className="text-sm text-slate">
                          <Ltr>{s.marketing.carrier} {s.marketing.flightNumber}</Ltr>
                          {s.operating.carrier !== s.marketing.carrier && <>{sep}{t("itinerary.operatedBy", { carrier: s.operating.carrier })}</>}
                          {s.aircraft && <>{sep}{t("itinerary.aircraft", { code: s.aircraft })}</>}
                          {sep}{date(s.departure.utc, { weekday: true, dateOnly: true, timeZone: s.departure.tz })}
                          {s.origin.terminal && <>{sep}{t("itinerary.terminal", { t: s.origin.terminal })}</>}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm"><Luggage className="size-3.5 text-slate" aria-hidden />{t("itinerary.baggage")}: <BagText b={bag} /></p>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
            <footer className="grid gap-1 border-t border-border px-4 py-2 text-sm sm:grid-cols-2">
              {(["change", "refund"] as const).map((k) => {
                const c = comp.conditions[k]
                return <p key={k}><span className="text-slate">{t(k === "change" ? "itinerary.change" : "itinerary.refund")}: </span>
                  {c.status === "UNKNOWN" ? <span className="text-warning-subtle-fg">{t("itinerary.unknown")}</span> : !c.value.allowed ? t("itinerary.notAllowed") : c.value.penalty ? t("itinerary.allowedFee", { fee: money(c.value.penalty) }) : t("itinerary.allowed")}</p>
              })}
            </footer>
          </section>
        )
      })}
      {it.connections.map((c, i) => (
        <div key={i} className={`rounded-lg border p-4 text-sm ${c.protected ? "border-moss/40 bg-success-subtle" : "border-brick/40 bg-[#fbeee9]"}`}>
          <p className="flex items-center gap-2 font-medium">{c.protected ? <ShieldCheck className="size-4 text-moss" /> : <AlertTriangle className="size-4 text-brick" />}
            {t("results.layover", { time: duration(c.layoverMin), at: c.at })}{c.departAirport !== c.at && <> → <Ltr>{c.departAirport}</Ltr></>}</p>
          <p className="mt-1">{c.protected ? t("itinerary.protectedConn") : t("itinerary.selfTransfer")}</p>
          {!c.protected && <p className="mt-1 font-medium text-brick">{t("itinerary.notProtected", { n: i + 1 })}</p>}
          {c.advisory && <p className="mt-1 text-slate" lang={locale}>{c.advisory}</p>}
          <p className="mt-1 text-slate">{t("itinerary.entryRules")}</p>
          <div className="mt-2"><RiskFlags flags={c.flags} /></div>
        </div>
      ))}
    </div>
  )
}
