import { BadgeCheck, CircleDashed, Clock, FilePenLine, XCircle } from "lucide-react"

import { cn } from "../lib/utils"

export type VerificationState = "UNVERIFIED" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "CORRECTION_REQUIRED"

const LOOK: Record<VerificationState, { cls: string; Icon: typeof BadgeCheck }> = {
  VERIFIED: { cls: "border-success bg-success-subtle text-success-subtle-fg", Icon: BadgeCheck },
  SUBMITTED: { cls: "border-info-border bg-info-subtle text-info-subtle-fg", Icon: Clock },
  CORRECTION_REQUIRED: { cls: "border-warning-border bg-warning-subtle text-warning-subtle-fg", Icon: FilePenLine },
  REJECTED: { cls: "border-danger bg-danger-subtle text-danger", Icon: XCircle },
  UNVERIFIED: { cls: "border-line bg-cloud text-steel", Icon: CircleDashed },
}

/** Identity verification state (Phase B). The state is always written out in `label`; icon and colour only reinforce it. */
export function VerificationBadge({ status, label, className }: { status: VerificationState; label: string; className?: string }) {
  const { cls, Icon } = LOOK[status]
  return (
    <span data-testid="verification-badge" data-status={status} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", cls, className)}>
      <Icon aria-hidden className="size-3" />{label}
    </span>
  )
}
