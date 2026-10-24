import { cn } from "../lib/utils"

/** Status chips for the staff consoles: dense mono tags. Unknown statuses fall back to a neutral outline; text always carries the meaning. */
const TONE: Record<string, string> = {
  NEW: "border-orange text-orange-700 bg-warning-subtle", SUBMITTED: "border-steel/40 text-steel", IN_REVIEW: "border-ink/30 text-ink bg-surface-raised",
  AWAITING_CUSTOMER: "border-warning-border text-warning-subtle-fg bg-warning-subtle", QUOTED: "border-info-border text-info-subtle-fg bg-info-subtle",
  ACCEPTED: "border-success-border text-success-subtle-fg bg-success-subtle", RESERVED: "border-success text-success bg-success-subtle", TICKETED: "border-success bg-success text-white dark:text-navy-950",
  COMPLETED: "border-success/40 text-success", DELIVERED: "border-success bg-success text-white dark:text-navy-950", BOOKED: "border-success text-success bg-success-subtle",
  COMPLIANCE_HOLD: "border-danger text-danger bg-danger-subtle", EXCEPTION: "border-danger text-danger bg-danger-subtle", DECLINED: "border-steel/40 text-steel line-through",
  CANCELLED: "border-steel/40 text-steel line-through", EXPIRED: "border-steel/40 text-steel", OPEN: "border-danger text-danger bg-danger-subtle", ESCALATED: "border-orange text-orange-700",
  RELEASED: "border-success/50 text-success", ALLOWED: "border-success/50 text-success", REVIEW: "border-warning-border text-warning-subtle-fg bg-warning-subtle", PROHIBITED: "border-danger bg-danger text-white dark:text-navy-950",
  DRAFT: "border-dashed border-steel/50 text-steel", SENT: "border-info-border text-info-subtle-fg bg-info-subtle", SUPERSEDED: "border-steel/30 text-steel/70",
  PENDING_APPROVAL: "border-orange text-orange-700 bg-warning-subtle", ACTIVE: "border-success/50 text-success", RETIRED: "border-steel/30 text-steel/70",
  RECORDED: "border-orange text-orange-700", VERIFIED: "border-success text-success", HELD: "border-orange text-orange-700", CONFIRMED: "border-success text-success",
  REJECTED: "border-danger text-danger bg-danger-subtle", CORRECTION_REQUIRED: "border-warning-border text-warning-subtle-fg bg-warning-subtle",
  ISSUED: "border-info-border text-info-subtle-fg bg-info-subtle", PAID: "border-success bg-success text-white dark:text-navy-950", REFUNDED: "border-steel/40 text-steel", PUBLISHED: "border-success bg-success text-white dark:text-navy-950", FAILED: "border-danger text-danger", MANUAL: "border-orange bg-orange/15 text-orange-700",
}
export function Tag({ value, className, title }: { value: string; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-flex items-center rounded-[4px] border px-1.5 py-px font-mono text-[10.5px] leading-4 tracking-wide whitespace-nowrap uppercase", TONE[value] ?? "border-rule-strong text-steel", className)}>{value.replace(/_/g, " ")}</span>
}

/** A ruled section of a case page. */
export function Panel({ title, aside, children, className, id }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("border-t border-rule pt-2.5 pb-4", className)}>
      <header className="mb-2 flex items-center justify-between gap-2"><h2 className="cap">{title}</h2>{aside}</header>
      {children}
    </section>
  )
}

export function PageHead({ title, kicker, children }: { title: React.ReactNode; kicker?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-rule bg-surface-raised px-5 pt-4 pb-3">
      <div className="min-w-0">
        {kicker && <p className="cap">{kicker}</p>}
        <h1 className="font-display text-[22px] leading-tight">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/** Compact labelled control for dense forms (the web's roomier fields use components/field). */
export function LedgerField({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="cap">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-0.5 block text-[11px] text-steel">{hint}</span>}
    </label>
  )
}

/** Free text of unknown direction (names, addresses) isolates itself from the surrounding layout direction. */
export const Bidi = ({ children, className }: { children: React.ReactNode; className?: string }) => <span dir="auto" className={className}>{children}</span>
