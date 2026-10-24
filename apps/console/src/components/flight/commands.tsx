"use client"

import { useEffect, useState } from "react"

import { DEFAULT_WORKFLOW } from "@unitravel/contracts"

import { FormDialog } from "@/components/form-dialog"
import { StaffSelect } from "@/components/staff-select"
import { COMMAND_LABEL, Field } from "@/components/ui"
import { api } from "@/lib/api"
import { money } from "@/lib/format"
import type { FlightDetail } from "@/lib/types"
import { NativeSelect } from "@unitravel/ui/components/native-select"

/** Commands that need input (Table 13.1). The body shapes are CommandBodies in contracts; the API validates them. */
export const DIALOG_COMMANDS = new Set(["assign", "request_info", "send_quote", "record_acceptance", "close", "reopen", "cancel", "decline", "mark_reservation_lapsed"])

const localNow = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

export function CommandDialog({ command, d, onClose, done }: { command: string | null; d: FlightDetail; onClose: () => void; done: () => Promise<void> }) {
  const [f, setF] = useState<Record<string, string>>({})
  const drafts = d.quotes.filter((q) => q.status === "DRAFT")
  const sent = d.quotes.find((q) => q.status === "SENT")
  useEffect(() => {
    if (!command) return
    setF(command === "send_quote" ? { quoteId: drafts[0]?.id ?? "" } : command === "record_acceptance" ? { quoteId: sent?.id ?? "", optionId: sent?.options[0]?.id ?? "", calledAt: localNow(), note: "" } : command === "decline" ? { reasonCode: DEFAULT_WORKFLOW.declineReasons[0]!.code, message: "" } : command === "cancel" ? { reasonCode: DEFAULT_WORKFLOW.cancellationReasons[0]!.code, message: "" } : {})
  }, [command]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!command) return null
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const body = (): Record<string, unknown> => {
    switch (command) {
      case "record_acceptance": return { quoteId: f.quoteId, optionId: f.optionId, calledAt: new Date(f.calledAt!).toISOString(), note: f.note }
      case "close": case "reopen": return f.note ? { note: f.note } : {}
      default: return f
    }
  }
  const submit = async () => {
    await api(`/v1/admin/flight-requests/${d.ref}/commands/${command}`, { body: body(), headers: { "if-match": String(d.version) } })
    await done()
  }
  const reasons = command === "decline" ? DEFAULT_WORKFLOW.declineReasons : DEFAULT_WORKFLOW.cancellationReasons
  const quote = drafts.find((q) => q.id === f.quoteId)
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={COMMAND_LABEL[command] ?? command} submitLabel={(COMMAND_LABEL[command] ?? command).replace("…", "")} destructive={command === "cancel" || command === "decline"} onSubmit={submit} testId={`dlg-${command}`}>
      {command === "assign" && <StaffSelect value={f.assigneeUserId ?? ""} onChange={(id) => setF({ ...f, assigneeUserId: id })} hint="The assignee must be able to work flight requests." />}
      {command === "request_info" && <Field label="Message to the customer" hint="Moves the request to AWAITING_CUSTOMER and notifies them."><textarea className="field-input min-h-28" value={f.message ?? ""} onChange={set("message")} required dir="auto" /></Field>}
      {command === "send_quote" && (
        drafts.length ? (
          <>
            <Field label="Draft quote"><NativeSelect className="field-input" value={f.quoteId} onChange={set("quoteId")}>{drafts.map((q) => <option key={q.id} value={q.id}>v{q.version} · {q.options.length} option{q.options.length === 1 ? "" : "s"}</option>)}</NativeSelect></Field>
            {quote && <ul className="ledger-rows">{quote.options.map((o) => <li key={o.id} className="flex justify-between py-1"><span>{o.label}{o.unknownFields.length > 0 && <span className="ms-2 text-danger">needs {o.unknownFields.join(", ")}</span>}</span><span className="num">{money(o.priceBreakdown.total)}</span></li>)}</ul>}
            <p className="text-steel">The customer is notified and the request moves to QUOTED. A quote PDF is generated.</p>
          </>
        ) : <p className="text-danger">There is no draft quote. Build one first.</p>
      )}
      {command === "record_acceptance" && (
        sent ? (
          <>
            <Field label="Option the customer accepted"><NativeSelect className="field-input" value={f.optionId} onChange={set("optionId")}>{sent.options.map((o) => <option key={o.id} value={o.id}>{o.label} · {money(o.priceBreakdown.total)}</option>)}</NativeSelect></Field>
            <Field label="Call time"><input type="datetime-local" className="field-input" value={f.calledAt ?? ""} onChange={set("calledAt")} required /></Field>
            <Field label="Note" hint="What the customer said, in your words."><textarea className="field-input min-h-20" value={f.note ?? ""} onChange={set("note")} minLength={3} required /></Field>
          </>
        ) : <p className="text-danger">No sent quote to accept.</p>
      )}
      {(command === "close" || command === "reopen") && <Field label="Note (optional)"><textarea className="field-input min-h-20" value={f.note ?? ""} onChange={set("note")} /></Field>}
      {(command === "cancel" || command === "decline") && (
        <>
          <Field label="Reason code"><NativeSelect className="field-input" value={f.reasonCode} onChange={set("reasonCode")}>{reasons.map((r) => <option key={r.code} value={r.code}>{r.code} — {r.label.en}</option>)}</NativeSelect></Field>
          <Field label="Message to the customer" hint="Neutral wording; it is sent as written."><textarea className="field-input min-h-24" value={f.message ?? ""} onChange={set("message")} required dir="auto" /></Field>
        </>
      )}
      {command === "mark_reservation_lapsed" && <Field label="Reason"><textarea className="field-input min-h-20" value={f.reason ?? ""} onChange={set("reason")} minLength={3} required /></Field>}
    </FormDialog>
  )
}
