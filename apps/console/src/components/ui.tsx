"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Bidi, LedgerField as Field, PageHead, Panel, Tag } from "@unitravel/ui/product/ledger"
import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { errText, isDenied } from "@/lib/api"
import { useT } from "@/lib/i18n"

// Shared presentational pieces live in packages/ui; this module keeps what needs the console's API client and types.
export { Bidi, Field, PageHead, Panel, Tag }

export function ErrorLine({ error }: { error: unknown }) {
  const t = useT()
  if (!error) return null
  if (isDenied(error)) return <p role="alert" className="rounded-sm bg-surface-sunk px-2 py-1.5 text-steel" data-testid="denied-state"><span className="font-medium text-ink">{t("denied.title")}.</span> {t("denied.body")}</p>
  return <p role="alert" className="rounded-sm bg-danger-subtle px-2 py-1.5 text-danger">{errText(error)}</p>
}
export const Loading = ({ label = "Loading…" }: { label?: string }) => <LoadingState label={label} rows={2} className="p-5" />
export const Empty = ({ children }: { children: React.ReactNode }) => <EmptyState compact title={children} />

export const COMMAND_LABEL: Record<string, string> = {
  claim: "Claim", assign: "Assign…", request_info: "Request info…", send_quote: "Send quote…", record_acceptance: "Record acceptance…",
  record_reservation: "Record reservation…", record_tickets: "Record tickets…", close: "Close", reopen: "Reopen", cancel: "Cancel…", decline: "Decline…",
  record_booking: "Record partner booking…", schedule_handover: "Schedule handover…", receive: "Receive & re-weigh…", depart: "Departed…",
  arrive_customs: "At customs…", clear_customs: "Cleared customs…", out_for_delivery: "Out for delivery…", deliver: "Delivered…",
  raise_exception: "Raise exception…", resolve_exception: "Resolve exception…", mark_reservation_lapsed: "Mark reservation lapsed…", release_hold: "Release hold…", complete: "Complete…",
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
