"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { REFUND_REASONS, type StaffInvoice, type StaffInvoicePayments } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { FormDialog, useDialogs } from "@/components/form-dialog"
import { Field, Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, human, money } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/**
 * Payment status of one issued invoice (ADR-0007): whether online payment is offered and why not, checkout sessions,
 * card payments, refunds. Resend the payment link; request a refund (a second person approves above the existing
 * four-eyes threshold). Everything shown comes from the server; amounts need `pricing.read.internal`.
 */
export function PaymentPanel({ invoice }: { invoice: StaffInvoice }) {
  const t = useT()
  const { can } = useSession()
  const key = ["invoice-payments", invoice.id]
  const q = useQuery({ queryKey: key, queryFn: () => api<StaffInvoicePayments>(`/v1/admin/invoices/${invoice.id}/payments`), refetchInterval: 15_000 })
  const dlg = useDialogs<"refund" | "reject">()
  const [f, setF] = useState({ amount: "", reasonCode: "CUSTOMER_REQUEST", note: "" })
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [why, setWhy] = useState("")
  const resend = useAct(() => api(`/v1/admin/invoices/${invoice.id}/payment-link/resend`, { body: {} }), { success: t("pay.resent") })
  const approve = useAct((id: string) => api(`/v1/admin/refunds/${id}/approve`, { body: {} }), { invalidate: [key, ["invoices"]], success: t("pay.refund.approved") })
  const d = q.data
  if (!d) return null
  const card = d.payments.find((p) => p.method === "CARD_ONLINE" && p.status === "VERIFIED")
  const nothing = !d.sessions.length && !d.payments.length && !d.refunds.length
  return (
    <div className="mt-1 space-y-1 border-t border-line pt-2 text-[12px]" data-testid="payment-panel">
      <p className="font-semibold">{t("pay.title")}</p>
      {invoice.status === "ISSUED" && (
        <p data-testid="online-state">{d.online.offered ? t("pay.offered") : t("pay.notOffered", { why: d.online.reasons.map((r) => t(`pay.reason.${r}` as never)).join(", ") })}</p>
      )}
      {nothing && <p className="text-steel">{t("pay.none")}</p>}
      {d.sessions.length > 0 && <p className="text-steel">{t("pay.sessions")}: {d.sessions.map((s) => <Tag key={s.id} value={s.status} title={`${s.provider} · ${fmtDateTime(s.createdAt)}`} className="me-1" />)}</p>}
      {d.payments.map((p) => (
        <p key={p.id} className="flex justify-between gap-2" data-testid="payment-item"><span>{human(p.method)} <Tag value={p.status} /> <span className="num text-steel">{p.providerRef ?? ""}</span></span><span className="num">{money(p.amount)}{p.refunded && p.refunded.amountMinor > 0 && <span className="text-steel"> · {money(p.refunded)} {t("pay.refund.refunded")}</span>}</span></p>
      ))}
      {d.refunds.length > 0 && <p className="font-semibold">{t("pay.refunds")}</p>}
      {d.refunds.map((r) => (
        <div key={r.id} className="space-y-0.5" data-testid="refund-item">
          <p className="flex items-center justify-between gap-2"><span><Tag value={r.status} /> {human(r.reasonCode)}</span><span className="num">{money(r.amount)}</span></p>
          <p className="text-steel">{r.requestedBy}{r.approvedBy && <> → {r.approvedBy}</>}{r.failure && <> · {r.failure}</>}</p>
          {r.status === "PENDING_APPROVAL" && can("payment.refund.approve") && (
            <div className="flex gap-1.5"><Button size="xs" loading={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)} data-command="approve_refund">{t("pay.refund.approve")}</Button><Button size="xs" variant="outline" onClick={() => { setRejecting(r.id); setWhy(""); dlg.open("reject") }} data-command="reject_refund">{t("pay.refund.reject")}</Button></div>
          )}
          {r.status === "PENDING_APPROVAL" && !can("payment.refund.approve") && <p className="text-steel">{t("pay.refund.needsSecond")}</p>}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {invoice.status === "ISSUED" && can("commercial_document.issue") && <Button size="xs" variant="outline" loading={resend.isPending} onClick={() => resend.mutate()} data-command="resend_payment_link">{t("pay.resend")}</Button>}
        {invoice.status === "PAID" && card && can("payment.refund.request") && <Button size="xs" variant="outline" onClick={() => { setF({ amount: "", reasonCode: "CUSTOMER_REQUEST", note: "" }); dlg.open("refund") }} data-command="request_refund">{t("pay.refund.request")}</Button>}
      </div>
      <FormDialog {...dlg.bind("refund")} testId="dlg-refund" title={t("pay.refund.title")} submitLabel={t("pay.refund.submit")} destructive
        description={d.refundThreshold ? t("pay.refund.threshold", { amount: money(d.refundThreshold) }) : undefined}
        onSubmit={async () => {
          const minor = f.amount.trim() ? Math.round(Number(f.amount) * 100) : undefined
          await api(`/v1/admin/invoices/${invoice.id}/refunds`, { body: { amountMinor: minor, reasonCode: f.reasonCode, note: f.note || undefined } })
          await q.refetch()
        }}>
        <Field label={t("pay.refund.amount")}><input className="field-input num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="refund-amount" /></Field>
        <Field label={t("pay.refund.reason")}><NativeSelect className="field-input" value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })}>{REFUND_REASONS.map((r) => <option key={r} value={r}>{human(r)}</option>)}</NativeSelect></Field>
        <Field label={t("pay.refund.note")}><textarea className="field-input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required={f.reasonCode === "OTHER"} /></Field>
      </FormDialog>
      <FormDialog {...dlg.bind("reject")} testId="dlg-reject-refund" title={t("pay.refund.reject")} submitLabel={t("pay.refund.reject")} destructive
        onSubmit={async () => { await api(`/v1/admin/refunds/${rejecting}/reject`, { body: { note: why } }); await q.refetch() }}>
        <Field label={t("pay.refund.rejectNote")}><textarea className="field-input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} required minLength={3} /></Field>
      </FormDialog>
    </div>
  )
}
