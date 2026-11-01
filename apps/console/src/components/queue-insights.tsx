"use client"

import { useQuery } from "@tanstack/react-query"
import { ChartNoAxesColumn, ChevronDown } from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"

import type { DashboardMetrics } from "@unitravel/contracts"
import { cn } from "@unitravel/ui/lib/utils"

import { EmptyState, Skeleton, TileError } from "@/components/bento"
import { Donut, Legend, LineArea, SplitBar, useNum } from "@/components/charts"
import { Kpi } from "@/components/kpi"
import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useQueueSummary } from "@/lib/live"
import { useLocale } from "@/lib/prefs"
import { STAGES } from "@/lib/stages"

/** Counts seen in this browser tab, oldest first. Only real changes are kept, so a flat count has no trend line. */
function useTrail(value: number | undefined) {
  const [trail, setTrail] = useState<number[]>([])
  useEffect(() => {
    if (value === undefined) return
    setTrail((p) => (p.at(-1) === value ? p : [...p, value].slice(-24)))
  }, [value])
  return trail
}

const Tile = ({ title, sub, children, className, testId }: { title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string }) => (
  <section className={cn("bento-tile flex min-w-0 flex-col p-4", className)} data-testid={testId}>
    <header className="mb-3"><h2 className="text-lead font-semibold text-ink">{title}</h2>{sub && <p className="mt-0.5 text-meta text-steel">{sub}</p>}</header>
    <div className="min-h-0 flex-1">{children}</div>
  </section>
)

/**
 * Queue overview above the list: a KPI strip with trend lines and, on demand, the status mix, the SLA breach summary and
 * the intake chart. Everything is read from GET /v1/admin/queues/summary and GET /v1/admin/dashboard/metrics (the same
 * numbers as the dashboard); a trend is drawn only from real daily counts or from counts seen in this tab.
 */
