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
 *   <ActionMenu items onRun />                     overflow menu (destructive commands such as cancel/decline live here, in destructive colour)
 *   <SlaGauge dueAt startAt />                     large SLA ring with the countdown; overdue turns danger
 *   <StatusStepper status />                       horizontal workflow progress for a flight request
 *   <ActionBar edge>                               sticky bar for the server-computed commands (top) or a form's submit (bottom)
 *   <CaseTabs> + paneClass()                       phone/tablet tabs over the columns; all columns show side by side at lg
 *   <Timeline items />                             day-grouped vertical activity trail
 *   <ListSkeleton rows />                          table/card placeholder rows
 */
import { Check, CircleHelp, Ellipsis, Minus } from "lucide-react"
import { useEffect, useId, useState, useSyncExternalStore } from "react"

import { cn } from "@unitravel/ui/lib/utils"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@unitravel/ui/components/dropdown-menu"

import { StatusChip } from "@/components/bento"
import { COMMAND_LABEL } from "@/components/ui"
import { Button } from "@unitravel/ui/components/button"
import { COMMAND_LABEL_FA } from "@/lib/command-labels"
import { fmtClock, fmtDate, fmtDateTime } from "@/lib/format"
import { type MsgKey, statusText, type T, useT } from "@/lib/i18n"
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

const TONE_TEXT = { danger: "text-danger", warn: "text-orange-700", neutral: "text-royal", ok: "text-success" } as const

/**
 * The SLA as a ring that fills as the first-contact window is used up, with the time left (or overdue) in the middle.
 * Text is always present beside it; colour only reinforces (overdue = danger). Drawn from the same slaState as the chip.
 */
