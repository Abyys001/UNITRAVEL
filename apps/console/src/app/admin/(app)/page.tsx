"use client"

import { useQuery } from "@tanstack/react-query"
import { CircleCheck, FileText, Gavel, IdCard, Inbox, Radio, Receipt, Search } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import type { VerificationQueueItem } from "@unitravel/contracts"
import { cn } from "@unitravel/ui/lib/utils"

import { BentoGrid, BentoTile, EmptyState, Skeleton, Stat, StatusChip, TileError, Sparkline } from "@/components/bento"
import { Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { type T, useT } from "@/lib/i18n"
import { type ActivityEntry, useActivity, useLive, useQueueSummary } from "@/lib/live"
import { useLocale } from "@/lib/prefs"
import { useSession } from "@/lib/session"
import type { CaseView, FlightListItem, Page, QueueSummary } from "@/lib/types"

type QuickAction = { href: string; label: string; icon: React.ReactNode }
type CountKey = "new" | "mine" | "awaitingCustomer" | "quoted" | "reserved" | "complianceHolds" | "slaBreaches"
type Sample = { at: number } & Record<CountKey, number>
const COUNT_KEYS: CountKey[] = ["new", "mine", "awaitingCustomer", "quoted", "reserved", "complianceHolds", "slaBreaches"]
const HIST_KEY = "ut-summary-history"

function loadHistory(): Sample[] {
  try { return JSON.parse(sessionStorage.getItem(HIST_KEY) ?? "[]") as Sample[] } catch { return [] }
}

/**
 * Counts seen by this browser tab, oldest to newest (sessionStorage, 30 samples, one per change). The API exposes no
 * history, so sparklines and deltas show only what this tab actually observed, and say so.
 */
function useTrend(s: QueueSummary | undefined) {
  const [hist, setHist] = useState<Sample[]>([])
  useEffect(() => {
    if (!s) return
    setHist((h) => {
      const base = h.length ? h : loadHistory()
      const last = base[base.length - 1]
      if (last && COUNT_KEYS.every((k) => last[k] === s[k])) return base
      const next = [...base, { at: Date.now(), ...Object.fromEntries(COUNT_KEYS.map((k) => [k, s[k]])) } as Sample].slice(-30)
      try { sessionStorage.setItem(HIST_KEY, JSON.stringify(next)) } catch { /* storage unavailable: the trend lasts until reload */ }
      return next
    })
  }, [s])
  return {
    series: (k: CountKey) => (hist.length >= 2 ? hist.map((x) => x[k]) : []),
    delta: (k: CountKey) => (hist.length >= 2 ? hist[hist.length - 1]![k] - hist[0]![k] : 0),
  }
}

function CaseRows({ items, t, empty }: { items: FlightListItem[]; t: T; empty: string }) {
  if (!items.length) return <p className="py-3 text-steel italic">{empty}</p>
  return (
    <ul className="ledger-rows">
      {items.map((r) => (
        <li key={r.ref}>
          <Link href={`/requests/${r.ref}`} className="grid min-h-9 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-sm py-1.5 hover:bg-hover">
            <span className="num text-[12px]">{r.ref}</span>
            <span className="truncate"><span dir="auto">{r.customer ?? "—"}</span> <span className="text-steel">· {r.routeLabel}</span></span>
            <span className="flex items-center gap-2">
              {r.slaBreached ? <StatusChip tone="danger">{t("sla.at", { t: rel(r.slaDueAt) })}</StatusChip> : r.slaDueAt ? <StatusChip tone="warn">{t("due.at", { t: rel(r.slaDueAt) })}</StatusChip> : null}
              <Tag value={r.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const SkeletonRows = ({ n = 4 }: { n?: number }) => <div className="space-y-2.5" aria-busy>{Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-7" />)}</div>

function HealthBar({ s, t }: { s: QueueSummary; t: T }) {
  const parts = [
    { key: "new", label: t("home.kpi.new"), n: s.new, cls: "bg-orange" },
    { key: "awaiting", label: t("home.kpi.awaiting"), n: s.awaitingCustomer, cls: "bg-warning-border" },
    { key: "quoted", label: t("home.kpi.quoted"), n: s.quoted, cls: "bg-cyan" },
    { key: "reserved", label: t("home.kpi.reserved"), n: s.reserved, cls: "bg-success" },
  ]
  const total = parts.reduce((n, p) => n + p.n, 0)
  if (!total) return <EmptyState icon={<Inbox className="size-4" />} title={t("home.health.empty")} />
  return (
    <div>
      <p className="mb-2 text-[12px] text-steel">{t("home.health.hint")}</p>
      <div role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")} className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-sunk">
        {parts.filter((p) => p.n).map((p) => <span key={p.key} className={cn("h-full first:rounded-s-full last:rounded-e-full", p.cls)} style={{ flexGrow: p.n, flexBasis: 0 }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {parts.map((p) => <li key={p.key} className="flex items-center gap-2"><span aria-hidden className={cn("size-2.5 shrink-0 rounded-sm", p.cls)} /><span className="min-w-0 flex-1 truncate text-steel">{p.label}</span><b className="num">{p.n}</b></li>)}
      </ul>
    </div>
  )
}

/** Deadlines per 3-hour block over the next 24 h, from the summary's own deadline list. */
function deadlineBlocks(list: QueueSummary["deadlinesNext24h"], now: number) {
  const bins = Array.from({ length: 8 }, () => 0)
  for (const d of list) {
    const i = Math.floor((new Date(d.deadline).getTime() - now) / 10_800_000)
    bins[Math.min(7, Math.max(0, i))]!++
  }
  return bins
}

function ActivityRow({ e, t, locale }: { e: ActivityEntry; t: T; locale: string }) {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(e.at)
  const label: Record<CountKey, string> = { new: t("home.kpi.new"), mine: t("home.kpi.mine"), awaitingCustomer: t("home.kpi.awaiting"), quoted: t("home.kpi.quoted"), reserved: t("home.kpi.reserved"), complianceHolds: t("home.kpi.holds"), slaBreaches: "SLA" }
  return (
    <li className="flex min-h-8 items-baseline gap-2 py-1.5">
      <time className="num shrink-0 text-[11px] text-steel" dateTime={new Date(e.at).toISOString()}>{time}</time>
      {e.kind === "request" ? (
        <Link href={e.requestType === "FLIGHT" ? `/requests/${e.ref}` : `/cargo/${e.ref}`} className="min-w-0 truncate hover:underline">{t("home.activity.request", { ref: e.ref })}</Link>
      ) : (
        <span className="min-w-0 flex-1">{e.changes.map((c) => <span key={c.key} className="me-2 whitespace-nowrap">{label[c.key]} <b className="num">{c.from}→{c.to}</b></span>)}</span>
      )}
    </li>
  )
}

export default function Home() {
  const { me, can, reload } = useSession()
  const t = useT()
  const [locale] = useLocale()
  const live = useLive()
  const activity = useActivity()
  const flights = can("flight_request.read.any")
  const summary = useQueueSummary()
  const mine = useQuery({ queryKey: ["fr", "mine-home"], queryFn: () => api<Page<FlightListItem>>("/v1/admin/flight-requests?tab=mine&limit=10"), enabled: flights })
  const fresh = useQuery({ queryKey: ["fr", "new-home"], queryFn: () => api<Page<FlightListItem>>("/v1/admin/flight-requests?tab=new&limit=10"), enabled: flights, refetchInterval: 30_000 })
  const holds = useQuery({ queryKey: ["cases", "OPEN"], queryFn: () => api<CaseView[]>("/v1/admin/compliance/cases?status=OPEN"), enabled: can("compliance.case.read") })
  const verifications = useQuery({ queryKey: ["verifications"], queryFn: () => api<VerificationQueueItem[]>("/v1/admin/verifications"), enabled: can("identity.verify"), refetchInterval: 30_000 })
  const duty = useAct((on: boolean) => api("/v1/me", { method: "PATCH", body: { onDuty: on } }), { onDone: () => void reload(), success: t("home.duty.done") })
  const s = summary.data
  const trend = useTrend(s)
  const now = new Date()
  const hour = now.getHours()
  const greeting = t(hour < 12 ? "home.morning" : hour < 18 ? "home.afternoon" : "home.evening", { name: me?.displayName.split(" ")[0] ?? "" })
  const blocks = useMemo(() => (s ? deadlineBlocks(s.deadlinesNext24h, Date.now()) : []), [s])
  const sinceLabel = t("home.delta.since")
  const kpi = (k: CountKey, label: string, tone: "default" | "danger" | "warn" = "default") => (
    <BentoTile size="s" key={k} data-testid={`kpi-${k}`}>
      {summary.isError ? <TileError onRetry={() => void summary.refetch()} /> : !s ? <div aria-busy className="space-y-3"><Skeleton className="h-3 w-20" /><Skeleton className="h-8 w-14" /><Skeleton className="h-7" /></div> : (
        <Stat label={label} value={s[k]} tone={s[k] > 0 ? tone : "default"} delta={{ value: trend.delta(k), label: sinceLabel }} spark={trend.series(k)} sparkLabel={t("home.spark.session")} hint={trend.series(k).length ? undefined : t("home.delta.collecting")} />
      )}
    </BentoTile>
  )
  const freshItems = fresh.data?.items ?? []
  const showHolds = can("compliance.case.read")
  const showVerify = can("identity.verify")
  // A lone tile beside the hero spans both rows; with none, the hero takes the full width, so the grid has no holes.
  const sideRows = showHolds && showVerify ? 1 : 2
  const sideCount = Number(showHolds) + Number(showVerify)
  const clear = !!s && s.slaBreaches === 0 && s.new === 0

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 md:px-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="cap">{new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now)}</p>
          <h1 className="mt-1 font-display text-[28px] leading-tight" dir="auto">{greeting}</h1>
        </div>
        <label className="flex min-h-8 items-center gap-2">
          <input type="checkbox" className="size-4 accent-success" checked={!!me?.onDuty} onChange={(e) => duty.mutate(e.target.checked)} />
          <span>{me?.onDuty ? t("home.onduty") : t("home.offduty")}</span>
        </label>
      </div>
      <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[14px]" data-testid="shift-line">
        {s ? (
          <>
            <Link className="underline decoration-orange underline-offset-4" href="/queues?tab=new"><b className="num">{s.new}</b> {t("home.shift.new")}</Link>
            <span className={s.slaBreaches ? "text-danger" : ""}><b className="num">{s.slaBreaches}</b> {t("home.shift.sla")}</span>
            <Link className="underline decoration-orange underline-offset-4" href="/queues?tab=mine"><b className="num">{s.mine}</b> {t("home.shift.mine")}</Link>
            <span><b className="num">{s.awaitingCustomer}</b> {t("home.shift.awaiting")}</span>
            <span><b className="num">{s.deadlinesNext24h.length}</b> {t("home.shift.deadlines")}</span>
            <span className={s.complianceHolds ? "text-danger" : ""}><b className="num">{s.complianceHolds}</b> {t("home.shift.holds")}</span>
          </>
        ) : summary.isError ? <span className="text-danger">{t("state.error")}</span> : <Skeleton className="h-5 w-2/3 max-w-xl" />}
      </p>

      <BentoGrid>
        {flights && (
          <BentoTile size={sideCount ? "xl" : "full"} rows={sideCount ? 2 : 1} tone={s && s.slaBreaches > 0 ? "alert" : "hero"} title={t("home.now")} aside={<Link href="/queues?tab=new" className="text-orange-700 hover:underline">{t("home.now.open")} →</Link>} data-testid="tile-now">
            {summary.isError ? <TileError onRetry={() => void summary.refetch()} /> : !s ? <SkeletonRows /> : (
              <div className="flex h-full flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <Stat label={t("home.now.sla")} value={s.slaBreaches} tone={s.slaBreaches > 0 ? "danger" : "default"} />
                  <Stat label={t("home.now.unassigned")} value={s.new} tone={s.new > 0 ? "warn" : "default"} />
                </div>
                {clear ? <EmptyState icon={<CircleCheck className="size-4" />} title={t("home.now.clear")} /> : fresh.isError ? <TileError message={t("home.now.error")} onRetry={() => void fresh.refetch()} /> : !fresh.data ? <SkeletonRows /> : <CaseRows items={freshItems.slice(0, 6)} t={t} empty={t("state.nothing")} />}
              </div>
            )}
          </BentoTile>
        )}
        {showHolds && (
          <BentoTile size="m" rows={sideRows} title={t("home.compliance")} aside={<Link href="/compliance" className="text-orange-700 hover:underline">{t("home.compliance.all")} →</Link>}>
            {holds.isError ? <TileError onRetry={() => void holds.refetch()} /> : !holds.data ? <SkeletonRows n={3} /> : !holds.data.length ? <EmptyState icon={<Gavel className="size-4" />} title={t("home.compliance.empty")} /> : (
              <div>
                <p className="num mb-1 text-[28px] leading-none font-semibold text-danger">{holds.data.length}</p>
                <ul className="ledger-rows">{holds.data.slice(0, 3).map((c) => <li key={c.id}><Link href={`/compliance/${c.id}`} className="grid min-h-9 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-sm py-1.5 hover:bg-hover"><span className="num text-[12px]">{c.requestRef}</span><span className="truncate" dir="auto">{c.summary}</span></Link></li>)}</ul>
              </div>
            )}
          </BentoTile>
        )}
        {showVerify && (
          <BentoTile size="m" rows={sideRows} title={t("home.verify")} aside={<Link href="/verifications" className="text-orange-700 hover:underline">{t("home.verify.open")} →</Link>}>
            {verifications.isError ? <TileError onRetry={() => void verifications.refetch()} /> : !verifications.data ? <SkeletonRows n={3} /> : !verifications.data.length ? <EmptyState icon={<IdCard className="size-4" />} title={t("home.verify.empty")} /> : (
              <div>
                <p className="num mb-1 text-[28px] leading-none font-semibold">{verifications.data.length}</p>
                <ul className="ledger-rows">{verifications.data.slice(0, 3).map((v) => <li key={v.id}><Link href={`/verifications/${v.id}`} className="flex min-h-9 items-center justify-between gap-3 rounded-sm py-1.5 hover:bg-hover"><span className="truncate" dir="ltr">{v.travellerName}</span><span className="num shrink-0 text-[11px] text-steel" title={fmtDateTime(v.submittedAt)}>{rel(v.submittedAt)}</span></Link></li>)}</ul>
              </div>
            )}
          </BentoTile>
        )}

        {kpi("new", t("home.kpi.new"), "warn")}
        {kpi("mine", t("home.kpi.mine"))}
        {kpi("awaitingCustomer", t("home.kpi.awaiting"))}
        {kpi("quoted", t("home.kpi.quoted"))}

        <BentoTile size="l" title={t("home.health")}>
          {summary.isError ? <TileError onRetry={() => void summary.refetch()} /> : !s ? <SkeletonRows n={2} /> : <HealthBar s={s} t={t} />}
        </BentoTile>
        <BentoTile size="l" title={t("home.deadlines")}>
          {summary.isError ? <TileError onRetry={() => void summary.refetch()} /> : !s ? <SkeletonRows n={3} /> : !s.deadlinesNext24h.length ? <EmptyState icon={<FileText className="size-4" />} title={t("home.deadlines.empty")} /> : (
            <div>
              <Sparkline values={blocks} label={t("home.deadlines.spark")} tone="warn" height={36} />
              <ul className="ledger-rows mt-2">{s.deadlinesNext24h.map((d) => <li key={d.ref} className="flex min-h-8 items-center justify-between py-1.5"><Link className="num hover:underline" href={`/requests/${d.ref}`}>{d.ref}</Link><span className="num text-[12px] text-danger">{fmtDateTime(d.deadline)} · {rel(d.deadline)}</span></li>)}</ul>
            </div>
          )}
        </BentoTile>

        {flights && (
          <BentoTile size="xl" title={t("home.mine")} aside={<Link href="/queues?tab=mine" className="text-orange-700 hover:underline">{t("home.now.open")} →</Link>}>
            {mine.isError ? <TileError onRetry={() => void mine.refetch()} /> : !mine.data ? <SkeletonRows /> : !mine.data.items.length ? <EmptyState title={t("home.mine.empty")} /> : <CaseRows items={mine.data.items.slice(0, 6)} t={t} empty={t("state.nothing")} />}
          </BentoTile>
        )}
        <BentoTile size="m" title={t("home.activity")} aside={<StatusChip tone={live ? "ok" : "neutral"}>{live ? t("home.activity.live") : t("home.activity.off")}</StatusChip>} data-testid="tile-activity">
          {!activity.length ? <EmptyState icon={<Radio className="size-4" />} title={t("home.activity.empty")} /> : (
            <ul className="ledger-rows max-h-72 overflow-y-auto" aria-live="polite">{activity.slice(0, 10).map((e) => <ActivityRow key={e.id} e={e} t={t} locale={locale} />)}</ul>
          )}
        </BentoTile>

        <BentoTile size="full" title={t("home.actions")}>
          <ul className="flex flex-wrap gap-2">
            {([
              flights && { href: "/queues?tab=new", label: t("act.queue"), icon: <Inbox className="size-4" /> },
              can("flight_search.run") && { href: "/search", label: t("act.search"), icon: <Search className="size-4" /> },
              can("compliance.case.read") && { href: "/compliance", label: t("act.cases"), icon: <Gavel className="size-4" /> },
              can("identity.verify") && { href: "/verifications", label: t("act.verify"), icon: <IdCard className="size-4" /> },
              can("commercial_document.issue", "flight_request.read.any", "cargo_request.read.any") && { href: "/invoices", label: t("act.invoices"), icon: <Receipt className="size-4" /> },
            ] as (QuickAction | false)[]).filter((a): a is QuickAction => !!a).map((a) => (
              <li key={a.href}><Link href={a.href} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-rule-strong px-3 hover:bg-hover"><span className="text-steel" aria-hidden>{a.icon}</span>{a.label}</Link></li>
            ))}
          </ul>
        </BentoTile>
      </BentoGrid>
    </div>
  )
}
