import { Plane } from "lucide-react"

import { Ltr } from "./badges"

/**
 * Airline-style track between two airports: dashed line, a dot per stop with its airport code, a small plane that
 * mirrors in RTL (DESIGN.md). Decorative apart from the stop labels, which are real text.
 */
export function FlightTrack({ stops = [], label, sub }: { stops?: string[]; label?: React.ReactNode; sub?: React.ReactNode }) {
  const n = stops.length
  const planeAt = n === 0 ? 50 : 100 - 50 / (n + 1)
  return (
    <div className="min-w-0 flex-1 px-1 text-center">
      {label && <p className="text-xs font-semibold text-steel">{label}</p>}
      <div className="relative mx-1 my-1.5 h-7" aria-hidden>
        <span className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-haze" />
        <span className="absolute start-0 top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 border-navy-900 bg-white" />
        <span className="absolute end-0 top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-orange" />
        {stops.map((_, i) => (
          <span key={i} className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 border-navy-900 bg-navy-900 ring-2 ring-white" style={{ insetInlineStart: `calc(${((i + 1) / (n + 1)) * 100}% - 5px)` }} />
        ))}
        <span className="absolute top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-white text-navy-900 shadow-sm ring-1 ring-line" style={{ insetInlineStart: `calc(${planeAt}% - 12px)` }}>
          <Plane className="size-3.5 rotate-45 rtl:-rotate-45 rtl:-scale-x-100" />
        </span>
      </div>
      {n > 0 && <p className="flex flex-wrap justify-center gap-x-2 text-[11px] font-semibold text-navy-950">{stops.map((s, i) => <Ltr key={i}>{s}</Ltr>)}</p>}
      {sub && <p className="text-xs text-steel">{sub}</p>}
    </div>
  )
}
