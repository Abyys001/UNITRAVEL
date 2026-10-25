import { Check } from "lucide-react"

import { cn } from "../lib/utils"

export interface TimelineItem {
  id: string
  title: React.ReactNode
  /** Secondary line: place, time, detail. Callers format dates and numbers for their locale. */
  meta?: React.ReactNode
  /** Small pill after the title, e.g. "Updated". */
  note?: React.ReactNode
}

/**
 * Vertical flight-path timeline shared by request status and cargo tracking: completed stops navy with a check, the
 * latest orange with a soft pulse (motion-safe via the utility). Logical properties only, so it mirrors in RTL.
 */
export function Timeline({ items, empty, className, "data-testid": testId, live = false }: { items: TimelineItem[]; empty?: React.ReactNode; className?: string; "data-testid"?: string; live?: boolean }) {
  if (!items.length) return empty ? <p className="text-sm text-steel">{empty}</p> : null
  return (
    <ol className={cn("relative", className)} data-testid={testId} aria-live={live ? "polite" : undefined}>
      {items.map((x, i) => {
        const current = i === items.length - 1
        return (
          <li key={x.id} className="relative pb-5 ps-11 last:pb-0" aria-current={current ? "step" : undefined}>
            {!current && <span aria-hidden className="absolute bottom-0 start-[15px] top-8 border-s-2 border-dashed border-navy-900/40" />}
            <span aria-hidden className={cn("absolute start-0 top-0 grid size-8 place-items-center rounded-full", current ? "bg-orange text-navy-950" : "bg-navy-900 text-white")}>
              {current && <span className="animate-pulse-ring absolute inset-0 rounded-full bg-orange/50" />}
              {current ? <span className="relative size-2.5 rounded-full bg-navy-950" /> : <Check className="size-4" />}
            </span>
            <p className={cn("pt-1 leading-snug", current ? "font-bold text-navy-950" : "font-medium text-navy-900")}>
              {x.title}
              {x.note && <span className="ms-2 rounded-full bg-cloud px-2 py-0.5 text-xs font-semibold text-steel">{x.note}</span>}
            </p>
            {x.meta && <p className="text-xs text-steel">{x.meta}</p>}
          </li>
        )
      })}
    </ol>
  )
}
