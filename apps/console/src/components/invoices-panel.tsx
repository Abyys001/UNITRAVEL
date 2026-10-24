"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { INVOICE_CANCEL_REASONS, type StaffInvoice } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { FormDialog, useDialogs } from "@/components/form-dialog"
import { PaymentPanel } from "@/components/payment-panel"
import { Empty, ErrorLine, Field, Panel, Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, human, money } from "@/lib/format"
import { useSession } from "@/lib/session"

const LIVE = new Set(["DRAFT", "ISSUED", "PAID"])

/**
 * Invoices of one request (ADR-0006): create a draft from the accepted quote, issue it, cancel it, read its history.
 * Amounts arrive only for `pricing.read.internal`; the guards (for example PAY_ON_TICKETING) are the server's and come
 * back as the reason next to the disabled button.
 */
export function InvoicesPanel({ requestRef }: { requestRef: string }) {
  const { can } = useSession()
  const key = ["invoices", requestRef]
  const q = useQuery({ queryKey: key, queryFn: () => api<StaffInvoice[]>(`/v1/admin/requests/${requestRef}/invoices`) })
  const dlg = useDialogs<"cancel">()
  const [target, setTarget] = useState<StaffInvoice | null>(null)
  const [f, setF] = useState({ reasonCode: "CORRECTION", note: "" })
  const issuer = can("commercial_document.issue")
  const create = useAct(() => api<StaffInvoice>(`/v1/admin/requests/${requestRef}/invoices`, { body: {} }), { invalidate: [key, ["invoices"]], success: "Invoice draft created" })
  const issue = useAct((id: string) => api<StaffInvoice>(`/v1/admin/invoices/${id}/issue`, { body: {} }), { invalidate: [key, ["invoices"]], success: "Invoice issued" })
  const invoices = q.data ?? []
  const hasLive = invoices.some((i) => LIVE.has(i.status))
  if (!issuer && !invoices.length) return null
  return (
    <Panel title="Invoices" aside={issuer && !hasLive && <Button size="xs" variant="outline" onClick={() => create.mutate()} loading={create.isPending} data-testid="create-invoice">New invoice draft</Button>}>
      <ErrorLine error={q.error} />
      {!invoices.length ? <Empty>No invoices. An invoice is built from the accepted quote.</Empty> : (
        <ul className="ledger-rows" data-testid="invoices">
          {invoices.map((i) => {
            const issueAction = i.actions.find((a) => a.command === "issue")
            const cancelAction = i.actions.find((a) => a.command === "cancel")
            return (
              <li key={i.id} className="space-y-1 py-2" data-testid="invoice-item">
                <p className="flex items-center justify-between gap-2"><span className="num font-medium">{i.number ?? "Draft"}</span><Tag value={i.status} /></p>
                <p className="flex justify-between text-[12px] text-steel"><span>{i.lines.length} line{i.lines.length === 1 ? "" : "s"}{i.expiresAt && i.status === "ISSUED" && <> · expires {fmtDateTime(i.expiresAt)}</>}{i.cancelReason && <> · {human(i.cancelReason)}</>}</span><span className="num">{money(i.total)}</span></p>
                {issuer && (
                  <div className="flex flex-wrap gap-1.5">
                    {issueAction && <div><Button size="xs" variant="default" disabled={!issueAction.allowed} loading={issue.isPending && issue.variables === i.id} onClick={() => issue.mutate(i.id)} data-command="issue_invoice">Issue</Button>{!issueAction.allowed && <p className="text-[11px] leading-snug text-steel" data-reason="issue_invoice">{issueAction.reason}</p>}</div>}
                    {cancelAction?.allowed && <Button size="xs" variant="outline" onClick={() => { setTarget(i); setF({ reasonCode: "CORRECTION", note: "" }); dlg.open("cancel") }} data-command="cancel_invoice">Cancel…</Button>}
                  </div>
                )}
                {i.status !== "DRAFT" && <PaymentPanel invoice={i} />}
                <details className="text-[12px]"><summary className="cursor-pointer text-steel">History</summary>
                  <ol className="mt-1 space-y-0.5" data-testid="invoice-history">{i.history.map((h, n) => <li key={n}><span className="num text-[11.5px] text-steel">{fmtDateTime(h.createdAt)}</span> {human(h.command)} → {h.toStatus}{h.reasonCode && <> · {human(h.reasonCode)}</>}{h.reasonText && <span className="text-steel"> — {h.reasonText}</span>} <span className="text-steel">· {h.actorName ?? (h.actorKind === "SYSTEM" ? "System" : "Staff")}</span></li>)}</ol>
                </details>
              </li>
            )
          })}
        </ul>
      )}
      <FormDialog {...dlg.bind("cancel")} testId="dlg-cancel-invoice" title="Cancel invoice…" submitLabel="Cancel invoice" destructive description={target ? `${target.number ?? "Draft"} is cancelled for good: a correction is a new invoice with a new number. The customer is told not to pay it.` : undefined}
        onSubmit={async () => { await api(`/v1/admin/invoices/${target!.id}/cancel`, { body: { reasonCode: f.reasonCode, note: f.note || undefined } }); await q.refetch() }}>
        <Field label="Reason"><NativeSelect className="field-input" value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })}>{INVOICE_CANCEL_REASONS.map((r) => <option key={r} value={r}>{human(r)}</option>)}</NativeSelect></Field>
        <Field label="Internal note" hint="Never shown to the customer. Required for Other."><textarea className="field-input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required={f.reasonCode === "OTHER"} /></Field>
      </FormDialog>
    </Panel>
  )
}
