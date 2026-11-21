"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Info, Plane } from "lucide-react"
import Link from "next/link"

import type { ShipmentTracking, TrackDetail, TrackEvent } from "@unitravel/contracts"
import { DocumentCard } from "@unitravel/ui/product/document-card"
import { ErrorState, LoadingState } from "@unitravel/ui/product/states"
import { Stepper } from "@unitravel/ui/product/stepper"

import { Auto, Ltr } from "@/components/badges"
import { linkClass, PortalSection, StatusPill } from "@/components/portal/parts"
import { useNum } from "@/components/portal/shell"
import { api, ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { fetchTrackDetail } from "@/lib/portal-api"

/** Estimates are always labelled as estimates (ADR-0040 D5): never a promise, never invented. */
export function EtaEstimate({ at }: { at: string | null }) {
  const { t, date } = useI18n()
  return (
    <div>
      <dt className="text-(color:--ink-muted)">{t("shipments.eta")}</dt>
      <dd className="font-semibold" data-testid="eta">{at ? date(at, { dateOnly: true, year: true }) : t("shipments.noEta")}{at && <span className="block text-xs font-normal text-(color:--ink-muted)">{t("shipments.etaNote")}</span>}</dd>
    </div>
  )
}

/** Connection state of live airline tracking, in words. Anything but ACTIVE says plainly that updates come from our cargo team. */
export function CarrierBanner({ carrier }: { carrier: ShipmentTracking["carrier"] }) {
  const { t, date } = useI18n()
  const live = carrier.state === "ACTIVE"
  return (
    <div role="note" data-testid="carrier-banner" data-state={carrier.state} className={`flex gap-3 rounded-xl border p-4 text-sm leading-6 ${live ? "border-success-border bg-success-subtle text-success-subtle-fg" : "border-warning-border bg-warning-subtle text-warning-subtle-fg"}`}>
      <Info aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div>
        <p className="font-semibold">{t("portal.cargo.carrier")}{carrier.airline && <> · <Auto>{carrier.airline}</Auto></>}</p>
        <p>{t(`portal.cargo.${carrier.state}`)}</p>
        {carrier.lastSyncedAt && live && <p className="mt-1 text-xs">{t("portal.cargo.lastSynced", { date: date(carrier.lastSyncedAt, { withTime: true }) })}</p>}
      </div>
    </div>
  )
}

export function ShipmentBlock({ s }: { s: ShipmentTracking }) {
  const { t, locale } = useI18n()
  const fmt = useNum()
  const kg = s.chargeableWeightKg === null ? null : s.chargeableWeightKg.toLocaleString(locale === "fa" ? "fa-IR" : "en")
  return (
    <PortalSection id="cargo-h" title={t("portal.cargo.title")}>
      <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
        <div><dt className="text-(color:--ink-muted)">{t("portal.cargo.awb")}</dt><dd className="font-semibold">{s.awbNumber ? <Ltr className="font-mono">{s.awbNumber}</Ltr> : t("portal.cargo.awbNone")}</dd></div>
        <div><dt className="text-(color:--ink-muted)">{t("portal.cargo.route")}</dt><dd className="flex items-center gap-2 font-semibold"><Auto>{s.origin}</Auto><ArrowRight aria-hidden className="size-4 shrink-0 rtl:rotate-180" /><Auto>{s.destination}</Auto></dd></div>
        <div><dt className="text-(color:--ink-muted)">{t("portal.cargo.service")}</dt><dd className="font-semibold"><Auto>{s.service}</Auto></dd></div>
        {s.pieces !== null && <div><dt className="text-(color:--ink-muted)">{t("portal.cargo.pieces")}</dt><dd className="font-semibold tabular-nums">{fmt(s.pieces)}</dd></div>}
        {kg !== null && <div><dt className="text-(color:--ink-muted)">{t("portal.cargo.weight")}</dt><dd className="font-semibold tabular-nums">{kg} kg</dd></div>}
        <EtaEstimate at={s.estimatedDeliveryAt} />
      </dl>
      <div className="mt-4"><CarrierBanner carrier={s.carrier} /></div>
    </PortalSection>
  )
}

/** Newest first: the latest event leads and is marked in words; the first-item dot is decoration. */
export function EventList({ events }: { events: TrackEvent[] }) {
  const { t, date, sep } = useI18n()
  if (!events.length) return <p className="text-sm text-(color:--ink-muted)">{t("portal.track.historyEmpty")}</p>
  return (
    <ol aria-live="polite" className="relative" data-testid="track-events">
      {events.map((e, i) => (
        <li key={e.id} className="relative pb-5 ps-8 last:pb-0">
          {i < events.length - 1 && <span aria-hidden className="absolute bottom-0 start-[7px] top-4 border-s-2 border-(--rule-strong)" />}
          <span aria-hidden className={`absolute start-0 top-1.5 size-4 rounded-full border-2 ${i === 0 ? "border-orange-700 bg-orange-700" : "border-navy-900 bg-(--surface-raised)"}`} />
          <p className="flex flex-wrap items-center gap-2 font-semibold leading-snug"><Auto>{e.label}</Auto>{i === 0 && <span className="rounded-full border border-orange-700 px-2 py-0.5 text-xs font-bold text-orange-700">{t("portal.track.latest")}</span>}</p>
          {e.description && <p className="text-sm" dir="auto">{e.description}</p>}
          <p className="text-xs text-(color:--ink-muted)">{date(e.at, { withTime: true })}{e.location && <>{sep}<Auto>{e.location}</Auto></>}{sep}{t(`portal.track.source${e.source}`)}{e.corrected && <>{sep}{t("portal.track.corrected")}</>}</p>
        </li>
      ))}
    </ol>
  )
}

/** `/v1/...` hrefs are API routes: `.../download` answers `{url}` and the file routes stream the PDF, so both go through the API proxy. Other paths are portal pages. */
function DocumentLink({ d }: { d: TrackDetail["documents"][number] }) {
  const { t, href } = useI18n()
  const cls = linkClass
  if (!d.href.startsWith("/v1/")) return <a href={/^\/(en|fa)\//.test(d.href) ? d.href : href(d.href)} className={cls}>{t("portal.track.openDocument")}</a>
  if (d.href.endsWith("/download")) {
    return <button type="button" className={cls} onClick={async () => { const r = await api<{ url: string }>(d.href); window.open(r.url, "_blank", "noopener") }}>{t("portal.track.openDocument")}</button>
  }
  return <a href={`/api${d.href}`} target="_blank" rel="noopener" className={cls}>{t("portal.track.openDocument")}</a>
}

/** Detail of one of the customer's own purchases (GET /v1/track/:ref): progress, history, next step, documents, cargo block. */
export function TrackDetailView({ ref: refCode, back }: { ref: string; back?: React.ReactNode }) {
  const { t, href, sep } = useI18n()
  const q = useQuery({ queryKey: ["track-detail", refCode], queryFn: () => fetchTrackDetail(refCode), refetchInterval: 30_000, retry: (n, e) => !(e instanceof ApiError && e.problem.status < 500) && n < 2 })
  const d: TrackDetail | undefined = q.data
  if (q.isLoading) return <LoadingState label={t("common.loading")} rows={3} />
  if (q.isError || !d) return <ErrorState title={(q.error instanceof ApiError && q.error.problem.status === 404) ? t("portal.track.notFound") : t("common.error")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />
  const idx = d.steps.findIndex((s) => s.state === "CURRENT")
  const current = idx >= 0 ? idx : d.steps.filter((s) => s.state === "DONE").length
  return (
    <div className="space-y-6" data-testid="track-detail">
      {back}
      <header className="portal-card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-2xl" dir="auto">{d.title}</h2>
            <p className="mt-1 text-sm text-(color:--ink-muted)"><Ltr className="font-mono">{d.ref}</Ltr>{sep}{t(`track.kinds.${d.kind}`)}</p>
          </div>
          <StatusPill>{d.statusLabel}</StatusPill>
        </div>
        {d.steps.length > 0 && <Stepper className="mt-6" steps={d.steps.map((s) => ({ key: s.code, label: s.label }))} current={current} label={t("portal.track.history")} labels={{ done: t("portal.stepState.DONE"), current: t("portal.stepState.CURRENT"), todo: t("portal.stepState.UPCOMING") }} />}
        {!d.active && <p className="mt-4 text-sm text-(color:--ink-muted)">{t("portal.track.closed")}</p>}
        <p className="mt-4 text-sm"><Link href={href(d.detailHref)} className={linkClass}>{t("portal.track.fullPage")}</Link></p>
      </header>
      <PortalSection id="next-h" title={t("portal.track.next")}>
        <p className="flex items-start gap-3 leading-7"><Plane aria-hidden className="mt-1.5 size-4 shrink-0 rtl:-scale-x-100" />{d.nextStep ? <Auto>{d.nextStep}</Auto> : t("portal.track.nextNone")}</p>
      </PortalSection>
      {d.shipment && <ShipmentBlock s={d.shipment} />}
      <PortalSection id="hist-h" title={t("portal.track.history")}><EventList events={d.events} /></PortalSection>
      <PortalSection id="docs-h" title={t("portal.track.documents")}>
        {!d.documents.length && <p className="text-sm text-(color:--ink-muted)">{t("portal.track.documentsNone")}</p>}
        <ul className="space-y-2">
          {d.documents.map((x) => <li key={`${x.kind}:${x.href}`}><DocumentCard title={<Auto>{x.label}</Auto>} actions={<DocumentLink d={x} />} /></li>)}
        </ul>
      </PortalSection>
    </div>
  )
}