export function SlaGauge({ dueAt, startAt, breached, firstContactAt, className }: { dueAt: string | null | undefined; startAt?: string | null; breached?: boolean; firstContactAt?: string | null; className?: string }) {
  const t = useT()
  const [locale] = useLocale()
  const now = useNow() || Date.now()
  const size = 84, r = 36, c = 2 * Math.PI * r
  const state = firstContactAt ? ({ tone: "ok", used: 1, late: false, diff: 0 } as const) : dueAt ? (() => { const s = slaState(dueAt, startAt, breached, now); return { tone: s.tone, used: s.late ? 1 : Number.isFinite(s.frac) ? 1 - s.frac : 0, late: s.late, diff: s.diff } })() : null
  const tone = state?.tone ?? "neutral"
  const text = !state ? t("sla.none") : firstContactAt ? t("case.sla.made", { at: fmtDateTime(firstContactAt) }) : state.late ? t("sla.breached", { t: duration(state.diff, t, locale) }) : t("time.in", { t: duration(state.diff, t, locale) })
  return (
    <div className={cn("flex items-center gap-3", className)} data-testid="sla-gauge" data-tone={tone}>
      <div className={cn("relative shrink-0", TONE_TEXT[tone])} style={{ width: size, height: size }}>
        <svg viewBox="0 0 84 84" aria-hidden className="size-full -rotate-90 rtl:-scale-x-100">
          <circle cx="42" cy="42" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="6" />
          {state && <circle cx="42" cy="42" r={r} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${Math.max(0.02, Math.min(1, state.used)) * c} ${c}`} className="ring-in" />}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          {firstContactAt ? <Check className="size-7" aria-hidden /> : state ? <span className={cn("num px-2 text-meta leading-tight font-semibold", locale === "fa" ? "font-fa" : "")}>{duration(state.diff, t, locale)}</span> : <Minus className="size-6 text-steel" aria-hidden />}
        </div>
      </div>
      <div className="min-w-0">
        <p className="cap">{t("case.sla.title")}</p>
        <p className={cn("font-semibold", state?.late ? "text-danger" : "text-ink", locale === "fa" ? "font-fa" : "num")}>{text}</p>
        {dueAt && !firstContactAt && <p className="text-meta text-steel">{t("case.firstContact.due")} <span className="num">{fmtDateTime(dueAt)}</span></p>}
      </div>
    </div>
  )
}

/* ---------- status ---------- */
const OK = new Set(["ACCEPTED", "RESERVED", "TICKETED", "COMPLETED", "DELIVERED", "BOOKED", "VERIFIED", "RELEASED", "ALLOWED", "ACTIVE", "CONFIRMED", "PAID", "PUBLISHED", "CLEAR"])
const WARN = new Set(["NEW", "SUBMITTED", "AWAITING_CUSTOMER", "REVIEW", "PENDING_APPROVAL", "CORRECTION_REQUIRED", "ESCALATED", "HELD", "RECORDED", "IN_TRANSIT"])
const DANGER = new Set(["COMPLIANCE_HOLD", "EXCEPTION", "OPEN", "REJECTED", "PROHIBITED", "FAILED", "HIT"])
const INFO = new Set(["QUOTED", "SENT", "ISSUED", "IN_REVIEW", "RECEIVED"])
export const statusTone = (status: string): "ok" | "warn" | "danger" | "info" | "neutral" => (OK.has(status) ? "ok" : DANGER.has(status) ? "danger" : WARN.has(status) ? "warn" : INFO.has(status) ? "info" : "neutral")

/** Workflow status as a chip. The DOM text is the status itself (tests and screen readers); CSS only softens the casing. */
export function StateChip({ value, className }: { value: string; className?: string }) {
  const t = useT()
  return <StatusChip tone={statusTone(value)} className={className}><span className="inline-block lowercase first-letter:uppercase">{statusText(t, value)}</span></StatusChip>
}

const STEPS: { status: string; label: MsgKey }[] = [
  { status: "NEW", label: "case.step.new" }, { status: "IN_REVIEW", label: "case.step.review" }, { status: "QUOTED", label: "case.step.quoted" }, { status: "ACCEPTED", label: "case.step.accepted" },
  { status: "RESERVED", label: "case.step.reserved" }, { status: "TICKETED", label: "case.step.ticketed" }, { status: "COMPLETED", label: "case.step.completed" },
]
const ENDED = new Set(["DECLINED", "CANCELLED", "EXPIRED"])
/** Where a flight request sits on the happy path. Waiting states stay on the step they interrupt; ended ones show no progress. */
function stepOf(status: string): { index: number; tone: "ok" | "warn" | "danger" | "info"; note?: MsgKey } {
  switch (status) {
    case "SUBMITTED": return { index: 0, tone: "info" }
    case "COMPLIANCE_HOLD": return { index: 0, tone: "danger", note: "case.step.hold" }
    case "AWAITING_CUSTOMER": return { index: 1, tone: "warn", note: "case.step.awaiting" }
    default: { const i = STEPS.findIndex((x) => x.status === status); return { index: i < 0 ? 0 : i, tone: i === STEPS.length - 1 ? "ok" : "info" } }
  }
}
const STEP_TONE = { ok: "border-success bg-success text-white", warn: "border-orange bg-orange text-navy-950", danger: "border-danger bg-danger text-white", info: "border-royal bg-royal text-white" } as const

/**
 * Horizontal workflow progress. Labels are positioned under their dot (absolutely, so a long label never changes the
 * spacing); every label shows from sm up, on phones only the current one, so seven steps fit 360 px. The first and last
 * labels align to the row's edges instead of centring, so they cannot spill past the page margin.
 */
export function StatusStepper({ status, className }: { status: string; className?: string }) {
  const t = useT()
  const ended = ENDED.has(status)
  const cur = stepOf(status)
  const last = STEPS.length - 1
  return (
    <ol aria-label={t("case.steps")} className={cn("flex items-start pb-12", className)} data-testid="status-stepper">
      {STEPS.map((x, i) => {
        const done = !ended && i < cur.index, here = !ended && i === cur.index
        return (
          <li key={x.status} aria-current={here ? "step" : undefined} className={cn("flex items-start", i < last && "flex-1")}>
            <span className="relative block size-6 shrink-0">
              <span className={cn("grid size-6 place-items-center rounded-full border-2 text-2xs font-bold", done ? "border-royal bg-royal text-white" : here ? STEP_TONE[cur.tone] : "border-rule-strong bg-surface-raised text-steel")}>
                {done ? <Check className="size-3.5" aria-hidden /> : <span className="num">{i + 1}</span>}
              </span>
              {here && cur.tone !== "ok" && <span aria-hidden className="absolute -inset-1 rounded-full ring-2 ring-current opacity-30" />}
              <span className={cn("absolute top-full mt-1.5 w-max max-w-[7.5rem] text-caption leading-tight", i === 0 ? "start-0 text-start" : i === last ? "end-0 text-end" : "left-1/2 -translate-x-1/2 text-center", here ? "font-semibold text-ink" : "text-steel max-sm:sr-only")}>
                {t(x.label)}{here && cur.note && <span className="block font-normal text-steel">{t(cur.note)}</span>}
              </span>
            </span>
            {i < last && <span aria-hidden className={cn("mx-1.5 mt-[0.7rem] h-0.5 min-w-2 flex-1 rounded-full", done ? "bg-royal/70" : "bg-rule-strong")} />}
          </li>
        )
      })}
      {ended && <li className="ms-3 flex shrink-0 items-center self-start"><StateChip value={status} /></li>}
    </ol>
  )
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

const BADGE = {
  ok: "border-success-border bg-success-subtle text-success-subtle-fg", neutral: "border-rule-strong bg-surface-sunk text-steel", danger: "border-danger/40 bg-danger-subtle text-danger",
} as const

export function TruthTally({ tally, className, compact, badges }: { tally: Tally; className?: string; compact?: boolean; badges?: boolean }) {
  const t = useT()
  if (badges) {
    // Tri-state badges: icon + word + count, so known / not included / UNKNOWN never rely on colour. UNKNOWN > 0 is the loud one.
    const badge = (k: MsgKey, n: number, tone: keyof typeof BADGE, icon: React.ReactNode) => (
      <div className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-meta", BADGE[tone])}><span aria-hidden className="[&_svg]:size-3.5">{icon}</span><dt className="font-medium">{t(k)}</dt><dd className="num font-bold">{n}</dd></div>
    )
    return (
      <dl className={cn("flex flex-wrap gap-1.5", className)} data-testid="truth-tally">
        {badge("case.truth.known", tally.known, "ok", <Check />)}{badge("case.truth.notIncluded", tally.notIncluded, "neutral", <Minus />)}{badge("case.truth.unknown", tally.unknown, tally.unknown > 0 ? "danger" : "neutral", <CircleHelp />)}
      </dl>
    )
  }
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
/** Commands that end the case: kept out of the main row, in an overflow menu with destructive styling (they still open their confirm dialog). */
export const DESTRUCTIVE = new Set(["cancel", "decline"])
export const pickPrimary = (allowed: AllowedCommand[]) => NEXT_STEP.map((c) => allowed.find((a) => a.command === c)).find(Boolean) ?? allowed.find((a) => !COOL.has(a.command))
export const commandLabelOf = (c: string, locale: Locale) => (locale === "fa" ? COMMAND_LABEL_FA[c] : undefined) ?? COMMAND_LABEL[c] ?? c

/**
 * Overflow menu for commands. Allowed destructive ones are grouped at the bottom in destructive colour; disabled items
 * carry the server's reason. Choosing one calls onRun, which opens the same confirm dialog as a button would.
 */
export function ActionMenu({ items, onRun, className }: { items: AllowedCommand[]; onRun: (command: string) => void; className?: string }) {
  const t = useT()
  const [locale] = useLocale()
  if (!items.length) return null
  const danger = items.filter((a) => DESTRUCTIVE.has(a.command)), rest = items.filter((a) => !DESTRUCTIVE.has(a.command))
  const row = (a: AllowedCommand) => (
    <DropdownMenuItem key={a.command} variant={DESTRUCTIVE.has(a.command) ? "destructive" : "default"} disabled={!a.allowed} onClick={() => onRun(a.command)} data-command={a.command} className="min-h-9 flex-wrap pointer-coarse:min-h-11">
      <span>{commandLabelOf(a.command, locale)}</span>{!a.allowed && a.reason && <span className="basis-full text-caption font-normal text-steel">{a.reason}</span>}
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t("case.more")} data-testid="actions-more" className={cn("inline-flex size-control shrink-0 items-center justify-center rounded-lg border border-control bg-surface-raised text-ink hover:bg-hover pointer-coarse:size-11 data-popup-open:bg-hover", className)}><Ellipsis className="size-4" aria-hidden /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56 max-w-[min(20rem,calc(100vw-2rem))]">
        {rest.map(row)}
        {danger.length > 0 && rest.length > 0 && <DropdownMenuSeparator />}
        {danger.length > 0 && <DropdownMenuGroup><DropdownMenuLabel className="text-danger">{t("case.cmd.danger")}</DropdownMenuLabel>{danger.map(row)}</DropdownMenuGroup>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
  const label = (c: string) => commandLabelOf(c, locale)
  const allowed = actions.filter((a) => a.allowed), blocked = actions.filter((a) => !a.allowed)
  const primary = pickPrimary(allowed)
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
/**
 * Tabs inside a card, at every width (CaseTabs is the phone/tablet switcher over whole columns). Panels stay mounted and
 * are hidden by the caller (`hidden={value !== key}`) so a half-written note survives a tab change. Ids: `{id}-tab-{key}`, `{id}-pane-{key}`.
 */
export function PanelTabs<K extends string>({ id, tabs, value, onChange, label }: { id: string; tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void; label: string }) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((x) => x.key === value)
    const rtl = document.documentElement.dir === "rtl"
    const next = e.key === "ArrowRight" ? i + (rtl ? -1 : 1) : e.key === "ArrowLeft" ? i + (rtl ? 1 : -1) : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null
    if (next === null) return
    e.preventDefault()
    const to = tabs[(next + tabs.length) % tabs.length]!
    onChange(to.key)
    document.getElementById(`${id}-tab-${to.key}`)?.focus()
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="-mt-1 flex gap-1 overflow-x-auto border-b border-rule">
      {tabs.map((x) => (
        <button key={x.key} type="button" role="tab" id={`${id}-tab-${x.key}`} aria-selected={value === x.key} aria-controls={`${id}-pane-${x.key}`} tabIndex={value === x.key ? 0 : -1} onClick={() => onChange(x.key)}
          className={cn("-mb-px min-h-10 shrink-0 border-b-2 px-3 whitespace-nowrap transition-colors pointer-coarse:min-h-11", value === x.key ? "border-[var(--indicator)] font-semibold text-ink" : "border-transparent text-steel hover:text-ink")}>
          {x.label}{x.count ? <span className="num ms-1.5 rounded-full bg-surface-sunk px-1.5 text-2xs leading-5 text-steel ring-1 ring-rule">{x.count}</span> : null}
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

export function Timeline({ items, className, ...rest }: { items: TimelineItem[] } & Omit<React.ComponentProps<"ol">, "children">) {
  let last = ""
  return (
    <ol className={cn("text-body", className)} {...rest}>
      {items.map((i) => {
        const d = fmtDate(i.at)
        const head = d !== last
        last = d
        return (
          <li key={i.id} className="relative ps-5 pb-3 before:absolute before:inset-y-0 before:start-[4.5px] before:w-px before:bg-rule-strong last:before:bottom-auto last:before:h-3">
            {head && <p className="cap pb-1">{d}</p>}
            <span aria-hidden className={cn("absolute start-0 size-2.5 rounded-full ring-2 ring-surface-raised", DOT[i.tone ?? "muted"], head ? "top-6" : "top-1.5")} />
            <p><span className="num text-caption text-steel">{fmtClock(i.at)}</span> <span className={i.tone === "strong" ? "font-medium" : ""}>{i.title}</span>{i.meta && <span className="text-steel"> · {i.meta}</span>}</p>
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
