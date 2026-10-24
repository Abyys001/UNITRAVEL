import { CheckCircle2, Clock, CreditCard, Lock, XCircle } from "lucide-react"

import { cn } from "../lib/utils"

export type PaymentStateKind = "ready" | "processing" | "paid" | "failed" | "expired" | "closed" | "unavailable"

const LOOK: Record<PaymentStateKind, { cls: string; Icon: typeof Clock }> = {
  ready: { cls: "border-line bg-white", Icon: CreditCard },
  processing: { cls: "border-info-border bg-info-subtle text-info-subtle-fg", Icon: Clock },
  paid: { cls: "border-success/40 bg-success-subtle text-success-subtle-fg", Icon: CheckCircle2 },
  failed: { cls: "border-danger/40 bg-danger-subtle text-danger", Icon: XCircle },
  expired: { cls: "border-warning-border bg-warning-subtle text-warning-subtle-fg", Icon: Clock },
  closed: { cls: "border-warning-border bg-warning-subtle text-warning-subtle-fg", Icon: Lock },
  unavailable: { cls: "border-line bg-cloud", Icon: Lock },
}

/**
 * One message block for every payment screen state (pay page and return page). Payment success is shown only when the
 * server says the invoice is paid; "processing" never implies success (CLAUDE.md rule 3).
 */
export function PaymentState({ kind, title, body, action, className }: { kind: PaymentStateKind; title?: React.ReactNode; body: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const { cls, Icon } = LOOK[kind]
  return (
    <div role="status" data-testid="pay-state" data-state={kind} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", cls, className)}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <p>{body}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  )
}
