"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, CircleCheck, FileText, Gavel, IdCard, Radio, Receipt } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import type { DashboardMetrics, VerificationQueueItem } from "@unitravel/contracts"
import { formatMoney } from "@unitravel/domain"
import { cn } from "@unitravel/ui/lib/utils"

import { EmptyState, Skeleton, Sparkline, StatusChip, TileError } from "@/components/bento"
import { BarChart, Donut, Legend, SplitBar } from "@/components/charts"
import { Segmented, Switch } from "@/components/controls"
import { Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { type MsgKey, type T, useT } from "@/lib/i18n"
import { type ActivityEntry, useActivity, useLive, useQueueSummary } from "@/lib/live"
import { useLocale } from "@/lib/prefs"
import { useSession } from "@/lib/session"
import type { CaseView, FlightListItem, Page } from "@/lib/types"

type CountKey = "new" | "mine" | "awaitingCustomer" | "quoted" | "reserved" | "complianceHolds" | "slaBreaches"

/* Open stages in workflow order; colours follow the stage (waiting → working → with the customer → committed). */
const STAGES: { status: string; label: MsgKey; color: string }[] = [
  { status: "NEW", label: "home.stage.new", color: "var(--viz-2)" },
  { status: "IN_REVIEW", label: "home.stage.review", color: "var(--viz-1)" },
  { status: "AWAITING_CUSTOMER", label: "home.stage.awaiting", color: "var(--viz-3)" },
  { status: "QUOTED", label: "home.stage.quoted", color: "var(--viz-5)" },
  { status: "ACCEPTED", label: "home.stage.accepted", color: "var(--viz-4)" },
  { status: "RESERVED", label: "home.stage.reserved", color: "color-mix(in oklab, var(--viz-4) 55%, var(--surface-raised))" },
  { status: "COMPLIANCE_HOLD", label: "home.stage.hold", color: "var(--viz-6)" },
  { status: "SUBMITTED", label: "home.stage.screening", color: "var(--ink-subtle)" },
]

function Card({ title, aside, children, className, tone, testId, sub }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; tone?: "alert"; testId?: string; sub?: React.ReactNode }) {
  return (
    <section data-testid={testId} data-tone={tone} className={cn("bento-tile flex min-w-0 flex-col", className)}>
      <header className="mb-4 flex min-h-7 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0"><h2 className="text-lead font-semibold text-ink">{title}</h2>{sub && <p className="mt-0.5 text-meta text-steel">{sub}</p>}</div>
        {aside && <div className="flex items-center gap-2 text-meta">{aside}</div>}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

const More = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="inline-flex items-center gap-1 font-medium text-link hover:underline">{children}<ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden /></Link>

function CaseRows({ items, t, empty }: { items: FlightListItem[]; t: T; empty: string }) {
  if (!items.length) return <p className="py-3 text-steel">{empty}</p>
  return (
    <ul className="-mx-2 ledger-rows">
      {items.map((r) => (
        <li key={r.ref}>
          <Link href={`/requests/${r.ref}`} className="grid min-h-12 grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 transition-colors hover:bg-hover max-sm:grid-cols-[minmax(0,1fr)_auto]">
            <span className="ref font-semibold text-ink max-sm:col-span-2" dir="ltr">{r.ref}</span>
            <span className="min-w-0 truncate"><span dir="auto" className="font-medium">{r.customer ?? "—"}</span> <span className="text-steel">· <bdi>{r.routeLabel}</bdi></span></span>
            <span className="flex items-center justify-end gap-2">
              {r.slaBreached ? <StatusChip tone="danger">{t("sla.at", { t: rel(r.slaDueAt) })}</StatusChip> : r.slaDueAt ? <StatusChip tone="warn">{t("due.at", { t: rel(r.slaDueAt) })}</StatusChip> : null}
              <Tag value={r.status} className="max-md:hidden" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const SkeletonRows = ({ n = 4 }: { n?: number }) => <div className="space-y-3" aria-busy>{Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>

function ActivityRow({ e, t, locale }: { e: ActivityEntry; t: T; locale: string }) {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(e.at)
  const label: Record<CountKey, string> = { new: t("home.kpi.new"), mine: t("home.kpi.mine"), awaitingCustomer: t("home.kpi.awaiting"), quoted: t("home.kpi.quoted"), reserved: t("home.kpi.reserved"), complianceHolds: t("home.kpi.holds"), slaBreaches: "SLA" }
  return (
    <li className="flex min-h-9 items-baseline gap-3 py-2">
      <time className="num shrink-0 text-caption text-steel" dateTime={new Date(e.at).toISOString()}>{time}</time>
      {e.kind === "request" ? (
        <Link href={e.requestType === "FLIGHT" ? `/requests/${e.ref}` : `/cargo/${e.ref}`} className="min-w-0 truncate hover:underline">{e.status ? t("home.activity.requestTo", { ref: e.ref, status: e.status.replace(/_/g, " ").toLowerCase() }) : t("home.activity.request", { ref: e.ref })}</Link>
      ) : (
        <span className="min-w-0 flex-1">{e.changes.map((c) => <span key={c.key} className="me-2 whitespace-nowrap">{label[c.key]} <b className="num">{c.from}→{c.to}</b></span>)}</span>
      )}
    </li>
  )
}

function Kpi({ label, value, href, sub, subTone, spark, sparkLabel, tone, loading }: { label: string; value: number | undefined; href: string | null; sub?: React.ReactNode; subTone?: "danger" | "ok" | "muted"; spark?: number[]; sparkLabel?: string; tone?: "danger"; loading: boolean }) {
  const inner = (
    <>
      <p className="text-meta font-medium text-steel">{label}</p>
      {loading ? <Skeleton className="mt-3 h-8 w-16" /> : <p className={cn("num mt-2 text-display leading-none font-semibold tracking-tight", tone === "danger" && value ? "text-danger" : "text-ink")}>{value ?? "—"}</p>}
      <div className="mt-3 flex min-h-6 items-end justify-between gap-3">
        <p className={cn("text-meta", subTone === "danger" ? "font-medium text-danger" : subTone === "ok" ? "text-success" : "text-steel")}>{loading ? "" : sub}</p>
        {spark && spark.length > 1 && <Sparkline values={spark} label={sparkLabel} className="h-6 w-24 shrink-0 text-viz-1" height={24} />}
      </div>
    </>
  )
  const cls = "bento-tile block min-h-32 transition-colors"
  return href ? <Link href={href} className={cn(cls, "hover:border-rule-strong hover:bg-hover/40")}>{inner}</Link> : <div className={cls}>{inner}</div>
}

export default function Home() {
  const { me, can, reload } = useSession()
  const t = useT()
  const [locale] = useLocale()
  const live = useLive()
  const activity = useActivity()
  const [days, setDays] = useState<"14" | "30" | "90">("30")
  const flights = can("flight_request.read.any")
  const cargoRead = can("cargo_request.read.any")
  const showHolds = can("compliance.case.read")
  const showVerify = can("identity.verify")
  const summary = useQueueSummary()
  const metrics = useQuery({ queryKey: ["dashboard-metrics", days], queryFn: () => api<DashboardMetrics>(`/v1/admin/dashboard/metrics?days=${days}`), enabled: flights || cargoRead, refetchInterval: 60_000, placeholderData: (prev) => prev })
  const mine = useQuery({ queryKey: ["fr", "mine-home"], queryFn: () => api<Page<FlightListItem>>("/v1/admin/flight-requests?tab=mine&limit=10"), enabled: flights })
  const fresh = useQuery({ queryKey: ["fr", "new-home"], queryFn: () => api<Page<FlightListItem>>("/v1/admin/flight-requests?tab=new&limit=10"), enabled: flights, refetchInterval: 30_000 })
  const holds = useQuery({ queryKey: ["cases", "OPEN"], queryFn: () => api<CaseView[]>("/v1/admin/compliance/cases?status=OPEN"), enabled: showHolds })
  const verifications = useQuery({ queryKey: ["verifications"], queryFn: () => api<VerificationQueueItem[]>("/v1/admin/verifications"), enabled: showVerify, refetchInterval: 30_000 })
  const duty = useAct((on: boolean) => api("/v1/me", { method: "PATCH", body: { onDuty: on } }), { onDone: () => void reload(), success: t("home.duty.done") })
  const s = summary.data
  const m = metrics.data
  const now = new Date()
  const hour = now.getHours()
  const greeting = t(hour < 12 ? "home.morning" : hour < 18 ? "home.afternoon" : "home.evening", { name: me?.displayName.split(" ")[0] ?? "" })
  const clear = !!s && s.slaBreaches === 0 && s.new === 0
  const dayFmt = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
  const longFmt = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" })
  const points = (m?.submissions ?? []).map((d) => ({ label: longFmt.format(new Date(`${d.date}T12:00:00Z`)), short: dayFmt.format(new Date(`${d.date}T12:00:00Z`)), values: { flight: d.flight ?? 0, cargo: d.cargo ?? 0 } }))
  const series = [...(flights ? [{ key: "flight", label: t("home.series.flight"), color: "var(--viz-1)" }] : []), ...(cargoRead ? [{ key: "cargo", label: t("home.series.cargo"), color: "var(--viz-2)" }] : [])]
  const totalIn = (k: "flight" | "cargo") => (m?.submissions ?? []).reduce((n, d) => n + (d[k] ?? 0), 0)
  const last14 = (m?.submissions ?? []).slice(-14).map((d) => (d.flight ?? 0) + (d.cargo ?? 0))
  const stageSegs = STAGES.map((st) => ({ key: st.status, label: t(st.label), value: m?.flightStatus?.find((x) => x.status === st.status)?.count ?? 0, color: st.color }))
  const openTotal = stageSegs.reduce((n, x) => n + x.value, 0)
  const fc = m?.firstContact
  const fcDone = fc ? fc.met + fc.missed : 0
  const fcRate = fc && fcDone ? Math.round((fc.met / fcDone) * 100) : null
  const invCount = (st: string) => m?.invoices?.byStatus.find((x) => x.status === st)?.count ?? 0
  const sumMoney = (rows: { currency: string; amountMinor: number }[] | null | undefined) => rows && rows.length ? rows.map((r) => formatMoney({ amountMinor: r.amountMinor, currency: r.currency })).join(" · ") : null

  return (
    <div className="mx-auto max-w-[var(--content-max)] px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="text-meta text-steel">{new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}</p>
          <h1 className="mt-1 font-display text-display font-bold tracking-[-0.01em]" dir="auto">{greeting}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Fixed label, state on the switch: the old checkbox's label changed width on click and moved the box. */}
          <div className="w-full rounded-[var(--radius-card)] border border-rule bg-surface-raised px-3.5 py-1.5 shadow-[var(--shadow-xs)] sm:w-[19.5rem]">
            <Switch checked={!!me?.onDuty} onChange={(v) => duty.mutate(v)} disabled={duty.isPending} label={t("home.duty.label")} description={me?.onDuty ? t("home.duty.on") : t("home.duty.off")} testId="duty-switch" />
          </div>
          {flights && <Link href="/queues?tab=new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-semibold text-primary-foreground transition-colors hover:bg-primary/90">{t("home.openQueue")}<ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden /></Link>}
        </div>
      </div>

      <section aria-label={t("home.strip")} data-testid="shift-line" className="mb-4">
        {summary.isError ? <div className="bento-tile"><TileError onRetry={() => void summary.refetch()} /></div> : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label={t("home.kpi.new")} value={s?.new} href={flights ? "/queues?tab=new" : null} loading={!s} spark={last14} sparkLabel={t("home.spark.days")}
              sub={s ? (s.slaBreaches ? t("home.kpi.breaching", { n: s.slaBreaches }) : t("home.kpi.withinSla")) : null} subTone={s?.slaBreaches ? "danger" : "ok"} />
            <Kpi label={t("home.kpi.mine")} value={s?.mine} href={flights ? "/queues?tab=mine" : null} loading={!s} sub={s ? t("home.kpi.awaitingN", { n: s.awaitingCustomer }) : null} />
            <Kpi label={t("home.kpi.pipeline")} value={s ? s.quoted + s.reserved : undefined} href={flights ? "/queues?tab=quoted" : null} loading={!s} sub={s ? t("home.kpi.pipelineSub", { q: s.quoted, r: s.reserved }) : null} />
            <Kpi label={t("home.kpi.holds")} value={s?.complianceHolds} tone="danger" href={showHolds ? "/compliance" : null} loading={!s}
              sub={showVerify && verifications.data ? t("home.kpi.verifyN", { n: verifications.data.length }) : s ? t("home.kpi.deadlinesN", { n: s.deadlinesNext24h.length }) : null} />
          </div>
        )}
      </section>

      {(flights || cargoRead) && (
        <div className="mb-4 grid gap-4 xl:grid-cols-12">
          <Card className="xl:col-span-8" title={t("home.trend")} sub={m ? t("home.trend.sub", { from: dayFmt.format(new Date(`${m.range.from}T12:00:00Z`)), to: dayFmt.format(new Date(`${m.range.to}T12:00:00Z`)) }) : t("home.trend.loading")} testId="tile-trend"
            aside={<Segmented label={t("home.range")} hideLabel size="sm" value={days} onChange={setDays} options={[{ value: "14", label: t("home.range.d", { n: 14 }) }, { value: "30", label: t("home.range.d", { n: 30 }) }, { value: "90", label: t("home.range.d", { n: 90 }) }]} />}>
            {metrics.isError ? <TileError error={metrics.error} onRetry={() => void metrics.refetch()} /> : !m ? <Skeleton className="h-[220px]" /> : (
              <>
                <Legend className="mb-3" items={series.map((x) => ({ label: x.label, color: x.color, value: totalIn(x.key as "flight" | "cargo") }))} />
                <BarChart data={points} series={series} height={220} caption={t("home.trend.caption", { n: m.range.days })} emptyLabel={t("home.trend.empty")} />
              </>
            )}
          </Card>
          <Card className="xl:col-span-4" title={t("home.stages")} sub={t("home.stages.sub")} testId="tile-stages" aside={flights ? <More href="/queues?tab=all">{t("home.viewAll")}</More> : undefined}>
            {!flights ? <EmptyState title={t("home.na")} hint={t("home.na.flights")} /> : metrics.isError ? <TileError error={metrics.error} onRetry={() => void metrics.refetch()} /> : !m ? <Skeleton className="h-[220px]" /> : !openTotal ? <EmptyState icon={<CircleCheck />} title={t("home.health.empty")} /> : (
              <div className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col 2xl:flex-row 2xl:items-center">
                <Donut segments={stageSegs} label={t("home.stages.open")} />
                <ul className="w-full min-w-0 flex-1 space-y-1.5">
                  {stageSegs.filter((x) => x.value > 0).map((x) => (
                    <li key={x.key} className="flex items-center gap-2 text-meta"><span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: x.color }} /><span className="min-w-0 flex-1 truncate text-steel">{x.label}</span><span className="num font-semibold text-ink">{x.value}</span><span className="num w-10 text-end text-caption text-steel">{Math.round((x.value / openTotal) * 100)}%</span></li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          {flights && (
            <Card tone={s && s.slaBreaches > 0 ? "alert" : undefined} title={t("home.now")} sub={s ? (s.slaBreaches ? t("home.now.sub.breach", { n: s.slaBreaches }) : t("home.now.sub")) : undefined} aside={<More href="/queues?tab=new">{t("home.now.open")}</More>} testId="tile-now">
              {summary.isError ? <TileError onRetry={() => void summary.refetch()} /> : !s ? <SkeletonRows /> : clear ? <EmptyState icon={<CircleCheck />} title={t("home.now.clear")} /> : fresh.isError ? <TileError message={t("home.now.error")} onRetry={() => void fresh.refetch()} /> : !fresh.data ? <SkeletonRows /> : <CaseRows items={(fresh.data.items ?? []).slice(0, 8)} t={t} empty={t("state.nothing")} />}
            </Card>
          )}
          {flights && (
            <Card title={t("home.mine")} aside={<More href="/queues?tab=mine">{t("home.now.open")}</More>}>
              {mine.isError ? <TileError onRetry={() => void mine.refetch()} /> : !mine.data ? <SkeletonRows /> : !mine.data.items.length ? <EmptyState title={t("home.mine.empty")} /> : <CaseRows items={mine.data.items.slice(0, 6)} t={t} empty={t("state.nothing")} />}
            </Card>
          )}
        </div>

        <div className="space-y-4 xl:col-span-4">
          {flights && (
            <Card title={t("home.sla")} sub={m ? t("home.sla.sub", { n: m.range.days }) : undefined} testId="tile-sla">
              {metrics.isError ? <TileError error={metrics.error} onRetry={() => void metrics.refetch()} /> : !fc ? <SkeletonRows n={2} /> : !(fc.met + fc.missed + fc.pending) ? <EmptyState title={t("home.sla.empty")} /> : (
                <div className="space-y-3">
                  <p className="flex items-baseline gap-2"><span className={cn("num text-display leading-none font-semibold", fcRate != null && fcRate < 80 ? "text-danger" : "text-ink")}>{fcRate != null ? `${fcRate}%` : "—"}</span><span className="text-meta text-steel">{fcRate != null ? t("home.sla.rate") : t("home.sla.noneYet")}</span></p>
                  <SplitBar label={t("home.sla")} segments={[{ key: "met", label: t("home.sla.met"), value: fc.met, color: "var(--viz-4)" }, { key: "missed", label: t("home.sla.missed"), value: fc.missed, color: "var(--viz-6)" }, { key: "pending", label: t("home.sla.pending"), value: fc.pending, color: "var(--viz-grid)" }]} />
                  <Legend items={[{ label: t("home.sla.met"), color: "var(--viz-4)", value: fc.met }, { label: t("home.sla.missed"), color: "var(--viz-6)", value: fc.missed }, { label: t("home.sla.pending"), color: "var(--rule-strong)", value: fc.pending }]} />
                </div>
              )}
            </Card>
          )}
          <Card title={t("home.deadlines")} aside={s?.deadlinesNext24h.length ? <StatusChip tone="warn">{s.deadlinesNext24h.length}</StatusChip> : undefined}>
            {summary.isError ? <TileError onRetry={() => void summary.refetch()} /> : !s ? <SkeletonRows n={3} /> : !s.deadlinesNext24h.length ? <EmptyState icon={<FileText />} title={t("home.deadlines.empty")} className="py-5" /> : (
              <ul className="ledger-rows">{s.deadlinesNext24h.map((d) => <li key={d.ref} className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 py-2"><Link className="ref font-semibold hover:underline" dir="ltr" href={`/requests/${d.ref}`}>{d.ref}</Link><span className="num text-meta font-medium text-danger" title={fmtDateTime(d.deadline)}>{rel(d.deadline)}</span></li>)}</ul>
            )}
          </Card>
          {m?.invoices && (
            <Card title={t("home.invoices")} aside={<More href="/invoices">{t("home.viewAll")}</More>} testId="tile-invoices">
              <dl className="grid grid-cols-3 gap-3">
                {(["ISSUED", "PAID", "DRAFT"] as const).map((st) => <div key={st} className="rounded-lg bg-surface-sunk px-3 py-2.5"><dt className="text-caption text-steel">{t(`home.inv.${st.toLowerCase()}` as MsgKey)}</dt><dd className="num mt-1 text-section font-semibold">{invCount(st)}</dd></div>)}
              </dl>
              {m.invoices.outstanding !== null ? (
                <dl className="mt-3 space-y-1.5 text-meta">
                  <div className="flex justify-between gap-3"><dt className="text-steel">{t("home.inv.outstanding")}</dt><dd className="num font-semibold">{sumMoney(m.invoices.outstanding) ?? "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-steel">{t("home.inv.paidRange", { n: m.range.days })}</dt><dd className="num font-semibold">{sumMoney(m.invoices.paidInRange) ?? "—"}</dd></div>
                </dl>
              ) : <p className="mt-3 flex items-center gap-1.5 text-caption text-steel"><Receipt className="size-3.5" aria-hidden />{t("home.inv.noMoney")}</p>}
            </Card>
          )}
          {showHolds && (
            <Card title={t("home.compliance")} aside={<More href="/compliance">{t("home.compliance.all")}</More>}>
              {holds.isError ? <TileError onRetry={() => void holds.refetch()} /> : !holds.data ? <SkeletonRows n={3} /> : !holds.data.length ? <EmptyState icon={<Gavel />} title={t("home.compliance.empty")} className="py-5" /> : (
                <ul className="-mx-2 ledger-rows">{holds.data.slice(0, 4).map((c) => <li key={c.id}><Link href={`/compliance/${c.id}`} className="block rounded-lg px-2 py-2 transition-colors hover:bg-hover"><span className="ref block font-semibold" dir="ltr">{c.requestRef}</span><span className="line-clamp-1 text-meta text-steel" dir="auto">{c.summary}</span></Link></li>)}</ul>
              )}
            </Card>
          )}
          {showVerify && (
            <Card title={t("home.verify")} aside={<>{verifications.data?.length ? <StatusChip tone="info">{t("home.verify.n", { n: verifications.data.length })}</StatusChip> : null}<More href="/verifications">{t("home.verify.open")}</More></>}>
              {verifications.isError ? <TileError onRetry={() => void verifications.refetch()} /> : !verifications.data ? <SkeletonRows n={3} /> : !verifications.data.length ? <EmptyState icon={<IdCard />} title={t("home.verify.empty")} className="py-5" /> : (
                <ul className="-mx-2 ledger-rows">{verifications.data.slice(0, 4).map((v) => <li key={v.id}><Link href={`/verifications/${v.id}`} className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-hover"><span className="truncate font-medium" dir="ltr">{v.travellerName}</span><span className="num shrink-0 text-caption text-steel" title={fmtDateTime(v.submittedAt)}>{rel(v.submittedAt)}</span></Link></li>)}</ul>
              )}
            </Card>
          )}
          <Card title={t("home.activity")} aside={<StatusChip tone={live ? "ok" : "neutral"}>{live ? t("home.activity.live") : t("home.activity.off")}</StatusChip>} testId="tile-activity">
            {!activity.length ? <EmptyState icon={<Radio />} title={t("home.activity.empty")} className="py-5" /> : (
              <ul className="ledger-rows" aria-live="polite">{activity.slice(0, 6).map((e) => <ActivityRow key={e.id} e={e} t={t} locale={locale} />)}</ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
