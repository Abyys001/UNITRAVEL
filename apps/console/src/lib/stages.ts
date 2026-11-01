import type { MsgKey } from "@/lib/i18n"

/** Open stages in workflow order; colours follow the stage (waiting, working, with the customer, committed). Shared by the dashboard and the queue insights. */
export const STAGES: { status: string; label: MsgKey; color: string }[] = [
  { status: "NEW", label: "home.stage.new", color: "var(--viz-2)" },
  { status: "IN_REVIEW", label: "home.stage.review", color: "var(--viz-1)" },
  { status: "AWAITING_CUSTOMER", label: "home.stage.awaiting", color: "var(--viz-3)" },
  { status: "QUOTED", label: "home.stage.quoted", color: "var(--viz-5)" },
  { status: "ACCEPTED", label: "home.stage.accepted", color: "var(--viz-4)" },
  { status: "RESERVED", label: "home.stage.reserved", color: "color-mix(in oklab, var(--viz-4) 55%, var(--surface-raised))" },
  { status: "COMPLIANCE_HOLD", label: "home.stage.hold", color: "var(--viz-6)" },
  { status: "SUBMITTED", label: "home.stage.screening", color: "var(--ink-subtle)" },
]
