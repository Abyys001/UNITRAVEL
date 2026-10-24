"use client"

import type { TrackingEventCode } from "@unitravel/contracts"
import { Timeline } from "@unitravel/ui/product/timeline"

import { useI18n } from "@/lib/i18n"

export interface TrackingEvent { id: string; eventCode: TrackingEventCode; location: string; occurredAt: string; description?: string; corrected?: boolean }

/** Shipment timeline on the shared Timeline. Labels come from the catalogue, never the raw event code (Phase E); a corrected entry says so. */
export function TrackingTimeline({ events }: { events: TrackingEvent[] }) {
  const { t, date, sep } = useI18n()
  return (
    <Timeline
      data-testid="tracking-timeline"
      empty={t("shipments.noEvents")}
      items={events.map((e) => ({
        id: e.id,
        title: t(`tracking.events.${e.eventCode}` as never),
        note: e.corrected ? t("shipments.updated") : undefined,
        meta: `${e.location}${sep}${date(e.occurredAt, { withTime: true })}${e.description ? `${sep}${e.description}` : ""}`,
      }))}
    />
  )
}
