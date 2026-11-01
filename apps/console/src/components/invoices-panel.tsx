"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { INVOICE_CANCEL_REASONS, type StaffInvoice } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { StateChip } from "@/components/case"
import { codeLabel } from "@/components/club"
import { FormDialog, useDialogs } from "@/components/form-dialog"
import { PaymentPanel } from "@/components/payment-panel"
import { Arrow, Empty, ErrorLine, Field, Panel, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, money } from "@/lib/format"
import { statusText, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

const LIVE = new Set(["DRAFT", "ISSUED", "PAID"])

/**
 * Invoices of one request (ADR-0006): create a draft from the accepted quote, issue it, cancel it, read its history.
 * Amounts arrive only for `pricing.read.internal`; the guards (for example PAY_ON_TICKETING) are the server's and come
 * back as the reason next to the disabled button.
 */
export function InvoicesPanel({ requestRef }: { requestRef: string }) {
  const t = useT()
  const { can } = useSession()
  const key = ["invoices", requestRef]
  const q = useQuery({ queryKey: key, queryFn: () => api<StaffInvoice[]>(`/v1/admin/requests/${requestRef}/invoices`) })
  const dlg = useDialogs<"cancel">()
  const [target, setTarget] = useState<StaffInvoice | null>(null)
  const [f, setF] = useState({ reasonCode: "CORRECTION", note: "" })
  const issuer = can("commercial_document.issue")
  const create = useAct(() => api<StaffInvoice>(`/v1/admin/requests/${requestRef}/invoices`, { body: {} }), { invalidate: [key, ["invoices"]], success: t("invp.created") })
  const issue = useAct((id: string) => api<StaffInvoice>(`/v1/admin/invoices/${id}/issue`, { body: {} }), { invalidate: [key, ["invoices"]], success: t("invp.issued") })
  const invoices = q.data ?? []
  const hasLive = invoices.some((i) => LIVE.has(i.status))
  if (!issuer && !invoices.length) return null
  return (
    <Panel title={t("invp.title")} aside={issuer && !hasLive && <Button size="xs" variant="outline" onClick={() => create.mutate()} loading={create.isPending} data-testid="create-invoice">{t("invp.new")}</Button>}>
      <ErrorLine error={q.error} />
      {!invoices.length ? <Empty>{t("invp.none")}</Empty> : (
        <ul className="ledger-rows" data-testid="invoices">
          {invoices.map((i) => {
            const issueAction = i.actions.find((a) => a.command === "issue")
            const cancelAction = i.actions.find((a) => a.command === "cancel")
            return (
              <li key={i.id} className="space-y-1 py-2" data-testid="invoice-item">
                <p className="flex items-center justify-between gap-2"><span className="ref font-medium">{i.number ?? t("invp.draft")}</span><StateChip value={i.status} /></p>
                <p className="flex justify-between text-meta text-steel"><span>{t(i.lines.length === 1 ? "invp.line.one" : "invp.lines", { n: i.lines.length })}{i.expiresAt && i.status === "ISSUED" && <> · {t("invp.expires", { t: fmtDateTime(i.expiresAt) })}</>}{i.cancelReason && <> · {codeLabel(t, "invp.reason", i.cancelReason)}</>}</span><span className="num">{money(i.total)}</span></p>
                {issuer && (
                  <div className="flex flex-wrap gap-1.5">
                    {issueAction && <div><Button size="xs" variant="default" disabled={!issueAction.allowed} loading={issue.isPending && issue.variables === i.id} onClick={() => issue.mutate(i.id)} data-command="issue_invoice">{t("invp.issue")}</Button>{!issueAction.allowed && <p className="text-caption leading-snug text-steel" data-reason="issue_invoice">{issueAction.reason}</p>}</div>}
                    {cancelAction?.allowed && <Button size="xs" variant="outline" onClick={() => { setTarget(i); setF({ reasonCode: "CORRECTION", note: "" }); dlg.open("cancel") }} data-command="cancel_invoice">{t("invp.cancel")}</Button>}
                  </div>
                )}
                {i.status !== "DRAFT" && <PaymentPanel invoice={i} />}
                <details className="text-meta"><summary className="cursor-pointer text-steel">{t("invp.history")}</summary>
                  <ol className="mt-1 space-y-0.5" data-testid="invoice-history">{i.history.map((h, n) => <li key={n}><span className="num text-caption text-steel">{fmtDateTime(h.createdAt)}</span> {codeLabel(t, "invp.cmd", h.command)} <Arrow /> {statusText(t, h.toStatus)}{h.reasonCode && <> · {codeLabel(t, "invp.reason", h.reasonCode)}</>}{h.reasonText && <span className="text-steel"> — {h.reasonText}</span>} <span className="text-steel">· {h.actorName ?? (h.actorKind === "SYSTEM" ? t("invp.system") : t("invp.staff"))}</span></li>)}</ol>
                </details>
              </li>
            )
          })}
        </ul>
      )}
      <FormDialog {...dlg.bind("cancel")} testId="dlg-cancel-invoice" title={t("invp.cancel.title")} submitLabel={t("invp.cancel.submit")} destructive description={target ? t("invp.cancel.desc", { n: target.number ?? t("invp.draft") }) : undefined}
        onSubmit={async () => { await api(`/v1/admin/invoices/${target!.id}/cancel`, { body: { reasonCode: f.reasonCode, note: f.note || undefined } }); await q.refetch() }}>
        <Field label={t("invp.reasonLabel")}><NativeSelect className="field-input" value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })}>{INVOICE_CANCEL_REASONS.map((r) => <option key={r} value={r}>{codeLabel(t, "invp.reason", r)}</option>)}</NativeSelect></Field>
        <Field label={t("invp.note")} hint={t("invp.note.hint")}><textarea className="field-input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required={f.reasonCode === "OTHER"} /></Field>
      </FormDialog>
    </Panel>
  )
}
