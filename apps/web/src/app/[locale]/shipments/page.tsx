"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Package, PackageCheck, Truck } from "lucide-react"
import Link from "next/link"

import type { ShipmentSummary, ShipmentView } from "@unitravel/contracts"
import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { Auto, Ltr } from "@/components/badges"
import { ServiceHero } from "@/components/service-hero"
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
        <div key={k} className="self-start border-s-4 border-orange/70 ps-3"><p className="text-xs font-bold uppercase tracking-wide text-steel">{t(`shipments.${k}`)}</p><p className="font-display text-4xl">{n(v)}</p></div>
      ))}
      {s.next && (
        <Link href={href(`/cargo/${s.next.ref}`)} className="rounded-2xl bg-cloud p-4 transition-colors hover:bg-cloud/70 focus-visible:outline-2 focus-visible:outline-orange">
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
    <>
    <ServiceHero testId="shipments-hero" compact photo="cargo" eyebrow={t("shipments.eyebrow")} title={t("shipments.title")} accent={t("shipments.accent")} lead={t("shipments.lead")}
      actions={<Link href={href("/cargo")} className="btn-orange">{t("shipments.send")}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Link>} />
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-8 md:px-6">
      {summary.data && summary.data.total > 0 && <SummaryCard s={summary.data} />}
      {list.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}
      {!list.isLoading && !items.length && <EmptyState className="mt-6" icon={<Truck />} title={t("shipments.empty")} />}
      <ul className="mt-6 space-y-5">
        {items.map((s) => (
          <li key={s.ref} className="card-brand overflow-hidden p-0" data-testid="shipment-card">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-cloud/50 p-5">
              <div className="flex items-start gap-3">
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-950 text-white"><Package className="size-4" /></span>
                <div>
                <h2 className="font-display text-xl"><Auto>{s.laneLabel}</Auto></h2>
                <p className="text-xs text-steel"><Ltr className="font-mono">{s.ref}</Ltr>{s.awbNumber && <>{sep}{t("shipments.awb")} <Ltr className="font-mono">{s.awbNumber}</Ltr></>}</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-navy-950 px-3 py-1 text-xs font-semibold text-white"><span aria-hidden className="size-1.5 rounded-full bg-orange" />{s.statusLabel}</span>
            </div>
            <div className="grid gap-5 p-5 md:grid-cols-[1fr_220px]">
              <TrackingTimeline events={s.timeline} />
              <div className="space-y-4">
                <Eta at={s.estimatedDeliveryAt} />
                {s.lastEvent && <div><p className="text-xs font-bold uppercase tracking-wide text-steel">{t("shipments.lastUpdate")}</p><p className="text-sm">{t(`tracking.events.${s.lastEvent.eventCode}` as never)}{sep}{date(s.lastEvent.occurredAt, { withTime: true })}</p></div>}
                <Link href={href(`/cargo/${s.ref}`)} className="inline-flex items-center gap-1.5 rounded-full border-2 border-navy-900 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-navy-900 hover:text-white pointer-coarse:min-h-11"><PackageCheck className="size-4" aria-hidden />{t("shipments.open")}</Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
    </>
  )
}
