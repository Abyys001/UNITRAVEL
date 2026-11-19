"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Send } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { TICKET_DOCUMENT_KINDS, type TicketDocumentCommand, type TicketDocumentKind, type TicketDocumentStaffDetail } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { Check } from "@/components/controls"
import { FormDialog } from "@/components/form-dialog"
import { Field } from "@/components/ui"
import { api, newIdempotencyKey } from "@/lib/api"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

import { kindLabel, PdfDrop, ticketError, TicketErrorLine } from "./shared"

const base = (id: string) => `/v1/admin/ticket-documents/${id}`

export function useTicketRefresh() {
  const qc = useQueryClient()
  return async () => { await qc.invalidateQueries({ queryKey: ["td"] }) }
}

/**
 * Issue a DRAFT (ADR-0038 D4–D6): the API refuses unless every code matched, runs pending records first and needs the
 * text warnings acknowledged. The checkbox only appears when there are warnings; the API checks it either way.
 */
export function IssueControls({ d, onIssued }: { d: TicketDocumentStaffDetail; onIssued?: (d: TicketDocumentStaffDetail) => void }) {
  const t = useT()
  const refresh = useTicketRefresh()
  const [ack, setAck] = useState(false)
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const cmd = d.commands.find((c) => c.command === "issue")
  const blocked = !d.verification.allMatched
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      const r = await api<TicketDocumentStaffDetail>(`${base(d.id)}/issue`, { body: { acknowledgeTextWarnings: ack, passengerEmail: email.trim() || undefined }, headers: { "idempotency-key": newIdempotencyKey() } })
      toast.success(t("td.issue.done"))
      await refresh()
      onIssued?.(r)
    } catch (e2) { setError(e2); toast.error(ticketError(e2, t)) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" data-testid="issue-form">
      {d.verification.textWarnings && (
        <div className="rounded-md border border-orange/60 bg-warning-subtle px-3 py-2.5">
          <p className="font-medium">{t("td.issue.warnTitle")}</p>
          <p className="text-meta text-steel">{t("td.issue.warnBody")}</p>
          <Check className="mt-1" label={t("td.issue.ack")} checked={ack} onChange={(e) => setAck(e.target.checked)} required data-testid="ack-warnings" />
        </div>
      )}
      {!d.recordsComplete && <p className="text-meta text-steel">{d.pendingRecords ? t("td.issue.pendingRecords") : t("td.issue.noRecords")}</p>}
      <Field label={t("td.issue.email")} hint={d.passengerEmailOnFile ? t("td.issue.emailOnFile") : t("td.issue.emailHint")}>
        <input type="email" className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} dir="ltr" autoComplete="off" data-testid="passenger-email" />
      </Field>
      <TicketErrorLine error={error} />
      {blocked && <p role="alert" className="rounded-sm border border-danger bg-danger-subtle px-3 py-2 font-medium text-danger">{t("td.err.integrity")}</p>}
      {cmd && !cmd.allowed && !blocked && cmd.reason && <p className="text-meta text-steel">{cmd.reason}</p>}
      <Button type="submit" loading={busy} disabled={blocked || (d.verification.textWarnings && !ack)} data-testid="issue-submit"><Send aria-hidden />{t("td.issue.submit")}</Button>
    </form>
  )
}

type Dlg = "resend" | "replace" | "reissue" | "revoke"
const LABEL: Record<Dlg, MsgKey> = { resend: "td.cmd.resend", replace: "td.cmd.replace", reissue: "td.cmd.reissue", revoke: "td.cmd.revoke" }

