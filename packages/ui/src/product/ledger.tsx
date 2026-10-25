import { cn } from "../lib/utils"

/** Status chips for the staff consoles: dense mono tags. Unknown statuses fall back to a neutral outline; text always carries the meaning. */
const OK = "border-success-border bg-success-subtle text-success-subtle-fg"
const OK_SOLID = "border-success bg-success text-white dark:text-[#0b1220]"
const WARN = "border-warning-border bg-warning-subtle text-warning-subtle-fg"
const INFO = "border-info-border bg-info-subtle text-info-subtle-fg"
const BAD = "border-danger/30 bg-danger-subtle text-danger"
const QUIET = "border-rule-strong bg-surface-sunk text-steel"
/** Status chips for the staff consoles: one tone per meaning (ok / warn / info / risk / quiet); unknown statuses stay quiet. Text always carries the meaning. */
const TONE: Record<string, string> = {
  NEW: WARN, SUBMITTED: QUIET, IN_REVIEW: INFO, AWAITING_CUSTOMER: WARN, QUOTED: INFO, ACCEPTED: OK, RESERVED: OK, TICKETED: OK_SOLID,
  COMPLETED: OK, DELIVERED: OK_SOLID, BOOKED: OK, COMPLIANCE_HOLD: BAD, EXCEPTION: BAD, DECLINED: `${QUIET} line-through`, CANCELLED: `${QUIET} line-through`,
  EXPIRED: QUIET, OPEN: BAD, ESCALATED: WARN, RELEASED: OK, ALLOWED: OK, REVIEW: WARN, PROHIBITED: "border-danger bg-danger text-white dark:text-[#0b1220]",
  DRAFT: "border-dashed border-rule-strong text-steel", SENT: INFO, SUPERSEDED: QUIET, PENDING_APPROVAL: WARN, ACTIVE: OK, RETIRED: QUIET,
  RECORDED: WARN, VERIFIED: OK, HELD: WARN, CONFIRMED: OK, REJECTED: BAD, CORRECTION_REQUIRED: WARN, ISSUED: INFO, PAID: OK_SOLID, REFUNDED: QUIET,
  PUBLISHED: OK_SOLID, FAILED: BAD, MANUAL: WARN, BLOCK: BAD, ALLOW: OK,
}
export function Tag({ value, className, title }: { value: string; className?: string; title?: string }) {
  // DOM text stays the status itself (tests, screen readers); CSS only sets sentence case.
  return <span title={title} className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-caption font-medium whitespace-nowrap", TONE[value] ?? QUIET, className)}><span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-80" /><span className="lowercase first-letter:uppercase">{value.replace(/_/g, " ")}</span></span>
}

/** A ruled section of a case page. */
export function Panel({ title, aside, children, className, id }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("border-t border-rule pt-4 pb-5", className)}>
      <header className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lead font-semibold text-ink">{title}</h2>{aside}</header>
      {children}
    </section>
  )
}

export function PageHead({ title, kicker, children }: { title: React.ReactNode; kicker?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-4 pt-6 pb-4 md:px-6">
      <div className="min-w-0">
        {kicker && <p className="mb-1.5 text-meta text-steel">{kicker}</p>}
        <h1 className="font-display text-title leading-tight font-bold tracking-[-0.01em] text-ink">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/** Compact labelled control for dense forms (the web's roomier fields use components/field). */
export function LedgerField({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="block text-meta font-medium text-ink">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint && <span className="mt-1 block text-caption text-steel">{hint}</span>}
    </label>
  )
}

/** Free text of unknown direction (names, addresses) isolates itself from the surrounding layout direction. */
export const Bidi = ({ children, className }: { children: React.ReactNode; className?: string }) => <span dir="auto" className={className}>{children}</span>