export function QueueInsights({ flights, cargo }: { flights: boolean; cargo: boolean }) {
  const t = useT()
  const [locale] = useLocale()
  const fmt = useNum()
  const id = useId()
  const [open, setOpen] = useState(false)
  useEffect(() => { try { setOpen(localStorage.getItem("ut-q-insights") === "1") } catch { /* storage blocked: stay collapsed */ } }, [])
  const toggle = () => { const next = !open; setOpen(next); try { localStorage.setItem("ut-q-insights", next ? "1" : "0") } catch { /* preference only */ } }

  const summary = useQueueSummary()
  const metrics = useQuery({ queryKey: ["dashboard-metrics", "14"], queryFn: () => api<DashboardMetrics>("/v1/admin/dashboard/metrics?days=14"), enabled: flights || cargo, refetchInterval: 60_000, placeholderData: (prev) => prev })
  const s = summary.data, m = metrics.data

  const loc = locale === "fa" ? "fa-IR" : "en-GB"
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: "UTC" }), [loc])
  const longFmt = useMemo(() => new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" }), [loc])
  const days = m?.submissions ?? []
  const perDay = days.map((d) => (d.flight ?? 0) + (d.cargo ?? 0))
  const today = perDay.at(-1)
  const points = days.map((d) => ({ label: longFmt.format(new Date(`${d.date}T12:00:00Z`)), short: dayFmt.format(new Date(`${d.date}T12:00:00Z`)), values: { flight: d.flight ?? 0, cargo: d.cargo ?? 0 } }))
  const series = [...(flights ? [{ key: "flight", label: t("q.intake.flight"), color: "var(--viz-1)" }] : []), ...(cargo ? [{ key: "cargo", label: t("q.intake.cargo"), color: "var(--viz-2)" }] : [])]

  const stageSegs = STAGES.map((st) => ({ key: st.status, label: t(st.label), value: m?.flightStatus?.find((x) => x.status === st.status)?.count ?? 0, color: st.color }))
  const openTotal = m?.flightStatus ? stageSegs.reduce((n, x) => n + x.value, 0) : undefined
  const fc = m?.firstContact
  const fcDone = fc ? fc.met + fc.missed : 0
  const fcRate = fc && fcDone ? Math.round((fc.met / fcDone) * 100) : null

  const openTrail = useTrail(openTotal)
  const awaitTrail = useTrail(s?.awaitingCustomer)
  const breachTrail = useTrail(s?.slaBreaches)

  return (
    <section aria-label={t("q.insights")} className="shrink-0 border-b border-rule px-4 py-3 md:px-6" data-testid="queue-insights">
      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] md:grid md:grid-cols-4 md:overflow-visible md:pb-0">
        <div className="w-44 shrink-0 md:w-auto"><Kpi compact label={t("q.kpi.intake")} value={today} href={null} loading={!m} spark={perDay.slice(-14)} sparkLabel={t("q.kpi.intake14")} sub={t("q.kpi.intake14")} /></div>
        <div className="w-44 shrink-0 md:w-auto"><Kpi compact label={t("q.kpi.open")} value={flights ? openTotal : undefined} href={flights ? "/queues?tab=all" : null} loading={flights && !m} spark={openTrail} sparkLabel={t("q.kpi.session")} sub={flights ? t("q.kpi.session") : "—"} /></div>
        <div className="w-44 shrink-0 md:w-auto"><Kpi compact label={t("home.kpi.awaiting")} value={s?.awaitingCustomer} href={flights ? "/queues?tab=awaiting" : null} loading={!s} spark={awaitTrail} sparkLabel={t("q.kpi.session")} sub={s ? t("home.kpi.pipelineSub", { q: s.quoted, r: s.reserved }) : null} /></div>
        <div className="w-44 shrink-0 md:w-auto"><Kpi compact label={t("q.sla.now")} value={s?.slaBreaches} tone="danger" href={flights ? "/queues?tab=new" : null} loading={!s} spark={breachTrail} sparkLabel={t("q.kpi.session")} sub={s ? (s.slaBreaches ? t("home.kpi.breaching", { n: s.slaBreaches }) : t("home.kpi.withinSla")) : null} subTone={s?.slaBreaches ? "danger" : "ok"} /></div>
      </div>

      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={`${id}-charts`} className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-meta font-medium text-steel hover:text-ink pointer-coarse:min-h-11">
        <ChartNoAxesColumn className="size-4" aria-hidden />{open ? t("q.insights.hide") : t("q.insights.show")}<ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && <div id={`${id}-charts`} className="mt-2 grid gap-3 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
        {flights && (
          <Tile title={t("q.donut.title")} sub={t("q.donut.sub")} testId="insight-status">
            {metrics.isError ? <TileError error={metrics.error} onRetry={() => void metrics.refetch()} /> : !m ? <Skeleton className="h-[148px]" /> : !openTotal ? <EmptyState title={t("home.health.empty")} className="py-6" /> : (
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <Donut segments={stageSegs} label={t("home.stages.open")} size={132} thickness={14} />
                <ul className="w-full min-w-0 flex-1 space-y-1">
                  {stageSegs.filter((x) => x.value > 0).map((x) => (
                    <li key={x.key} className="flex items-center gap-2 text-meta"><span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: x.color }} /><span className="min-w-0 flex-1 truncate text-steel">{x.label}</span><span className="num font-semibold text-ink">{fmt(x.value)}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </Tile>
        )}
        {flights && (
          <Tile title={t("q.sla.title")} sub={m ? t("q.sla.window", { n: fmt(m.range.days) }) : undefined} testId="insight-sla">
            {metrics.isError ? <TileError error={metrics.error} onRetry={() => void metrics.refetch()} /> : !fc || !s ? <Skeleton className="h-[148px]" /> : (
              <div className="space-y-3">
                <p className="flex items-baseline gap-2"><span className={cn("num text-display leading-none font-semibold", s.slaBreaches ? "text-danger" : "text-ink")}>{fmt(s.slaBreaches)}</span><span className="text-meta text-steel">{s.slaBreaches ? t("q.sla.now") : t("q.sla.clear")}</span></p>
                <SplitBar label={t("q.sla.title")} segments={[{ key: "met", label: t("home.sla.met"), value: fc.met, color: "var(--viz-4)" }, { key: "missed", label: t("home.sla.missed"), value: fc.missed, color: "var(--viz-6)" }, { key: "pending", label: t("home.sla.pending"), value: fc.pending, color: "var(--viz-grid)" }]} />
                <Legend items={[{ label: t("home.sla.met"), color: "var(--viz-4)", value: fmt(fc.met) }, { label: t("home.sla.missed"), color: "var(--viz-6)", value: fmt(fc.missed) }, { label: t("home.sla.pending"), color: "var(--rule-strong)", value: fmt(fc.pending) }]} />
                {fcRate != null && <p className={cn("text-meta", fcRate < 80 ? "font-medium text-danger" : "text-steel")}>{t("q.sla.rate", { n: fmt(fcRate) })}</p>}
              </div>
            )}
          </Tile>
        )}
        <Tile title={t("q.intake.title")} className="lg:col-span-2 2xl:col-span-1" testId="insight-intake">
          {metrics.isError ? <TileError error={metrics.error} onRetry={() => void metrics.refetch()} /> : !m ? <Skeleton className="h-[148px]" /> : (
            <>
              <Legend className="mb-2" items={series.map((x) => ({ label: x.label, color: x.color, value: fmt(days.reduce((n, d) => n + (d[x.key as "flight" | "cargo"] ?? 0), 0)) }))} />
              <LineArea stacked data={points} series={series} height={150} caption={t("home.trend.caption", { n: m.range.days })} emptyLabel={t("home.trend.empty")} />
            </>
          )}
        </Tile>
      </div>}
    </section>
  )
}
