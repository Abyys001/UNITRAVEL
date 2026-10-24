"use client"

/**
 * Case-page primitives for the Control deck (Phase 2, docs/design/DESIGN.md "Control deck"). Built on bento.tsx and the
 * semantic tokens, so light/dark, density and RTL behave like the dashboard.
 *
 *   <CaseHeader reference title meta aside />      title strip: reference, route/subject, one meta line, right slot
 *   <SlaChip dueAt startAt breached done />        countdown ring + relative time; text always present, ticks every 30 s
 *   <StateChip value />                            workflow status as a StatusChip (tone from the status, text = the status)
 *   <TruthTally tally />                           known / not included / UNKNOWN counts; UNKNOWN is never softened
 *   <ActionBar edge>                               sticky bar for the server-computed commands (top) or a form's submit (bottom)
 *   <CaseTabs> + paneClass()                       phone/tablet tabs over the columns; all columns show side by side at lg
 *   <Timeline items />                             day-grouped vertical activity trail
 *   <ListSkeleton rows />                          table/card placeholder rows
 */
import { useSyncExternalStore } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { StatusChip } from "@/components/bento"
import { type MsgKey, type T, useT } from "@/lib/i18n"
import type { StaffQuoteOption } from "@/lib/types"

/* ---------- shared clock: one interval for every countdown on the page ---------- */
const clockSubs = new Set<() => void>()
let clockNow = Date.now()
let clockTimer: ReturnType<typeof setInterval> | undefined
const subscribeClock = (fn: () => void) => {
  clockSubs.add(fn)
  if (!clockTimer) {
    clockNow = Date.now()
    clockTimer = setInterval(() => { clockNow = Date.now(); for (const s of clockSubs) s() }, 30_000)
  }
  return () => { clockSubs.delete(fn); if (!clockSubs.size && clockTimer) { clearInterval(clockTimer); clockTimer = undefined } }
}
export const useNow = () => useSyncExternalStore(subscribeClock, () => clockNow, () => 0)

export function duration(ms: number, t: T): string {
  const m = Math.round(Math.abs(ms) / 60000)
  const d = t("time.d"), h = t("time.h"), mm = t("time.m")
  return m >= 1440 ? `${Math.floor(m / 1440)} ${d} ${Math.floor((m % 1440) / 60)} ${h}` : m >= 60 ? `${Math.floor(m / 60)} ${h} ${m % 60} ${mm}` : `${m} ${mm}`
}

