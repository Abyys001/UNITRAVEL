"use client"

import { CalendarDays, Phone, Plane, UsersRound } from "lucide-react"

import type { SearchQuery } from "@unitravel/contracts"
import { buttonVariants } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { StatusChip } from "@/components/bento"
import { SlaGauge, StateChip, StatusStepper, statusTone, type Tally, TruthTally } from "@/components/case"
import { Arrow, RouteText } from "@/components/ui"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { type MsgKey, statusText, useT } from "@/lib/i18n"
import type { FlightDetail } from "@/lib/types"

type Place = SearchQuery["slices"][number]["from"]
const codeOf = (p: Place) => ("city" in p ? p.city : p.airport)

const HeroChip = ({ icon, children, className }: { icon?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border border-rule-strong bg-surface-sunk px-3 text-meta font-medium whitespace-nowrap text-ink [&_svg]:size-3.5 [&_svg]:text-steel", className)}>{icon}{children}</span>
)

function Endpoint({ code, name, label, end }: { code: string; name: string; label: string; end?: boolean }) {
  return (
    <div className={cn("min-w-0 max-w-[40%] shrink", end && "text-end")}>
      <p className="cap">{label}</p>
      <p className="font-display text-title leading-none font-bold tracking-tight text-ink sm:text-display" dir="ltr"><bdi>{code}</bdi></p>
      <p className="mt-1 truncate text-meta text-steel" dir="auto" title={name}>{name}</p>
    </div>
  )
}

/**
 * Hero of the request page: reference and state, the route with an animated dashed line, trip chips, the workflow
 * stepper and the three things staff look at first: SLA, owner and what is known about the quote. Every value is the
 * server's (status, SLA, unknown facts); nothing here is inferred.
 */
export function RequestHero({ d, mobile, mineCase, tally, quoteVersion }: { d: FlightDetail; mobile: boolean; mineCase: boolean; tally: Tally | null; quoteVersion: number | null }) {
  const t = useT()
  const slices = d.query.slices
  const first = slices[0], last = slices[slices.length - 1]
  const roundTrip = d.tripType === "RETURN"
  const from = first ? codeOf(first.from) : ""
  const to = first ? codeOf(roundTrip || slices.length === 1 ? first.to : last!.to) : ""
  const name = (c: string) => d.places?.[c] ?? c
  const pax = Object.entries(d.query.passengers.reduce<Record<string, number>>((m, p) => ({ ...m, [p.type]: (m[p.type] ?? 0) + 1 }), {}))
  const dateText = roundTrip && last && last !== first ? <><span className="num">{fmtDate(first!.date)}</span> <Arrow /> <span className="num">{fmtDate(last.date)}</span></> : <span className="num">{first ? fmtDate(first.date) : fmtDate(d.firstTravelDate)}</span>
  const key = (p: string, v: string) => `case.${p}.${v}` as MsgKey
  const paxLabel = (type: string, n: number) => `${t(key("pax", type))} × ${n}`

  return (
    <section className="border-b border-rule bg-surface-raised px-5 pt-5 pb-5 md:px-6" aria-label={t("case.panel.request")}>
      <h1 className="sr-only"><RouteText>{d.routeLabel}</RouteText></h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="ref text-lead font-semibold" data-testid="ref">{d.ref}</span>
        <span data-testid="status"><StateChip value={d.status} /></span>
        <StatusChip tone={statusTone(d.paymentStatus)} className="font-semibold">{t("case.payment", { status: statusText(t, d.paymentStatus).toLowerCase() })}</StatusChip>
        {d.urgent && <StatusChip tone="danger" className="font-semibold">{t("case.urgent")}</StatusChip>}
        {mobile && <a href={`tel:${d.customer.phone}`} className={cn(buttonVariants({ size: "sm" }), "ms-auto")}><Phone /> {t("common.call")}</a>}
      </div>

      {first && (
        <div role="group" aria-label={t("case.hero.route")} className="mt-5 flex items-center gap-3 sm:gap-6">
          <Endpoint code={from} name={name(from)} label={t("case.hero.from")} />
          <div className="relative h-10 min-w-14 flex-1" aria-hidden>
            <span className="absolute start-0 top-1/2 size-2 -translate-y-1/2 rounded-full bg-royal/60" /><span className="absolute end-0 top-1/2 size-2 -translate-y-1/2 rounded-full bg-royal/60" />
            <svg className="absolute inset-x-1 top-1/2 h-1 w-[calc(100%-0.5rem)] -translate-y-1/2 overflow-visible text-royal/60">
              <line x1="0" x2="100%" y1="2" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="route-dash" />
            </svg>
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid size-9 place-items-center rounded-full border border-rule-strong bg-surface-raised text-royal shadow-[var(--shadow-xs)]"><Plane className="size-4 rotate-45 rtl:-scale-x-100 rtl:-rotate-45" /></span>
            </span>
          </div>
          <Endpoint code={to} name={name(to)} label={t("case.hero.to")} end />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        <HeroChip icon={<CalendarDays aria-hidden />}>{dateText}</HeroChip>
        <HeroChip icon={<UsersRound aria-hidden />}>{pax.map(([type, n]) => paxLabel(type, n)).join(" · ")}</HeroChip>
        <HeroChip>{t(key("trip", d.tripType))}{slices.length > 2 || d.tripType === "MULTI_CITY" ? ` · ${t("case.hero.flights", { n: slices.length })}` : ""}</HeroChip>
        <HeroChip>{t(key("cabin", d.query.cabin))}</HeroChip>
        {d.kind === "MANUAL" && <HeroChip className="border-warning-border bg-warning-subtle text-warning-subtle-fg">{t("case.kind.manual")}</HeroChip>}
      </div>
      <p className="mt-2 text-meta text-steel">{t("case.submitted", { at: fmtDateTime(d.submittedAt), via: d.submittedVia.toLowerCase() })} ({d.submittedLocale})</p>

      <StatusStepper status={d.status} className="mt-5" />

      <div className="mt-5 grid gap-x-8 gap-y-4 border-t border-rule pt-4 md:grid-cols-2 xl:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)]" data-testid="case-summary">
        <SlaGauge dueAt={d.sla.dueAt} startAt={d.submittedAt} firstContactAt={d.sla.firstContactAt} />
        <div className="min-w-0">
          <p className="cap">{t("case.owner")}</p>
          <p className="mt-1 flex items-center gap-2">
            <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-full font-display text-meta font-bold", d.assignee ? "bg-navy-900 text-white dark:bg-navy-700" : "border border-dashed border-danger text-danger")}>{d.assignee ? (d.assignee.name ?? "?").slice(0, 1).toUpperCase() : "?"}</span>
            <span className="min-w-0 truncate font-medium" data-testid="assignee">{d.assignee ? (mineCase ? t("case.assignedYou") : t("case.assignedTo", { name: d.assignee.name ?? "—" })) : <span className="text-danger">{t("case.unassigned")}</span>}</span>
          </p>
        </div>
        <div className="min-w-0 md:col-span-2 xl:col-span-1">
          <p className="cap">{t("case.truth")}</p>
          {!tally ? <p className="mt-1 text-steel" data-testid="truth-note">{t("case.truth.none")}</p> : (
            <div className="mt-1 space-y-1.5">
              <TruthTally badges tally={tally} />
              <p className={cn("text-meta", tally.unknown > 0 ? "font-medium text-danger" : "text-steel")} data-testid="truth-note">{tally.unknown > 0 ? t("case.truth.blocks") : t("case.truth.clear")} <span className="text-steel">· {t("case.truth.quote", { v: quoteVersion ?? 0 })}</span></p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
