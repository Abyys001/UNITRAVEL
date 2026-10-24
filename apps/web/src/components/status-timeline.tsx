"use client"

import { Timeline } from "@unitravel/ui/product/timeline"

import { useI18n } from "@/lib/i18n"

/** Request status history in the shared flight-path timeline (packages/ui/product/timeline). */
export function StatusTimeline({ items }: { items: { at: string; label: string; detail?: string }[] }) {
  const { date, sep } = useI18n()
  return <Timeline live items={items.map((x, i) => ({ id: String(i), title: x.label, meta: `${date(x.at, { withTime: true })}${x.detail ? `${sep}${x.detail}` : ""}` }))} />
}
