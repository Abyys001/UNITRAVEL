"use client"

import { Timeline } from "@unitravel/ui/product/timeline"

import { useI18n } from "@/lib/i18n"

/** A hold and release makes the customer-facing label cycle (Received, Being reviewed, Received, …). Returning to a label already shown folds back onto it, so the list ends at the current state without repeats. */
export function collapseRepeats<T extends { label: string }>(items: T[]): T[] {
  const out: T[] = []
  for (const x of items) {
    const seen = out.findIndex((y) => y.label === x.label)
    if (seen >= 0) out.length = seen + 1
    else out.push(x)
  }
  return out
}

/** Request status history in the shared flight-path timeline (packages/ui/product/timeline). */
export function StatusTimeline({ items }: { items: { at: string; label: string; detail?: string }[] }) {
  const { date, sep } = useI18n()
  return <Timeline live items={collapseRepeats(items).map((x, i) => ({ id: String(i), title: x.label, meta: `${date(x.at, { withTime: true })}${x.detail ? `${sep}${x.detail}` : ""}` }))} />
}
