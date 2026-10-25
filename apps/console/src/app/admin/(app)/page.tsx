"use client"

import { useQuery } from "@tanstack/react-query"
import { CircleCheck, FileText, Gavel, IdCard, Radio } from "lucide-react"
import Link from "next/link"

import type { VerificationQueueItem } from "@unitravel/contracts"
import { cn } from "@unitravel/ui/lib/utils"

import { BentoTile, EmptyState, Skeleton, StatusChip, TileError } from "@/components/bento"
import { Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { type T, useT } from "@/lib/i18n"
import { type ActivityEntry, useActivity, useLive, useQueueSummary } from "@/lib/live"
import { useLocale } from "@/lib/prefs"
import { useSession } from "@/lib/session"
import type { CaseView, FlightListItem, Page } from "@/lib/types"

type CountKey = "new" | "mine" | "awaitingCustomer" | "quoted" | "reserved" | "complianceHolds" | "slaBreaches"

const more = "text-royal hover:underline"

function CaseRows({ items, t, empty }: { items: FlightListItem[]; t: T; empty: string }) {
  if (!items.length) return <p className="py-3 text-steel italic">{empty}</p>
  return (
    <ul className="ledger-rows">
      {items.map((r) => (
        <li key={r.ref}>
          <Link href={`/requests/${r.ref}`} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-sm px-1 py-2 hover:bg-hover">
            <span className="num w-28 shrink-0 text-[12px]" dir="ltr">{r.ref}</span>
            <span className="min-w-0 flex-1 basis-48 truncate"><span dir="auto">{r.customer ?? "—"}</span> <span className="text-steel">· <bdi>{r.routeLabel}</bdi></span></span>
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

function ActivityRow({ e, t, locale }: { e: ActivityEntry; t: T; locale: string }) {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(e.at)
  const label: Record<CountKey, string> = { new: t("home.kpi.new"), mine: t("home.kpi.mine"), awaitingCustomer: t("home.kpi.awaiting"), quoted: t("home.kpi.quoted"), reserved: t("home.kpi.reserved"), complianceHolds: t("home.kpi.holds"), slaBreaches: "SLA" }
  return (
    <li className="flex min-h-8 items-baseline gap-2 py-1.5">
      <time className="num shrink-0 text-[11px] text-steel" dateTime={new Date(e.at).toISOString()}>{time}</time>
      {e.kind === "request" ? (
        <Link href={e.requestType === "FLIGHT" ? `/requests/${e.ref}` : `/cargo/${e.ref}`} className="min-w-0 truncate hover:underline">{e.status ? t("home.activity.requestTo", { ref: e.ref, status: e.status.replace(/_/g, " ").toLowerCase() }) : t("home.activity.request", { ref: e.ref })}</Link>
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
  const showHolds = can("compliance.case.read")
  const showVerify = can("identity.verify")
  const summary = useQueueSummary()
  const mine = useQuery({ queryKey: ["fr", "mine-home"], queryFn: () => api<Page<FlightListItem>>("/v1/admin/flight-requests?tab=mine&limit=10"), enabled: flights })
  const fresh = useQuery({ queryKey: ["fr", "new-home"], queryFn: () => api<Page<FlightListItem>>("/v1/admin/flight-requests?tab=new&limit=10"), enabled: flights, refetchInterval: 30_000 })
  const holds = useQuery({ queryKey: ["cases", "OPEN"], queryFn: () => api<CaseView[]>("/v1/admin/compliance/cases?status=OPEN"), enabled: showHolds })
  const verifications = useQuery({ queryKey: ["verifications"], queryFn: () => api<VerificationQueueItem[]>("/v1/admin/verifications"), enabled: showVerify, refetchInterval: 30_000 })
  const duty = useAct((on: boolean) => api("/v1/me", { method: "PATCH", body: { onDuty: on } }), { onDone: () => void reload(), success: t("home.duty.done") })
  const s = summary.data
  const now = new Date()
  const hour = now.getHours()
  const greeting = t(hour < 12 ? "home.morning" : hour < 18 ? "home.afternoon" : "home.evening", { name: me?.displayName.split(" ")[0] ?? "" })
  const freshItems = fresh.data?.items ?? []
  const clear = !!s && s.slaBreaches === 0 && s.new === 0

  // Links only where the target page is allowed; otherwise the figure is shown as plain text.
  const strip: { k: CountKey; label: string; href: string | null; tone?: "danger" }[] = [
    { k: "new", label: t("home.kpi.new"), href: flights ? "/queues?tab=new" : null },
    { k: "slaBreaches", label: t("home.c.sla"), href: flights ? "/queues?tab=new" : null, tone: "danger" },
    { k: "mine", label: t("home.kpi.mine"), href: flights ? "/queues?tab=mine" : null },
    { k: "awaitingCustomer", label: t("home.kpi.awaiting"), href: flights ? "/queues?tab=awaiting" : null },
    { k: "quoted", label: t("home.kpi.quoted"), href: flights ? "/queues?tab=quoted" : null },
    { k: "reserved", label: t("home.kpi.reserved"), href: flights ? "/queues?tab=reserved" : null },
    { k: "complianceHolds", label: t("home.kpi.holds"), href: showHolds ? "/compliance" : null, tone: "danger" },
  ]

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 md:px-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="cap">{new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now)}</p>
          <h1 className="mt-1 font-display text-[28px] leading-tight" dir="auto">{greeting}</h1>
        </div>
        <label className="flex min-h-9 items-center gap-2">
          <input type="checkbox" className="size-4 accent-success" checked={!!me?.onDuty} onChange={(e) => duty.mutate(e.target.checked)} />
          <span>{me?.onDuty ? t("home.onduty") : t("home.offduty")}</span>
        </label>
      </div>

      <section aria-label={t("home.strip")} data-testid="shift-line" className="mb-4">
        {summary.isError ? <div className="rounded-xl border border-rule bg-surface-raised"><TileError onRetry={() => void summary.refetch()} /></div> : (
          <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-4 lg:grid-cols-7">
            {strip.map((c) => {
              const n = s?.[c.k]
              const inner = !s ? <><Skeleton className="h-7 w-10" /><Skeleton className="mt-2 h-3 w-20" /></> : (
                <><span className={cn("num block text-[24px] leading-none font-semibold", n && c.tone === "danger" ? "text-danger" : "text-ink")}>{n}</span><span className="mt-1.5 block text-[12px] text-steel">{c.label}</span></>
              )
              return <li key={c.k} className="bg-surface-raised">{c.href && s ? <Link href={c.href} className="block min-h-16 px-4 py-3 hover:bg-hover">{inner}</Link> : <div className="min-h-16 px-4 py-3" aria-busy={!s}>{inner}</div>}</li>
            })}
          </ul>
        )}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {flights && (
            <BentoTile tone={s && s.slaBreaches > 0 ? "alert" : "default"} title={t("home.now")} aside={<Link href="/queues?tab=new" className={more}>{t("home.now.open")} →</Link>} data-testid="tile-now">
              {summary.isError ? <TileError onRetry={() => void summary.refetch()} /> : !s ? <SkeletonRows /> : clear ? <EmptyState icon={<CircleCheck className="size-4" />} title={t("home.now.clear")} /> : fresh.isError ? <TileError message={t("home.now.error")} onRetry={() => void fresh.refetch()} /> : !fresh.data ? <SkeletonRows /> : <CaseRows items={freshItems.slice(0, 8)} t={t} empty={t("state.nothing")} />}
            </BentoTile>
          )}
          {flights && (
            <BentoTile title={t("home.mine")} aside={<Link href="/queues?tab=mine" className={more}>{t("home.now.open")} →</Link>}>
              {mine.isError ? <TileError onRetry={() => void mine.refetch()} /> : !mine.data ? <SkeletonRows /> : !mine.data.items.length ? <EmptyState title={t("home.mine.empty")} /> : <CaseRows items={mine.data.items.slice(0, 6)} t={t} empty={t("state.nothing")} />}
            </BentoTile>
          )}
        </div>

        <div className="space-y-4">
          <BentoTile title={t("home.deadlines")} aside={s?.deadlinesNext24h.length ? <StatusChip tone="warn">{s.deadlinesNext24h.length}</StatusChip> : undefined}>
            {summary.isError ? <TileError onRetry={() => void summary.refetch()} /> : !s ? <SkeletonRows n={3} /> : !s.deadlinesNext24h.length ? <EmptyState icon={<FileText className="size-4" />} title={t("home.deadlines.empty")} /> : (
              <ul className="ledger-rows">{s.deadlinesNext24h.map((d) => <li key={d.ref} className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 py-1.5"><Link className="num hover:underline" dir="ltr" href={`/requests/${d.ref}`}>{d.ref}</Link><span className="num text-[12px] text-danger" title={fmtDateTime(d.deadline)}>{rel(d.deadline)}</span></li>)}</ul>
            )}
          </BentoTile>
          {showHolds && (
            <BentoTile title={t("home.compliance")} aside={<Link href="/compliance" className={more}>{t("home.compliance.all")} →</Link>}>
              {holds.isError ? <TileError onRetry={() => void holds.refetch()} /> : !holds.data ? <SkeletonRows n={3} /> : !holds.data.length ? <EmptyState icon={<Gavel className="size-4" />} title={t("home.compliance.empty")} /> : (
                <ul className="ledger-rows">{holds.data.slice(0, 4).map((c) => <li key={c.id}><Link href={`/compliance/${c.id}`} className="grid min-h-9 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-sm py-1.5 hover:bg-hover"><span className="num text-[12px]" dir="ltr">{c.requestRef}</span><span className="truncate" dir="auto">{c.summary}</span></Link></li>)}</ul>
              )}
            </BentoTile>
          )}
          {showVerify && (
            <BentoTile title={t("home.verify")} aside={<><span className="text-steel">{verifications.data?.length ? t("home.verify.n", { n: verifications.data.length }) : null}</span><Link href="/verifications" className={more}>{t("home.verify.open")} →</Link></>}>
              {verifications.isError ? <TileError onRetry={() => void verifications.refetch()} /> : !verifications.data ? <SkeletonRows n={3} /> : !verifications.data.length ? <EmptyState icon={<IdCard className="size-4" />} title={t("home.verify.empty")} /> : (
                <ul className="ledger-rows">{verifications.data.slice(0, 4).map((v) => <li key={v.id}><Link href={`/verifications/${v.id}`} className="flex min-h-9 items-center justify-between gap-3 rounded-sm py-1.5 hover:bg-hover"><span className="truncate" dir="ltr">{v.travellerName}</span><span className="num shrink-0 text-[11px] text-steel" title={fmtDateTime(v.submittedAt)}>{rel(v.submittedAt)}</span></Link></li>)}</ul>
              )}
            </BentoTile>
          )}
          <BentoTile title={t("home.activity")} aside={<StatusChip tone={live ? "ok" : "neutral"}>{live ? t("home.activity.live") : t("home.activity.off")}</StatusChip>} data-testid="tile-activity">
            {!activity.length ? <EmptyState icon={<Radio className="size-4" />} title={t("home.activity.empty")} /> : (
              <ul className="ledger-rows" aria-live="polite">{activity.slice(0, 6).map((e) => <ActivityRow key={e.id} e={e} t={t} locale={locale} />)}</ul>
            )}
          </BentoTile>
        </div>
      </div>
    </div>
  )
}
