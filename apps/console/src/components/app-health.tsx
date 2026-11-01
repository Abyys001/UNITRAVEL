"use client"

import { useMemo } from "react"

import type { DashboardMetrics } from "@unitravel/contracts"

import { EmptyState, Skeleton, TileError } from "@/components/bento"
import { StackedRows, useNum } from "@/components/charts"
import { Dot } from "@/components/dev-ui"
import { Kpi } from "@/components/kpi"
import { useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"
import { STAGES } from "@/lib/stages"
import type { AdminDashboardOverview } from "@/lib/types"

const Tile = ({ title, sub, children, className, testId }: { title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string }) => (
  <section className={`bento-tile flex min-w-0 flex-col ${className ?? ""}`} data-testid={testId}>
    <header className="mb-4"><h3 className="text-lead font-semibold text-ink">{title}</h3>{sub && <p className="mt-0.5 text-meta text-steel">{sub}</p>}</header>
    <div className="min-h-0 flex-1">{children}</div>
  </section>
)

/**
 * SLOT for GET /v1/admin/dashboard/overview. The page passes `undefined` today and never requests the endpoint; when it
 * ships, fetch it in the page and pass the result. Missing numbers render as an em dash (UNKNOWN), never as zero.
 */
export function OverviewSlot({ data }: { data: AdminDashboardOverview | undefined }) {
  const t = useT()
  const fmt = useNum()
  if (!data) return null
  const n = (v: number | null) => (v === null ? "—" : fmt(v))
  const f = data.funnel
  const rows = [
    { key: "searches", label: "Searches", value: f.searches }, { key: "requests", label: t("home.app.submitted"), value: f.requests },
    { key: "quotes", label: t("case.panel.quotes"), value: f.quotes }, { key: "paid", label: t("home.inv.paid"), value: f.paid },
  ]
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-3" data-testid="app-overview">
      <Tile title="Sessions"><dl className="space-y-2"><div className="flex justify-between"><dt className="text-steel">Active</dt><dd className="num font-semibold">{n(data.sessions.active)}</dd></div><div className="flex justify-between"><dt className="text-steel">Failed sign-ins, 24 h</dt><dd className="num font-semibold">{n(data.sessions.failedSignIns24h)}</dd></div></dl></Tile>
      <Tile title="Providers"><ul className="space-y-2">{data.providers.map((p) => <li key={p.key} className="flex items-center gap-2"><Dot ok={p.healthy} label={p.label} /><span className="min-w-0 flex-1 truncate">{p.label}</span></li>)}</ul></Tile>
      <Tile title="Funnel"><StackedRows caption="Funnel" rows={rows.map((r) => ({ key: r.key, label: r.label, segments: [{ key: r.key, label: r.label, value: r.value ?? 0, color: "var(--viz-1)" }] }))} /></Tile>
    </div>
  )
}

/**
 * "How the app is working": headline counts and the pipeline, taken from GET /v1/admin/dashboard/metrics (requests per
 * day, current status of the requests in the range). Counts come from the tables; nothing is estimated or projected.
 */
export function AppHealth({ metrics, loading, error, onRetry, flights, overview }: { metrics: DashboardMetrics | undefined; loading: boolean; error: unknown; onRetry: () => void; flights: boolean; overview?: AdminDashboardOverview }) {
  const t = useT()
  const [locale] = useLocale()
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), [locale])
  const days = metrics?.submissions ?? []
  const perDay = days.map((d) => (d.flight ?? 0) + (d.cargo ?? 0))
  const total = perDay.reduce((a, b) => a + b, 0)
  const peak = Math.max(0, ...perDay)
  const peakDate = peak > 0 ? days[perDay.indexOf(peak)]?.date : undefined
  const avg = metrics && metrics.range.days ? Math.round((total / metrics.range.days) * 10) / 10 : undefined
  const rows = STAGES.map((st) => ({ key: st.status, label: t(st.label), segments: [{ key: st.status, label: t(st.label), value: metrics?.flightStatus?.find((x) => x.status === st.status)?.count ?? 0, color: st.color }] }))
  return (
    <section aria-labelledby="app-health-h" className="mb-4" data-testid="app-health">
      <div className="mb-3"><h2 id="app-health-h" className="text-lead font-semibold text-ink">{t("home.app.title")}</h2><p className="text-meta text-steel">{t("home.app.sub")}</p></div>
      {error ? <div className="bento-tile"><TileError error={error} onRetry={onRetry} /></div> : (
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="grid grid-cols-2 gap-4 xl:col-span-6">
            <Kpi compact label={t("home.app.today")} value={perDay.at(-1)} href={null} loading={loading} spark={perDay.slice(-14)} sparkLabel={t("home.spark.days")} />
            <Kpi compact label={t("home.app.avg")} value={avg} href={null} loading={loading} sub={metrics ? t("home.trend.sub", { from: dayFmt.format(new Date(`${metrics.range.from}T12:00:00Z`)), to: dayFmt.format(new Date(`${metrics.range.to}T12:00:00Z`)) }) : null} />
            <Kpi compact label={t("home.app.peak")} value={metrics ? peak : undefined} href={null} loading={loading} sub={peakDate ? dayFmt.format(new Date(`${peakDate}T12:00:00Z`)) : null} />
            <Kpi compact label={t("home.app.submitted")} value={metrics ? total : undefined} href={null} loading={loading} spark={perDay} sparkLabel={t("home.spark.days")} />
          </div>
          {flights && (
            <Tile className="xl:col-span-6" title={t("home.app.pipeline")} sub={t("home.app.pipelineSub")} testId="tile-pipeline">
              {loading ? <Skeleton className="h-[160px]" /> : !metrics?.flightStatus ? <EmptyState title={t("home.na")} hint={t("home.na.flights")} className="py-4" /> : <StackedRows rows={rows} caption={t("home.app.pipeline")} />}
            </Tile>
          )}
        </div>
      )}
      {/* SLOT (J3): GET /v1/admin/dashboard/overview. Not requested yet; pass the response here when the endpoint exists. */}
      <OverviewSlot data={overview} />
    </section>
  )
}