/** The detail page's command row: one button per command the API allows, each behind an in-page confirmation dialog. */
export function TicketActions({ d }: { d: TicketDocumentStaffDetail }) {
  const t = useT()
  const router = useRouter()
  const { can } = useSession()
  const refresh = useTicketRefresh()
  const [open, setOpen] = useState<Dlg | null>(null)
  const bind = (k: Dlg) => ({ open: open === k, onOpenChange: (o: boolean) => setOpen(o ? k : null) })
  const allowed = (c: TicketDocumentCommand) => d.commands.some((x) => x.command === c && x.allowed)
  const perm = (c: Dlg) => (c === "resend" ? can("ticket.document.resend") : can("ticket.document.issue"))
  const list = (["resend", "replace", "reissue", "revoke"] as const).filter((c) => allowed(c) && perm(c))
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const [kind, setKind] = useState<TicketDocumentKind>(d.kind)
  const [file, setFile] = useState<{ documentId: string } | null>(null)
  const [toAccount, setToAccount] = useState(true)
  const [email, setEmail] = useState("")
  const start = (k: Dlg) => { setReason(""); setNotes(""); setKind(d.kind); setFile(null); setToAccount(true); setEmail(""); setOpen(k) }
  const post = <R,>(path: string, body: unknown, idem = true) => api<R>(`${base(d.id)}/${path}`, { body, headers: idem ? { "idempotency-key": newIdempotencyKey() } : {} }).catch((e: unknown) => { throw new Error(ticketError(e, t)) })
  const toVersion = async (r: TicketDocumentStaffDetail) => { await refresh(); router.push(`/tickets/${r.id}`) }
  if (!list.length) return null
  return (
    <>
      <div className="flex flex-wrap gap-2" data-testid="td-actions">
        {list.map((c) => <Button key={c} size="sm" variant={c === "revoke" ? "destructive" : "outline"} onClick={() => start(c)} data-testid={`td-cmd-${c}`}>{t(LABEL[c])}</Button>)}
      </div>
      <FormDialog {...bind("resend")} title={t("td.resend.title")} description={t("td.resend.desc")} submitLabel={t("td.cmd.resend")} testId="dlg-resend"
        onSubmit={async () => { await post("resend", { toAccount, passengerEmail: email.trim() || undefined }); await refresh() }}>
        <Check label={t("td.resend.account")} checked={toAccount} onChange={(e) => setToAccount(e.target.checked)} />
        <Field label={t("td.issue.email")} hint={t("td.resend.emailHint")}><input type="email" className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} required={!toAccount} maxLength={254} dir="ltr" /></Field>
      </FormDialog>
      <FormDialog {...bind("replace")} wide title={t("td.replace.title")} description={t("td.replace.desc")} submitLabel={t("td.cmd.replace")} testId="dlg-replace"
        onSubmit={async () => { if (!file) throw new Error(t("td.replace.needFile")); await toVersion(await post<TicketDocumentStaffDetail>("replace", { originalDocumentId: file.documentId, reason, kind: kind === d.kind ? undefined : kind })) }}>
        <PdfDrop requestRef={d.requestRef} onReady={setFile} testId="replace-drop" />
        <Field label={t("td.kind")}><NativeSelect className="field-input" value={kind} onChange={(e) => setKind(e.target.value as TicketDocumentKind)}>{TICKET_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{kindLabel(t, k)}</option>)}</NativeSelect></Field>
        <Field label={t("td.reason")} hint={t("td.reason.hint")}><textarea className="field-input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required dir="auto" /></Field>
      </FormDialog>
      <FormDialog {...bind("reissue")} title={t("td.reissue.title")} description={t("td.reissue.desc")} submitLabel={t("td.cmd.reissue")} testId="dlg-reissue"
        onSubmit={async () => { await toVersion(await post<TicketDocumentStaffDetail>("reissue", { reason, notes: notes.trim() || undefined })) }}>
        <Field label={t("td.reason")} hint={t("td.reason.hint")}><textarea className="field-input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required dir="auto" /></Field>
        <Field label={t("td.notes")} hint={t("td.notes.keep")}><textarea className="field-input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} dir="auto" /></Field>
      </FormDialog>
      <FormDialog {...bind("revoke")} destructive title={t("td.revoke.title")} description={d.status === "ISSUED" ? t("td.revoke.descIssued") : t("td.revoke.descDraft")} submitLabel={t("td.cmd.revoke")} testId="dlg-revoke"
        onSubmit={async () => { await post("revoke", { reason }, false); await refresh() }}>
        <Field label={t("td.reason")} hint={t("td.reason.hint")}><textarea className="field-input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required dir="auto" /></Field>
      </FormDialog>
    </>
  )
}
