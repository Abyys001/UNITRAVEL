"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button, type ButtonProps } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { errText } from "@/lib/api"
import type { AllowedCommand } from "@/lib/types"

const TONE: Record<string, string> = {
  NEW: "border-copper text-copper-700 bg-[#fbf3ea]", SUBMITTED: "border-slate/40 text-slate", IN_REVIEW: "border-ink/30 text-ink bg-white",
  AWAITING_CUSTOMER: "border-[#e3c49c] text-[#7a4d22] bg-[#f6ead9]", QUOTED: "border-[#bccbdd] text-[#1f3a5c] bg-[#e6ecf3]",
  ACCEPTED: "border-[#b9d3c1] text-[#2c5139] bg-[#e4efe7]", RESERVED: "border-moss text-moss bg-[#e4efe7]", TICKETED: "border-moss bg-moss text-paper",
  COMPLETED: "border-moss/40 text-moss", DELIVERED: "border-moss bg-moss text-paper", BOOKED: "border-moss text-moss bg-[#e4efe7]",
  COMPLIANCE_HOLD: "border-brick text-brick bg-[#fbeee9]", EXCEPTION: "border-brick text-brick bg-[#fbeee9]", DECLINED: "border-slate/40 text-slate line-through",
  CANCELLED: "border-slate/40 text-slate line-through", EXPIRED: "border-slate/40 text-slate", OPEN: "border-brick text-brick bg-[#fbeee9]", ESCALATED: "border-copper text-copper-700",
  RELEASED: "border-moss/50 text-moss", ALLOWED: "border-moss/50 text-moss", REVIEW: "border-[#e3c49c] text-[#7a4d22] bg-[#f6ead9]", PROHIBITED: "border-brick bg-brick text-paper",
  DRAFT: "border-dashed border-slate/50 text-slate", SENT: "border-[#bccbdd] text-[#1f3a5c] bg-[#e6ecf3]", SUPERSEDED: "border-slate/30 text-slate/70",
  PENDING_APPROVAL: "border-copper text-copper-700 bg-[#fbf3ea]", ACTIVE: "border-moss/50 text-moss", RETIRED: "border-slate/30 text-slate/70",
  RECORDED: "border-copper text-copper-700", VERIFIED: "border-moss text-moss", HELD: "border-copper text-copper-700", CONFIRMED: "border-moss text-moss",
  ISSUED: "border-moss text-moss", PUBLISHED: "border-moss bg-moss text-paper", FAILED: "border-brick text-brick", MANUAL: "border-copper bg-copper/15 text-copper-700",
}
export function Tag({ value, className, title }: { value: string; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-flex items-center rounded-[4px] border px-1.5 py-px font-mono text-[10.5px] leading-4 tracking-wide whitespace-nowrap uppercase", TONE[value] ?? "border-rule-strong text-slate", className)}>{value.replace(/_/g, " ")}</span>
}

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
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-rule bg-paper px-5 pt-4 pb-3">
      <div className="min-w-0">
        {kicker && <p className="cap">{kicker}</p>}
        <h1 className="font-display text-[22px] leading-tight">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="cap">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-0.5 block text-[11px] text-slate">{hint}</span>}
    </label>
  )
}

export const ErrorLine = ({ error }: { error: unknown }) => (error ? <p role="alert" className="rounded-sm bg-[#fbeee9] px-2 py-1.5 text-brick">{errText(error)}</p> : null)
export const Loading = ({ label = "Loading…" }: { label?: string }) => <p className="p-5 text-slate" aria-busy>{label}</p>
export const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-3 text-slate italic">{children}</p>

export const COMMAND_LABEL: Record<string, string> = {
  claim: "Claim", assign: "Assign…", request_info: "Request info…", send_quote: "Send quote…", record_acceptance: "Record acceptance…",
  record_reservation: "Record reservation…", record_tickets: "Record tickets…", close: "Close", reopen: "Reopen", cancel: "Cancel…", decline: "Decline…",
  record_booking: "Record partner booking…", schedule_handover: "Schedule handover…", receive: "Receive & re-weigh…", depart: "Departed…",
  arrive_customs: "At customs…", clear_customs: "Cleared customs…", out_for_delivery: "Out for delivery…", deliver: "Delivered…",
  raise_exception: "Raise exception…", resolve_exception: "Resolve exception…", mark_reservation_lapsed: "Mark reservation lapsed…",
}

/** A server-computed command: enabled when the guard passes, otherwise disabled with the guard's reason shown. */
export function CommandButton({ action, onRun, variant = "outline", label, className, ...rest }: { action: AllowedCommand | undefined; onRun: () => void; label?: string } & Omit<ButtonProps, "onClick" | "action">) {
  if (!action) return null
  return (
    <div className={cn("space-y-0.5", className)}>
      <Button size="sm" variant={action.allowed ? variant : "outline"} className="w-full justify-start" disabled={!action.allowed} onClick={onRun} data-command={action.command} {...rest}>
        {label ?? COMMAND_LABEL[action.command] ?? action.command}
      </Button>
      {!action.allowed && action.reason && <p className="ps-1 text-[11px] leading-snug text-slate" data-reason={action.command}>{action.reason}</p>}
    </div>
  )
}

/** Mutation helper: toast on success/failure, then refresh the given queries. */
export function useAct<TArgs = void, TRes = unknown>(fn: (a: TArgs) => Promise<TRes>, opts: { invalidate?: unknown[][]; success?: string; onDone?: (r: TRes) => void } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      if (opts.success) toast.success(opts.success)
      for (const k of opts.invalidate ?? []) await qc.invalidateQueries({ queryKey: k })
      opts.onDone?.(r)
    },
    onError: (e) => { toast.error(errText(e)) },
  })
}

export const Bidi = ({ children, className }: { children: React.ReactNode; className?: string }) => <span dir="auto" className={className}>{children}</span>
