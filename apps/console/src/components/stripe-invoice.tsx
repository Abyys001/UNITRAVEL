"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, FileText, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import type { StaffInvoice, StripeInvoiceStatus, StripeInvoiceView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { StatusChip, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { Panel, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, money } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

const TONE: Record<StripeInvoiceStatus, "ok" | "warn" | "danger" | "info" | "neutral"> = { CREATING: "info", DRAFT: "info", OPEN: "warn", PAID: "ok", VOID: "neutral", UNCOLLECTIBLE: "danger", FAILED: "danger" }

/**
 * ADR-0039 D4: the Stripe invoice that collects this invoice. Read-only facts from our mirror of Stripe; Create/Retry and
 * Refresh call the server, which talks to Stripe with the keys from the Developer Panel. Nothing here touches a secret.
 */
export function StripeInvoicePanel({ invoice }: { invoice: StaffInvoice }) {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const key = ["invoice-stripe", invoice.id]
  const q = useQuery({ queryKey: key, queryFn: () => api<StripeInvoiceView>(`/v1/admin/invoices/${invoice.id}/stripe`), enabled: invoice.status !== "DRAFT", refetchInterval: (query) => (query.state.data?.current?.status === "CREATING" || query.state.data?.current?.status === "DRAFT" ? 3000 : 30_000) })
  const after = async () => { await qc.invalidateQueries({ queryKey: key }); await qc.invalidateQueries({ queryKey: ["invoice", invoice.id] }); await qc.invalidateQueries({ queryKey: ["invoice-payments", invoice.id] }) }
  const create = useAct(() => api<StripeInvoiceView>(`/v1/admin/invoices/${invoice.id}/stripe`, { body: {} }), { success: t("stripe.created"), onDone: () => void after() })
  const sync = useAct(() => api<StripeInvoiceView>(`/v1/admin/invoices/${invoice.id}/stripe/sync`, { body: {} }), { success: t("stripe.synced"), onDone: () => void after() })
  if (invoice.status === "DRAFT") return null
  const v = q.data
  const cur = v?.current
  const issuer = can("commercial_document.issue")
  const copy = (url: string) => { void navigator.clipboard.writeText(url).then(() => toast.success(t("stripe.copied")), (e) => toast.error(errText(e))) }
  return (
    <Panel title={t("stripe.title")} aside={cur && <span data-testid="stripe-status"><StatusChip tone={TONE[cur.status]}>{t(`stripe.st.${cur.status}` as MsgKey)}</StatusChip></span>}>
      <div data-testid="stripe-invoice">
        {q.isError ? <TileError error={q.error} onRetry={() => void q.refetch()} /> : !v ? <ListSkeleton rows={2} className="p-0" /> : (
          <div className="space-y-3">
            {!cur ? (
              <p className="text-meta text-steel">{v.eligibility.offered && v.supportsInvoicing ? t("stripe.none.ready") : t("stripe.none")}</p>
            ) : (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-meta">
                <dt className="text-steel">{t("stripe.id")}</dt>
                <dd className="min-w-0 truncate font-mono text-caption" dir="ltr" data-testid="stripe-id">{cur.stripeInvoiceId ?? "—"}{cur.attempt > 1 && <span className="ms-1 text-steel">· {t("stripe.attempt", { n: cur.attempt })}</span>}</dd>
                {cur.amountDue && <><dt className="text-steel">{t("stripe.due")}</dt><dd className="num font-semibold">{money(cur.amountDue)}</dd></>}
                {cur.amountPaid && cur.amountPaid.amountMinor > 0 && <><dt className="text-steel">{t("stripe.paid")}</dt><dd className="num font-semibold text-success">{money(cur.amountPaid)}</dd></>}
                {cur.finalizedAt && <><dt className="text-steel">{t("stripe.finalized")}</dt><dd className="num">{fmtDateTime(cur.finalizedAt)}</dd></>}
                {cur.paidAt && <><dt className="text-steel">{t("stripe.paidAt")}</dt><dd className="num">{fmtDateTime(cur.paidAt)}</dd></>}
                {cur.voidedAt && <><dt className="text-steel">{t("stripe.voidedAt")}</dt><dd className="num">{fmtDateTime(cur.voidedAt)}</dd></>}
                {cur.syncedAt && <><dt className="text-steel">{t("stripe.synced.at")}</dt><dd className="num text-steel">{fmtDateTime(cur.syncedAt)}</dd></>}
              </dl>
            )}
            {cur?.lastError && <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-caption text-danger" data-testid="stripe-error">{cur.lastError}</p>}
            {cur && (cur.hostedInvoiceUrl || cur.invoicePdfUrl || cur.dashboardUrl) && (
              <div className="flex flex-wrap gap-2">
                {cur.hostedInvoiceUrl && cur.status === "OPEN" && <Button size="xs" variant="outline" onClick={() => copy(cur.hostedInvoiceUrl!)} data-testid="stripe-copy">{t("stripe.copy")}</Button>}
                {cur.hostedInvoiceUrl && <a href={cur.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border border-rule px-2 text-caption font-medium hover:bg-hover">{t("stripe.hosted")}<ExternalLink className="size-3.5" aria-hidden /></a>}
                {cur.invoicePdfUrl && <a href={cur.invoicePdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border border-rule px-2 text-caption font-medium hover:bg-hover"><FileText className="size-3.5" aria-hidden />{t("stripe.pdf")}</a>}
                {cur.dashboardUrl && <a href={cur.dashboardUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border border-rule px-2 text-caption font-medium hover:bg-hover">{t("stripe.dashboard")}<ExternalLink className="size-3.5" aria-hidden /></a>}
              </div>
            )}
            {issuer && (
              <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
                {v.canCreate && <Button size="sm" loading={create.isPending} onClick={() => create.mutate(undefined)} data-testid="stripe-create">{cur && (cur.status === "FAILED" || cur.status === "VOID") ? t("stripe.retry") : cur ? t("stripe.resume") : t("stripe.create")}</Button>}
                {cur?.stripeInvoiceId && (cur.status === "OPEN" || cur.status === "DRAFT") && <Button size="sm" variant="outline" loading={sync.isPending} onClick={() => sync.mutate(undefined)} data-testid="stripe-sync"><RefreshCw className="size-3.5" aria-hidden />{t("stripe.sync")}</Button>}
              </div>
            )}
            {!v.canCreate && !cur && (
              <ul className="space-y-0.5 text-caption text-steel" data-testid="stripe-reasons">
                {!v.supportsInvoicing && <li>• {t("stripe.why.NO_PROVIDER")}</li>}
                {v.eligibility.reasons.filter((r) => r !== "NOT_CONFIGURED" || v.supportsInvoicing).map((r) => <li key={r}>• {t(`stripe.why.${r}` as MsgKey)}</li>)}
              </ul>
            )}
            <p className="text-caption text-steel">{t("stripe.hint")}</p>
            {v.history.length > 1 && (
              <details className="text-caption">
                <summary className="cursor-pointer text-steel">{t("stripe.history", { n: v.history.length })}</summary>
                <ul className="mt-1 space-y-0.5">{v.history.map((h) => <li key={h.id} className="flex justify-between gap-2"><span className="font-mono" dir="ltr">#{h.attempt} {h.stripeInvoiceId ?? "—"}</span><span>{t(`stripe.st.${h.status}` as MsgKey)}</span></li>)}</ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