/* ---------- SLA ---------- */
export function SlaRing({ frac, className }: { frac: number; className?: string }) {
  const r = 6.5, c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-4 shrink-0 -rotate-90", className)}>
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" />
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${Math.max(0, Math.min(1, frac)) * c} ${c}`} />
    </svg>
  )
}

/** Share of the SLA window still left, and the tone it deserves: breached = danger, < 25 % or < 30 min = warn. */
export function slaState(dueAt: string, startAt: string | null | undefined, breached: boolean | undefined, now: number) {
  const due = Date.parse(dueAt)
  const diff = due - now
  const start = startAt ? Date.parse(startAt) : NaN
  const window = Number.isFinite(start) && due > start ? due - start : NaN
  const frac = diff <= 0 ? 1 : Number.isFinite(window) ? diff / window : 1
  const late = breached || diff < 0
  const tone: "danger" | "warn" | "neutral" = late ? "danger" : diff < 30 * 60_000 || (Number.isFinite(window) && diff / window < 0.25) ? "warn" : "neutral"
  return { diff, frac, late, tone }
}

export function SlaChip({ dueAt, startAt, breached, done, className }: { dueAt: string | null | undefined; startAt?: string | null; breached?: boolean; done?: boolean; className?: string }) {
  const t = useT()
  const now = useNow() || Date.now()
  if (done) return <StatusChip tone="ok" className={className}>{t("sla.done")}</StatusChip>
  if (!dueAt) return <span className="text-steel">—</span>
  const s = slaState(dueAt, startAt, breached, now)
  const text = s.late ? t("sla.breached", { t: duration(s.diff, t) }) : t("time.in", { t: duration(s.diff, t) })
  return <StatusChip tone={s.tone} className={cn("num", className)} icon={<SlaRing frac={s.frac} />}>{text}</StatusChip>
}

/* ---------- status ---------- */
const OK = new Set(["ACCEPTED", "RESERVED", "TICKETED", "COMPLETED", "DELIVERED", "BOOKED", "VERIFIED", "RELEASED", "ALLOWED", "ACTIVE", "CONFIRMED", "PAID", "PUBLISHED", "CLEAR"])
const WARN = new Set(["NEW", "SUBMITTED", "AWAITING_CUSTOMER", "REVIEW", "PENDING_APPROVAL", "CORRECTION_REQUIRED", "ESCALATED", "HELD", "RECORDED", "IN_TRANSIT"])
const DANGER = new Set(["COMPLIANCE_HOLD", "EXCEPTION", "OPEN", "REJECTED", "PROHIBITED", "FAILED", "HIT"])
const INFO = new Set(["QUOTED", "SENT", "ISSUED", "IN_REVIEW", "RECEIVED"])
export const statusTone = (status: string): "ok" | "warn" | "danger" | "info" | "neutral" => (OK.has(status) ? "ok" : DANGER.has(status) ? "danger" : WARN.has(status) ? "warn" : INFO.has(status) ? "info" : "neutral")

/** Workflow status as a chip. The visible text is the status itself (uppercased by CSS), colour only reinforces it. */
export function StateChip({ value, className }: { value: string; className?: string }) {
  return <StatusChip tone={statusTone(value)} className={cn("font-mono text-[10.5px] tracking-wide uppercase", className)}>{value.replace(/_/g, " ")}</StatusChip>
}

/* ---------- truth (known / not included / UNKNOWN) ---------- */
export interface Tally { known: number; notIncluded: number; unknown: number }
type TriLike = { status: "KNOWN"; value: unknown } | { status: "UNKNOWN" }
const classify = (x: TriLike, notIncluded: (v: Record<string, unknown>) => boolean): keyof Tally => (x.status === "UNKNOWN" ? "unknown" : notIncluded((x.value ?? {}) as Record<string, unknown>) ? "notIncluded" : "known")
const noBag = (v: Record<string, unknown>) => v.pieces === 0 || v.totalKg === 0
const noRight = (v: Record<string, unknown>) => v.allowed === false

/**
 * Known / not-included come from the stated facts on the options. UNKNOWN is the server's own list (`unknownFields`, the
 * facts `unknownQuoteFields` blocks sending on), so this tile can never disagree with the send guard.
 */
export function tallyOptions(options: Pick<StaffQuoteOption, "baggage" | "conditions" | "unknownFields">[]): Tally {
  const out: Tally = { known: 0, notIncluded: 0, unknown: 0 }
  const count = (x: TriLike, notIncluded: (v: Record<string, unknown>) => boolean) => { const k = classify(x, notIncluded); if (k !== "unknown") out[k]++ }
  for (const o of options) {
    out.unknown += o.unknownFields.length
    for (const b of o.baggage) count(b.checked as TriLike, noBag)
    count(o.conditions.change as TriLike, noRight)
    count(o.conditions.refund as TriLike, noRight)
  }
  return out
}

export function TruthTally({ tally, className }: { tally: Tally; className?: string }) {
  const t = useT()
  const cell = (k: MsgKey, n: number, cls: string) => (
    <div><dt className="cap">{t(k)}</dt><dd className={cn("num text-[22px] leading-tight font-semibold", cls)}>{n}</dd></div>
  )
  return (
    <dl className={cn("grid grid-cols-3 gap-2", className)} data-testid="truth-tally">
      {cell("case.truth.known", tally.known, "text-ink")}
      {cell("case.truth.notIncluded", tally.notIncluded, "text-ink")}
      {cell("case.truth.unknown", tally.unknown, tally.unknown ? "text-danger" : "text-ink")}
    </dl>
  )
}

/* ---------- layout ---------- */
export function CaseHeader({ reference, title, meta, aside }: { reference: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-rule bg-surface-raised px-5 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">{reference}<span className="font-display text-[20px] leading-tight" dir="auto">{title}</span></p>
        {meta && <p className="mt-0.5 text-steel">{meta}</p>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </header>
  )
}

/** Sticky strip. `top` sits under the 48 px app bar (case commands); `bottom` docks above the phone tab bar (form submit). */
export function ActionBar({ edge = "top", className, children, ...rest }: React.ComponentProps<"div"> & { edge?: "top" | "bottom" }) {
  return (
    <div {...rest} className={cn("z-20 bg-surface-raised/95 px-5 py-2 backdrop-blur", edge === "top" ? "sticky top-12 border-b border-rule" : "sticky bottom-[calc(3rem+env(safe-area-inset-bottom))] border-t border-rule md:bottom-0", className)}>
      {children}
    </div>
  )
}

export function CaseTabs<K extends string>({ tabs, value, onChange, label }: { tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-rule bg-surface-raised px-4 lg:hidden" data-testid="case-tabs">
      {tabs.map((x) => (
        <button key={x.key} type="button" role="tab" id={`tab-${x.key}`} aria-selected={value === x.key} onClick={() => onChange(x.key)}
          className={cn("-mb-px min-h-10 shrink-0 border-b-2 px-3 whitespace-nowrap", value === x.key ? "border-orange font-medium text-ink" : "border-transparent text-steel hover:text-ink")}>
          {x.label}{x.count ? <span className="num ms-1.5 text-[11px] text-steel">{x.count}</span> : null}
        </button>
      ))}
    </div>
  )
}
/** Class for a column that is a tab pane on phones/tablets and always shown at lg. */
export const paneClass = <K extends string>(current: K, key: K) => cn(current === key ? "block" : "hidden", "lg:block")
export const paneProps = (key: string) => ({ id: `pane-${key}`, role: "tabpanel" as const, "aria-labelledby": `tab-${key}` })

/* ---------- timeline ---------- */
export interface TimelineItem { id: string | number; at: string; title: React.ReactNode; detail?: React.ReactNode; meta?: React.ReactNode; tone?: "strong" | "accent" | "muted" | "danger" }
const DOT = { strong: "bg-ink", accent: "bg-orange", muted: "bg-steel", danger: "bg-danger" } as const
const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })

export function Timeline({ items, className, ...rest }: { items: TimelineItem[] } & Omit<React.ComponentProps<"ol">, "children">) {
  let last = ""
  return (
    <ol className={cn("text-[13px]", className)} {...rest}>
      {items.map((i) => {
        const d = day.format(new Date(i.at))
        const head = d !== last
        last = d
        return (
          <li key={i.id} className="relative ps-5 pb-3 before:absolute before:inset-y-0 before:start-[4.5px] before:w-px before:bg-rule-strong last:before:bottom-auto last:before:h-3">
            {head && <p className="cap pb-1">{d}</p>}
            <span aria-hidden className={cn("absolute start-0 size-2.5 rounded-full ring-2 ring-surface-raised", DOT[i.tone ?? "muted"], head ? "top-6" : "top-1.5")} />
            <p><span className="num text-[11.5px] text-steel">{clock.format(new Date(i.at))}</span> <span className={i.tone === "strong" ? "font-medium" : ""}>{i.title}</span>{i.meta && <span className="text-steel"> · {i.meta}</span>}</p>
            {i.detail && <p className="text-steel" dir="auto">{i.detail}</p>}
          </li>
        )
      })}
    </ol>
  )
}

/* ---------- placeholders ---------- */
export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-4", className)} aria-busy aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} aria-hidden className="skeleton h-9 w-full" style={{ opacity: 1 - i * 0.1 }} />)}
    </div>
  )
}

/** Wide tables scroll sideways inside their own box instead of pushing the page wider than a phone. */
export const TableScroll = ({ children, className }: { children: React.ReactNode; className?: string }) => <div tabIndex={0} className={cn("overflow-x-auto", className)}>{children}</div>
