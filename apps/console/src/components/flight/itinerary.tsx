"use client"

import type { Itinerary, Slice, TruthItem } from "@unitravel/contracts"
import { cn } from "@unitravel/ui/lib/utils"

import { fmtDateTime, minutes } from "@/lib/format"

/** Truth badges are text first, never colour alone (DESIGN.md). */
export function TruthBadge({ t }: { t: Pick<TruthItem, "rung" | "fake" | "provider" | "fetchedAt"> }) {
  const tone = t.fake ? "border-danger text-danger bg-[repeating-linear-gradient(-45deg,var(--color-danger-subtle)_0_4px,var(--surface-raised)_4px_8px)]" : t.rung === "PRICED_OFFER" ? "border-success bg-success text-white dark:text-navy-950" : t.rung === "LIVE_OFFER" ? "border-success text-success" : t.rung === "MANUAL" ? "border-orange bg-orange/15 text-orange-700" : "border-steel/50 text-steel"
  return <span className={cn("inline-flex rounded-[4px] border px-1.5 font-mono text-[10px] leading-4 uppercase", tone)} title={`${t.provider} · fetched ${fmtDateTime(t.fetchedAt)}`}>{t.fake ? "FAKE · " : ""}{t.rung.replace("_OFFER", "").replace("_", " ")}</span>
}

export function SliceView({ slice, index }: { slice: Slice; index?: number }) {
  return (
    <div className="space-y-1">
      <p className="flex items-baseline gap-2"><span className="num font-medium">{slice.origin} → {slice.destination}</span><span className="text-steel">· {minutes(slice.durationMin)}{index !== undefined ? ` · slice ${index + 1}` : ""}</span></p>
      <ol className="ledger-rows border-s-2 border-line ps-3">
        {slice.segments.map((g, i) => (
          <li key={i} className="grid grid-cols-[5.5rem_1fr] gap-x-2 py-1 text-[12.5px]">
            <span className="num">{g.marketing.carrier}{g.marketing.flightNumber}</span>
            <span>
              <span className="num">{g.origin.iata}{g.origin.terminal ? ` T${g.origin.terminal}` : ""} {g.departure.local.slice(5).replace("T", " ")}</span>
              <span className="text-steel"> → </span>
              <span className="num">{g.destination.iata}{g.destination.terminal ? ` T${g.destination.terminal}` : ""} {g.arrival.local.slice(5).replace("T", " ")}</span>
              <span className="block text-[11px] text-steel">{g.cabin.toLowerCase().replace("_", " ")}{g.bookingClass ? ` · class ${g.bookingClass}` : ""}{g.fareBasis ? ` · ${g.fareBasis}` : ""}{g.operating.carrier !== g.marketing.carrier ? ` · operated by ${g.operating.carrier}` : ""}{g.aircraft ? ` · ${g.aircraft}` : ""}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function ItineraryView({ it }: { it: Itinerary }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10.5px] uppercase">{it.construction.replace("_", " ")}</span>
        {it.ticketing === "SEPARATE_TICKETS" && <span className="rounded-[4px] border border-danger px-1.5 font-mono text-[10px] text-danger uppercase">Separate tickets</span>}
        {it.gateway && <span className="rounded-[4px] border border-orange px-1.5 font-mono text-[10px] text-orange-700 uppercase">Gateway {it.gateway.iata}</span>}
        {it.truth.map((t, i) => <TruthBadge key={i} t={t} />)}
        {it.riskFlags.map((f) => <span key={f} className="font-mono text-[10px] text-danger">{f}</span>)}
      </div>
      {it.components.map((c, ci) => (
        <div key={ci} className="space-y-1.5">
          {it.components.length > 1 && <p className="cap">Ticket {ci + 1} · {c.source.provider} · offer {c.source.providerOfferId.slice(0, 14)}</p>}
          {c.slices.map((s, si) => <SliceView key={si} slice={s} />)}
        </div>
      ))}
      {it.connections.length > 0 && (
        <ul className="text-[12px] text-steel">
          {it.connections.map((c, i) => <li key={i}>Layover {c.at}{c.departAirport !== c.at ? ` → ${c.departAirport}` : ""}: <span className="num">{minutes(c.layoverMin)}</span> (needs {c.requiredMin} m){c.protected ? " · protected" : " · self-transfer"}{c.overnight ? " · overnight" : ""}{c.advisory ? ` · ${c.advisory}` : ""}</li>)}
        </ul>
      )}
      {it.gateway && <p className="text-[12px] text-steel">Gateway access: {it.gateway.access}</p>}
    </div>
  )
}
