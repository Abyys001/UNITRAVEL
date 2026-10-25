"use client"

/**
 * Case-page primitives for the Control deck (Phase 2, docs/design/DESIGN.md "Control deck"). Built on bento.tsx and the
 * semantic tokens, so light/dark, density and RTL behave like the dashboard.
 *
 *   <CaseHeader reference title meta aside />      title strip: reference, route/subject, one meta line, right slot
 *   <SlaChip dueAt startAt breached done />        countdown ring + relative time; text always present, ticks every 30 s
 *   <StateChip value />                            workflow status as a StatusChip (tone from the status, text = the status)
 *   <TruthTally tally />                           known / not included / UNKNOWN counts; UNKNOWN is never softened
 *   <CommandBar actions onRun />                   server-computed commands: one solid primary, the rest secondary, unavailable ones listed with their reason
 *   <ActionBar edge>                               sticky bar for the server-computed commands (top) or a form's submit (bottom)
 *   <CaseTabs> + paneClass()                       phone/tablet tabs over the columns; all columns show side by side at lg
 *   <Timeline items />                             day-grouped vertical activity trail
 *   <ListSkeleton rows />                          table/card placeholder rows
 */
import { useEffect, useId, useState, useSyncExternalStore } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { StatusChip } from "@/components/bento"
import { COMMAND_LABEL } from "@/components/ui"
import { Button } from "@unitravel/ui/components/button"
import { COMMAND_LABEL_FA } from "@/lib/command-labels"
import { type MsgKey, type T, useT } from "@/lib/i18n"
import { type Locale, useLocale } from "@/lib/prefs"
import type { AllowedCommand, StaffQuoteOption } from "@/lib/types"

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

const faDigits = new Intl.NumberFormat("fa-IR")
export function duration(ms: number, t: T, locale: Locale = "en"): string {
  const m = Math.round(Math.abs(ms) / 60000)
  const n = (x: number) => (locale === "fa" ? faDigits.format(x) : String(x))
  // English reads "2d 6h"; Persian keeps the unit as a separate word ("۲ روز ۶ ساعت").
  const u = (x: number, unit: string) => (locale === "fa" ? `${n(x)} ${unit}` : `${n(x)}${unit}`)
  const d = t("time.d"), h = t("time.h"), mm = t("time.m")
  return m >= 1440 ? `${u(Math.floor(m / 1440), d)} ${u(Math.floor((m % 1440) / 60), h)}` : m >= 60 ? `${u(Math.floor(m / 60), h)} ${u(m % 60, mm)}` : u(m, mm)
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
  const [locale] = useLocale()
  const now = useNow() || Date.now()
  if (done) return <StatusChip tone="ok" className={className}>{t("sla.done")}</StatusChip>
  if (!dueAt) return <span className="text-steel">—</span>
  const s = slaState(dueAt, startAt, breached, now)
  const text = s.late ? t("sla.breached", { t: duration(s.diff, t, locale) }) : t("time.in", { t: duration(s.diff, t, locale) })
  return <StatusChip tone={s.tone} className={cn(locale === "fa" ? "font-fa" : "num", "max-sm:whitespace-normal", className)} icon={<SlaRing frac={s.frac} className="size-3.5" />}>{text}</StatusChip>
}

/* ---------- status ---------- */
const OK = new Set(["ACCEPTED", "RESERVED", "TICKETED", "COMPLETED", "DELIVERED", "BOOKED", "VERIFIED", "RELEASED", "ALLOWED", "ACTIVE", "CONFIRMED", "PAID", "PUBLISHED", "CLEAR"])
const WARN = new Set(["NEW", "SUBMITTED", "AWAITING_CUSTOMER", "REVIEW", "PENDING_APPROVAL", "CORRECTION_REQUIRED", "ESCALATED", "HELD", "RECORDED", "IN_TRANSIT"])
const DANGER = new Set(["COMPLIANCE_HOLD", "EXCEPTION", "OPEN", "REJECTED", "PROHIBITED", "FAILED", "HIT"])
const INFO = new Set(["QUOTED", "SENT", "ISSUED", "IN_REVIEW", "RECEIVED"])
export const statusTone = (status: string): "ok" | "warn" | "danger" | "info" | "neutral" => (OK.has(status) ? "ok" : DANGER.has(status) ? "danger" : WARN.has(status) ? "warn" : INFO.has(status) ? "info" : "neutral")

