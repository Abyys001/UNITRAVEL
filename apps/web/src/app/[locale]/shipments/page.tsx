"use client"

import { useQuery } from "@tanstack/react-query"
import { PackageCheck, Truck } from "lucide-react"
import Link from "next/link"

import type { ShipmentSummary, ShipmentView } from "@unitravel/contracts"
import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { Auto, Ltr } from "@/components/badges"
import { TrackingTimeline } from "@/components/tracking-timeline"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

/** The estimate is always shown with its label and a note that it is not a promise. */
function Eta({ at }: { at: string | null }) {
  const { t, date } = useI18n()
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-steel">{t("shipments.eta")}</p>
      <p className="font-display text-lg" data-testid="eta">{at ? date(at, { dateOnly: true }) : t("shipments.noEta")}</p>
      {at && <p className="text-xs text-steel">{t("shipments.etaNote")}</p>}
    </div>
  )
}

function SummaryCard({ s }: { s: ShipmentSummary }) {
  const { t, href, locale } = useI18n()
  const n = (v: number) => (locale === "fa" ? v.toLocaleString("fa-IR") : String(v))
  return (
    <section className="card-brand grid gap-5 p-5 sm:grid-cols-[1fr_1fr_1fr_1.4fr]" aria-label={t("shipments.title")} data-testid="shipments-summary">
      {([["total", s.total], ["inTransit", s.inTransit], ["delivered", s.delivered]] as const).map(([k, v]) => (
        <div key={k}><p className="text-xs font-bold uppercase tracking-wide text-steel">{t(`shipments.${k}`)}</p><p className="font-display text-3xl">{n(v)}</p></div>
      ))}
      {s.next && (
        <Link href={href(`/cargo/${s.next.ref}`)} className="rounded-xl bg-cloud p-3 focus-visible:outline-2 focus-visible:outline-orange">
          <p className="text-xs font-bold uppercase tracking-wide text-steel">{t("shipments.next")}</p>
          <p className="font-display">{s.next.laneLabel}</p>
          <Eta at={s.next.estimatedDeliveryAt} />
        </Link>
      )}
    </section>
  )
}

export default function ShipmentsPage() {
  const { t, href, sep, date } = useI18n()
  const { me } = useRequireSignIn()
  const list = useQuery({ queryKey: ["shipments"], queryFn: () => api<ShipmentView[]>("/v1/shipments"), enabled: !!me, refetchInterval: 30_000 })
  const summary = useQuery({ queryKey: ["shipments", "summary"], queryFn: () => api<ShipmentSummary>("/v1/shipments/summary"), enabled: !!me, refetchInterval: 30_000 })
  const items = list.data ?? []
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{t("shipments.title")}</h1>
      <p className="mt-1 text-steel">{t("shipments.lead")}</p>
      {summary.data && summary.data.total > 0 && <div className="mt-6"><SummaryCard s={summary.data} /></div>}
      {list.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}
      {!list.isLoading && !items.length && <EmptyState className="mt-6" icon={<Truck />} title={t("shipments.empty")} />}
      <ul className="mt-6 space-y-5">
        {items.map((s) => (
          <li key={s.ref} className="card-brand p-5" data-testid="shipment-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl"><Auto>{s.laneLabel}</Auto></h2>
                <p className="text-xs text-steel"><Ltr className="font-mono">{s.ref}</Ltr>{s.awbNumber && <>{sep}{t("shipments.awb")} <Ltr className="font-mono">{s.awbNumber}</Ltr></>}</p>
              </div>
              <span className="rounded-full border border-navy-900/30 bg-cloud px-3 py-1 text-xs font-semibold text-navy-900">{s.statusLabel}</span>
            </div>
            <div className="mt-4 grid gap-5 md:grid-cols-[1fr_220px]">
              <TrackingTimeline events={s.timeline} />
              <div className="space-y-4">
                <Eta at={s.estimatedDeliveryAt} />
                {s.lastEvent && <div><p className="text-xs font-bold uppercase tracking-wide text-steel">{t("shipments.lastUpdate")}</p><p className="text-sm">{t(`tracking.events.${s.lastEvent.eventCode}` as never)}{sep}{date(s.lastEvent.occurredAt, { withTime: true })}</p></div>}
                <Link href={href(`/cargo/${s.ref}`)} className="inline-flex items-center gap-1.5 text-sm font-semibold underline"><PackageCheck className="size-4" aria-hidden />{t("shipments.open")}</Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
