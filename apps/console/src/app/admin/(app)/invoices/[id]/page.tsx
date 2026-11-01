"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { INVOICE_CANCEL_REASONS, type StaffInvoice, type StaffInvoicePayments } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { tableClass } from "@/components/data-list"
import { TileError } from "@/components/bento"
import { CaseHeader, ListSkeleton, StateChip, SummaryItem, TableScroll } from "@/components/case"
import { codeLabel, CURRENCIES, localInput } from "@/components/club"
import { DirectInvoiceDialog } from "@/components/direct-invoice-form"
import { FormDialog, useDialogs } from "@/components/form-dialog"
import { PaymentPanel } from "@/components/payment-panel"
import { Arrow, Field, Panel, useAct } from "@/components/ui"
import { api, errText, newIdempotencyKey } from "@/lib/api"
import { useCrumbLabel } from "@/lib/crumb"
import { fmtDateTime, money, toMinor } from "@/lib/format"
import { statusText, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

const OFFLINE_METHODS = ["BANK_TRANSFER", "CASH", "CARD_TERMINAL", "OTHER"] as const
const blankPay = (currency: string) => ({ amount: "", currency, method: "BANK_TRANSFER" as string, ref: "", payer: "", received: localInput(new Date()) })

/** Admin Panel invoice page (ADR-0006, ADR-0028): customer, lines, document, issue, edit a direct draft, cancel, record an offline payment on a service invoice, online-payment readiness and refunds. */
export default function InvoicePage() {
  const { id } = useParams<{ id: string }>()
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const key = ["invoice", id]
  const q = useQuery({ queryKey: key, queryFn: () => api<StaffInvoice>(`/v1/admin/invoices/${id}`), refetchInterval: 30_000 })
  const inv = q.data
  useCrumbLabel(inv?.number ?? inv?.requestRef)
  const dlg = useDialogs<"cancel" | "pay">()
  const [editing, setEditing] = useState(false)
  const [c, setC] = useState({ reasonCode: "CORRECTION", note: "" })
  const [pay, setPay] = useState(blankPay("GBP"))
  useEffect(() => { if (dlg.which === "pay" && inv) setPay(blankPay(inv.currency)) }, [dlg.which]) // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => { await qc.invalidateQueries({ queryKey: key }); await qc.invalidateQueries({ queryKey: ["invoices"] }); await qc.invalidateQueries({ queryKey: ["invoice-payments", id] }) }
  const issue = useAct(() => api(`/v1/admin/invoices/${id}/issue`, { body: {} }), {
    success: t("invp.issued"), invalidate: [key, ["invoices"], ["invoice-payments", id]],
  })
  const payments = useQuery({ queryKey: ["invoice-payments", id], queryFn: () => api<StaffInvoicePayments>(`/v1/admin/invoices/${id}/payments`), enabled: !!inv && inv.status !== "DRAFT", refetchInterval: 15_000 })
  const verify = useAct((pid: string) => api(`/v1/admin/payments/${pid}/verify`, { body: {} }), { success: t("rq.paymentVerified"), invalidate: [key, ["invoices"], ["invoice-payments", id]] })

  if (q.error) return <div className="p-5"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!inv) return <ListSkeleton rows={6} />

  const issueAction = inv.actions.find((a) => a.command === "issue")
  const cancelAction = inv.actions.find((a) => a.command === "cancel")
  const issuer = can("commercial_document.issue")
  const direct = inv.origin === "DIRECT"
  const download = async () => { try { const r = await api<{ url: string }>(`/v1/documents/${inv.documentId}/download`); window.open(r.url, "_blank", "noopener") } catch (e) { toast.error(errText(e)) } }
  // Only a service invoice takes an offline payment (ADR-0028 D9); flight and cargo record theirs on the request.
  const canRecord = inv.productType === "SERVICE" && inv.status === "ISSUED" && can("payment.record")
  const unverified = (payments.data?.payments ?? []).filter((p) => p.status === "RECORDED")
  const requestLink = inv.productType === "SERVICE" && !direct && can("service_request.read.any") ? `/services/${inv.requestRef}` : inv.productType === "CARGO" && can("cargo_request.read.any") ? `/cargo/${inv.requestRef}` : inv.productType === "FLIGHT" && can("flight_request.read.any") ? `/requests/${inv.requestRef}` : null

  return (
    <div className="pb-8">
      <CaseHeader
        reference={<span className="ref text-lead font-semibold" data-testid="invoice-number">{inv.number ?? t("invp.draft")}</span>}
        title={<span dir="auto">{inv.customer.name}</span>}
        meta={<>{t(direct ? "invd.origin.DIRECT" : "invd.origin.QUOTE")} · {requestLink ? <Link href={requestLink} className="ref text-link hover:underline">{inv.requestRef}</Link> : <span className="ref">{inv.requestRef}</span>}</>}
        summary={<>
          <span data-testid="invoice-status"><StateChip value={inv.status} /></span>
          <SummaryItem label={t("pg.c.total")}><span className="num font-semibold" data-testid="invoice-detail-total">{money(inv.total)}</span></SummaryItem>
          {inv.issuedAt && <SummaryItem label={t("pg.c.issued")}><span className="num">{fmtDateTime(inv.issuedAt)}</span></SummaryItem>}
          {inv.expiresAt && inv.status === "ISSUED" && <SummaryItem label={t("invd.due")}><span className="num">{fmtDateTime(inv.expiresAt)}</span></SummaryItem>}
          {inv.paidAt && <SummaryItem label={t("invd.paidAt")}><span className="num">{fmtDateTime(inv.paidAt)}</span></SummaryItem>}
        </>}
      />
      <div className="grid gap-x-8 px-5 pt-2 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {!inv.customer.emailDeliverable && inv.status !== "CANCELLED" && (
            <p role="note" className="mt-3 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-meta text-warning-subtle-fg" data-testid="no-email-warning"><b>{t("invd.noEmail.title")}</b> {t("invd.noEmail.body")}</p>
          )}
          <Panel title={t("invd.lines")}>
            <TableScroll><table className={tableClass} data-testid="invoice-lines-table">
              <thead><tr><th className="text-start">{t("invd.type")}</th><th className="text-start">{t("invd.description")}</th><th className="cell-num">{t("invd.qty")}</th><th className="cell-num">{t("invd.unitShort")}</th><th className="cell-num">{t("q.amount")}</th></tr></thead>
              <tbody>{inv.lines.map((l, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap">{l.serviceType ? codeLabel(t, "invd.type", l.serviceType) : "—"}</td>
                  <td><span dir="auto">{l.description}</span></td>
                  <td className="cell-num">{l.quantity}</td>
                  <td className="cell-num">{money(l.unitAmount)}</td>
                  <td className="cell-num">{money(l.amount)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={4} className="cell-num font-medium">{t("svc.total")}</td><td className="cell-num font-semibold">{money(inv.total)}</td></tr></tfoot>
            </table></TableScroll>
            {inv.notes && <p className="mt-3 border-t border-rule pt-2" data-testid="invoice-notes-shown"><span className="text-steel">{t("invd.notes")}: </span><span dir="auto">{inv.notes}</span></p>}
          </Panel>
          <Panel title={t("invp.history")}>
            <ol className="space-y-0.5" data-testid="invoice-history">{inv.history.map((h, n) => <li key={n}><span className="num text-caption text-steel">{fmtDateTime(h.createdAt)}</span> {codeLabel(t, "invp.cmd", h.command)} <Arrow /> {statusText(t, h.toStatus)}{h.reasonCode && <> · {codeLabel(t, "invp.reason", h.reasonCode)}</>}{h.reasonText && <span className="text-steel"> — {h.reasonText}</span>} <span className="text-steel">· {h.actorName ?? (h.actorKind === "SYSTEM" ? t("invp.system") : t("invp.staff"))}</span></li>)}</ol>
          </Panel>
        </div>
        <div className="min-w-0">
          <Panel title={t("invd.actions")}>
            <div className="flex flex-wrap gap-2">
              {inv.documentId && <Button size="sm" variant="outline" onClick={() => void download()} data-command="download_invoice">{t("invd.pdf")}</Button>}
              {issuer && issueAction && <div><Button size="sm" disabled={!issueAction.allowed} loading={issue.isPending} onClick={() => issue.mutate(undefined, { onError: () => void refresh() })} data-command="issue_invoice">{t("invp.issue")}</Button>{!issueAction.allowed && <p className="mt-1 max-w-72 text-caption leading-snug text-steel" data-reason="issue_invoice">{issueAction.reason}</p>}</div>}
              {direct && inv.status === "DRAFT" && can("invoice.direct") && <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-command="edit_invoice">{t("invd.edit")}</Button>}
              {issuer && cancelAction?.allowed && <Button size="sm" variant="outline" onClick={() => { setC({ reasonCode: "CORRECTION", note: "" }); dlg.open("cancel") }} data-command="cancel_invoice">{t("invp.cancel")}</Button>}
              {canRecord && <Button size="sm" variant="outline" onClick={() => dlg.open("pay")} data-command="record_invoice_payment">{t("pay.record")}</Button>}
            </div>
            {direct && inv.status === "DRAFT" && !can("invoice.direct") && <p className="mt-2 text-caption text-steel">{t("invd.edit.denied")}</p>}
          </Panel>
          {unverified.length > 0 && can("payment.record") && (
            <Panel title={t("invd.toVerify")}>
              <ul className="ledger-rows" data-testid="payments-to-verify">{unverified.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-1.5"><span><span className="num">{money(p.amount)}</span> <span className="text-steel">{codeLabel(t, "pay.method", p.method)} · {fmtDateTime(p.receivedAt)}</span></span><Button size="xs" variant="outline" loading={verify.isPending && verify.variables === p.id} onClick={() => verify.mutate(p.id)} data-command="verify_payment">{t("rq.verifySecond")}</Button></li>
              ))}</ul>
            </Panel>
          )}
          {inv.status !== "DRAFT" && <div className="mt-4 border-t border-rule pt-2"><PaymentPanel invoice={inv} /></div>}
        </div>
      </div>

      {editing && <DirectInvoiceDialog invoice={inv} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void refresh() }} />}
      <FormDialog {...dlg.bind("cancel")} testId="dlg-cancel-invoice" title={t("invp.cancel.title")} submitLabel={t("invp.cancel.submit")} destructive description={t("invp.cancel.desc", { n: inv.number ?? t("invp.draft") })}
        onSubmit={async () => { await api(`/v1/admin/invoices/${id}/cancel`, { body: { reasonCode: c.reasonCode, note: c.note || undefined } }); await refresh() }}>
        <Field label={t("invp.reasonLabel")}><NativeSelect className="field-input" value={c.reasonCode} onChange={(e) => setC({ ...c, reasonCode: e.target.value })}>{INVOICE_CANCEL_REASONS.map((r) => <option key={r} value={r}>{codeLabel(t, "invp.reason", r)}</option>)}</NativeSelect></Field>
        <Field label={t("invp.note")} hint={t("invp.note.hint")}><textarea className="field-input" rows={2} value={c.note} onChange={(e) => setC({ ...c, note: e.target.value })} required={c.reasonCode === "OTHER"} /></Field>
      </FormDialog>
      <FormDialog {...dlg.bind("pay")} wide testId="dlg-invoice-payment" title={t("invd.pay.title")} description={t("invd.pay.desc")} submitLabel={t("pay.record")}
        onSubmit={async () => {
          const r = await api<{ needsSecondVerifier: boolean }>(`/v1/admin/invoices/${id}/payments`, {
            body: { amount: { amountMinor: toMinor(pay.amount.replace(",", "."), pay.currency), currency: pay.currency }, method: pay.method, receivedAt: new Date(pay.received).toISOString(), externalReference: pay.ref.trim(), payerName: pay.payer.trim() },
            headers: { "idempotency-key": newIdempotencyKey() },
          })
          if (r.needsSecondVerifier) toast.info(t("invd.pay.second"))
          await refresh()
        }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("q.amount")}><input className="field-input num" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} required dir="ltr" data-testid="pay-amount" /></Field>
          <Field label={t("q.currency")}><NativeSelect className="field-input" value={pay.currency} onChange={(e) => setPay({ ...pay, currency: e.target.value })}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</NativeSelect></Field>
          <Field label={t("invd.pay.method")}><NativeSelect className="field-input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{OFFLINE_METHODS.map((m) => <option key={m} value={m}>{codeLabel(t, "pay.method", m)}</option>)}</NativeSelect></Field>
          <Field label={t("invd.pay.ref")}><input className="field-input" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} required maxLength={80} dir="auto" data-testid="pay-ref" /></Field>
          <Field label={t("invd.pay.payer")}><input className="field-input" value={pay.payer} onChange={(e) => setPay({ ...pay, payer: e.target.value })} required minLength={2} maxLength={120} dir="auto" data-testid="pay-payer" /></Field>
          <Field label={t("invd.pay.received")}><input type="datetime-local" className="field-input" value={pay.received} onChange={(e) => setPay({ ...pay, received: e.target.value })} required dir="ltr" /></Field>
        </div>
      </FormDialog>
    </div>
  )
}