/** Workflow status as a chip. The DOM text is the status itself (tests and screen readers); CSS only softens the casing. */
export function StateChip({ value, className }: { value: string; className?: string }) {
  return <StatusChip tone={statusTone(value)} className={className}><span className="inline-block lowercase first-letter:uppercase">{value.replace(/_/g, " ")}</span></StatusChip>
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

export function TruthTally({ tally, className, compact }: { tally: Tally; className?: string; compact?: boolean }) {
  const t = useT()
  if (compact) {
    const item = (k: MsgKey, n: number, bad?: boolean) => <div className="flex items-baseline gap-1"><dt className="text-steel">{t(k)}</dt><dd className={cn("num font-semibold", bad ? "text-danger" : "text-ink")}>{n}</dd></div>
    return (
      <dl className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-0.5", className)} data-testid="truth-tally">
        {item("case.truth.known", tally.known)}{item("case.truth.notIncluded", tally.notIncluded)}{item("case.truth.unknown", tally.unknown, tally.unknown > 0)}
      </dl>
    )
  }
  const cell = (k: MsgKey, n: number, cls: string) => (
    <div><dt className="cap">{t(k)}</dt><dd className={cn("num text-title leading-tight font-semibold", cls)}>{n}</dd></div>
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
/** `summary` is the second line (state, SLA, owner, facts); it carries data-testid="case-summary" like the old tile row. */
export function CaseHeader({ reference, title, meta, aside, summary }: { reference: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; aside?: React.ReactNode; summary?: React.ReactNode }) {
  return (
    <header className="border-b border-rule bg-surface-raised px-5 pt-5 pb-4 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-3">{reference}<span className="font-display text-title leading-tight font-bold" dir="auto">{title}</span></p>
          {meta && <p className="mt-1 text-steel">{meta}</p>}
        </div>
        {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
      {summary && <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule pt-3" data-testid="case-summary">{summary}</div>}
    </header>
  )
}

/** A labelled fact in the header summary line. */
export const SummaryItem = ({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}><span className="cap">{label}</span>{children}</div>
)

// Presentation order only: which allowed command is the usual next step. Whether a command is allowed is the server's call.
const NEXT_STEP = ["claim", "send_quote", "record_acceptance", "record_reservation", "record_tickets", "receive", "record_booking", "request_info", "assign"]
const COOL = new Set(["cancel", "decline", "close", "reject"])

/**
 * Commands as the server computed them. The first allowed next step is solid, other allowed ones are outlined, and the
 * ones that cannot run now sit in a collapsed disclosure (an opened one is remembered) with the server's reason beside each.
 */
export function CommandBar({ actions, onRun, none, hint }: { actions: AllowedCommand[]; onRun: (command: string) => void; none: React.ReactNode; hint?: React.ReactNode }) {
  const t = useT()
  const [locale] = useLocale()
  const [open, setOpen] = useState(false)
  const id = useId()
  useEffect(() => { try { if (localStorage.getItem("ut-cmd-more") === "1") setOpen(true) } catch { /* storage blocked: stay collapsed */ } }, [])
  const label = (c: string) => (locale === "fa" ? COMMAND_LABEL_FA[c] : undefined) ?? COMMAND_LABEL[c] ?? c
  const allowed = actions.filter((a) => a.allowed), blocked = actions.filter((a) => !a.allowed)
  const primary = NEXT_STEP.map((c) => allowed.find((a) => a.command === c)).find(Boolean) ?? allowed.find((a) => !COOL.has(a.command))
  return (
    <div>
      <div role="group" aria-label={t("case.actions")} className="flex flex-wrap items-center gap-2">
        {allowed.map((a) => <Button key={a.command} size="sm" variant={a === primary ? "default" : "outline"} className={a === primary ? "px-4" : undefined} onClick={() => onRun(a.command)} data-command={a.command}>{label(a.command)}</Button>)}
        {!actions.length && <p className="py-1 text-steel">{none}</p>}
        {hint && <p className="ms-auto hidden shrink-0 text-caption text-steel xl:block pointer-coarse:hidden">{hint}</p>}
      </div>
      {blocked.length > 0 && (
        <div className="mt-2">
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => { setOpen(!open); try { localStorage.setItem("ut-cmd-more", open ? "0" : "1") } catch { /* preference only */ } }} className="-ms-1 flex min-h-7 items-center gap-1 rounded-sm px-1 text-meta text-steel hover:text-ink">
            <span aria-hidden className={cn("inline-block transition-transform rtl:-scale-x-100", open && "rotate-90")}>›</span>{t("case.cmd.unavailable", { n: blocked.length })}
          </button>
          <ul id={id} className={cn("mt-1 grid gap-x-6 gap-y-2 sm:grid-cols-2 2xl:grid-cols-3", !open && "hidden")}>
            {blocked.map((a) => (
              <li key={a.command} className="flex min-w-0 items-start gap-2">
                <Button size="xs" variant="outline" disabled data-command={a.command} aria-describedby={a.reason ? `${id}-${a.command}` : undefined} className="shrink-0">{label(a.command)}</Button>
                {a.reason && <p id={`${id}-${a.command}`} className="pt-0.5 text-meta leading-snug text-steel" data-reason={a.command}>{a.reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Sticky strip inside <main> (the shell's only scroller, so offsets are relative to it, not the window): `top` pins the
 * server-computed case commands to the top edge; `bottom` docks a form's submit above the phone tab bar (main's padding).
 */
export function ActionBar({ edge = "top", className, children, ...rest }: React.ComponentProps<"div"> & { edge?: "top" | "bottom" }) {
  return (
    <div {...rest} className={cn("z-sticky bg-surface-raised px-5 py-2.5 md:px-6", edge === "top" ? "sticky top-0 border-b border-rule" : "sticky bottom-0 border-t border-rule shadow-[0_-8px_16px_-12px_rgb(11_27_51/0.25)]", className)}>
      {children}
    </div>
  )
}

export function CaseTabs<K extends string>({ tabs, value, onChange, label }: { tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void; label: string }) {
  // Roving tabindex: only the selected tab is in the Tab order; arrows (mirrored in RTL), Home and End move and select.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((x) => x.key === value)
    const rtl = document.documentElement.dir === "rtl"
    const next = e.key === "ArrowRight" ? i + (rtl ? -1 : 1) : e.key === "ArrowLeft" ? i + (rtl ? 1 : -1) : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null
    if (next === null) return
    e.preventDefault()
    const to = tabs[(next + tabs.length) % tabs.length]!
    onChange(to.key)
    e.currentTarget.querySelector<HTMLElement>(`[id="tab-${to.key}"]`)?.focus()
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-rule bg-surface-raised px-4 lg:hidden" data-testid="case-tabs">
      {tabs.map((x) => (
        <button key={x.key} type="button" role="tab" id={`tab-${x.key}`} aria-selected={value === x.key} aria-controls={`pane-${x.key}`} tabIndex={value === x.key ? 0 : -1} onClick={() => onChange(x.key)}
          className={cn("-mb-px min-h-11 shrink-0 border-b-2 px-3 whitespace-nowrap transition-colors", value === x.key ? "border-[var(--indicator)] font-semibold text-ink" : "border-transparent text-steel hover:text-ink")}>
          {x.label}{x.count ? <span className="num ms-1.5 text-caption text-steel">{x.count}</span> : null}
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
    <ol className={cn("text-body", className)} {...rest}>
      {items.map((i) => {
        const d = day.format(new Date(i.at))
        const head = d !== last
        last = d
        return (
          <li key={i.id} className="relative ps-5 pb-3 before:absolute before:inset-y-0 before:start-[4.5px] before:w-px before:bg-rule-strong last:before:bottom-auto last:before:h-3">
            {head && <p className="cap pb-1">{d}</p>}
            <span aria-hidden className={cn("absolute start-0 size-2.5 rounded-full ring-2 ring-surface-raised", DOT[i.tone ?? "muted"], head ? "top-6" : "top-1.5")} />
            <p><span className="num text-caption text-steel">{clock.format(new Date(i.at))}</span> <span className={i.tone === "strong" ? "font-medium" : ""}>{i.title}</span>{i.meta && <span className="text-steel"> · {i.meta}</span>}</p>
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
      {Array.from({ length: rows }, (_, i) => <div key={i} aria-hidden className="skeleton h-10 w-full" style={{ opacity: 1 - i * 0.1 }} />)}
    </div>
  )
}

/**
 * Wide tables scroll sideways inside their own box instead of pushing the page wider than a phone. Inside a bounded
 * <ListCard fill> it is also the vertical scroller, so `.data-table` headers stick to its top edge.
 */
export const TableScroll = ({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) => <div tabIndex={0} role="region" aria-label={label ?? "Table"} className={cn("grid-scroll min-h-0 flex-1 focus-visible:outline-offset-[-2px]", className)}>{children}</div>
