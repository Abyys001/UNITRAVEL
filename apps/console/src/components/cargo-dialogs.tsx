"use client"

import { useEffect, useState } from "react"

import { DEFAULT_WORKFLOW } from "@unitravel/contracts"
import { validateAwb } from "@unitravel/domain"

import { FormDialog } from "@/components/form-dialog"
import { StaffSelect } from "@/components/staff-select"
import { COMMAND_LABEL, Field } from "@/components/ui"
import { api } from "@/lib/api"
import { money, toMinor } from "@/lib/format"
import type { CargoDetail, CargoLines, Money } from "@/lib/types"
import { NativeSelect } from "@unitravel/ui/components/native-select"

const localNow = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const LOCATION_COMMANDS = new Set(["depart", "arrive_customs", "clear_customs", "out_for_delivery", "deliver"])

/** Every cargo command with a body (CargoCommandBodies); the server's guards decide what is allowed. */
export function CargoCommandDialog({ command, d, onClose, done }: { command: string | null; d: CargoDetail; onClose: () => void; done: () => Promise<void> }) {
  const [f, setF] = useState<Record<string, string>>({})
  const [weights, setWeights] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!command) return
    setWeights(Object.fromEntries(d.pieces.map((p) => [p.id, String(p.verifiedWeightKg ?? p.weightKg)])))
    setF(command === "send_quote" ? { quoteId: d.quotes.find((q) => q.status === "DRAFT")?.id ?? "" } : command === "record_acceptance" ? { quoteId: d.quotes.find((q) => q.status === "SENT")?.id ?? "", calledAt: localNow() } : command === "record_booking" ? { partnerId: d.eligiblePartners[0]?.id ?? "" } : LOCATION_COMMANDS.has(command) ? { occurredAt: localNow(), location: "" } : command === "raise_exception" ? { reason: "HELD" } : command === "decline" ? { reasonCode: DEFAULT_WORKFLOW.declineReasons[0]!.code } : command === "cancel" ? { reasonCode: DEFAULT_WORKFLOW.cancellationReasons[0]!.code } : {})
  }, [command]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!command) return null
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const awb = f.awbNumber ? validateAwb(f.awbNumber) : null
  const body = (): Record<string, unknown> => {
    if (LOCATION_COMMANDS.has(command)) return { ...f, occurredAt: new Date(f.occurredAt!).toISOString() }
    if (command === "record_acceptance") return { quoteId: f.quoteId, calledAt: new Date(f.calledAt!).toISOString(), note: f.note }
    if (command === "record_booking") return { partnerId: f.partnerId, partnerReference: f.partnerReference, awbNumber: awb?.ok ? awb.normalised : f.awbNumber || undefined }
    if (command === "receive") return { location: f.location, verifiedWeights: d.pieces.map((p) => ({ pieceId: p.id, weightKg: Number(weights[p.id]) })) }
    if (command === "schedule_handover") return { note: f.note, at: f.at ? new Date(f.at).toISOString() : undefined }
    if (["close", "reopen"].includes(command)) return f.note ? { note: f.note } : {}
    return f
  }
  const submit = async () => { await api(`/v1/admin/cargo/requests/${d.ref}/commands/${command}`, { body: body(), headers: { "if-match": String(d.version) } }); await done() }
  const label = COMMAND_LABEL[command] ?? command
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={label} submitLabel={label.replace("…", "")} onSubmit={submit} destructive={["cancel", "decline", "raise_exception"].includes(command)} testId={`dlg-${command}`} wide={command === "receive"}>
      {command === "assign" && <StaffSelect value={f.assigneeUserId ?? ""} onChange={(id) => setF({ ...f, assigneeUserId: id })} />}
      {command === "request_info" && <Field label="Message to the customer"><textarea className="field-input min-h-24" value={f.message ?? ""} onChange={set("message")} required dir="auto" /></Field>}
      {command === "send_quote" && <Field label="Draft quote"><NativeSelect className="field-input" value={f.quoteId} onChange={set("quoteId")} required>{d.quotes.filter((q) => q.status === "DRAFT").map((q) => <option key={q.id} value={q.id}>v{q.version} · {q.partnerName} · {money(q.lines.total)}</option>)}</NativeSelect></Field>}
      {command === "record_acceptance" && <><Field label="Call time"><input type="datetime-local" className="field-input" value={f.calledAt ?? ""} onChange={set("calledAt")} required /></Field><Field label="Note"><textarea className="field-input" value={f.note ?? ""} onChange={set("note")} minLength={3} required /></Field></>}
      {command === "record_booking" && (
        <>
          <Field label="Partner" hint="Only partners that serve this lane and service and are compliance-cleared can be booked."><NativeSelect className="field-input" value={f.partnerId} onChange={set("partnerId")} required>{d.eligiblePartners.map((p) => <option key={p.id} value={p.id} disabled={p.complianceStatus !== "CLEARED"}>{p.name} · {p.complianceStatus}</option>)}</NativeSelect></Field>
          <Field label="Partner reference"><input className="field-input font-mono" value={f.partnerReference ?? ""} onChange={set("partnerReference")} required minLength={2} /></Field>
          <Field label="AWB number" hint={awb ? (awb.ok ? `Check digit OK — ${awb.normalised}` : awb.reason) : "3-digit prefix + 8-digit serial, e.g. 176-12345675"}><input className="field-input font-mono" value={f.awbNumber ?? ""} onChange={set("awbNumber")} aria-invalid={awb ? !awb.ok : undefined} dir="ltr" /></Field>
        </>
      )}
      {command === "schedule_handover" && <><Field label="Note"><input className="field-input" value={f.note ?? ""} onChange={set("note")} required /></Field><Field label="At (optional)"><input type="datetime-local" className="field-input" value={f.at ?? ""} onChange={set("at")} /></Field></>}
      {command === "receive" && (
        <>
          <p className="text-steel">Enter the weight measured at the counter. Beyond the lane tolerance the shipment moves to EXCEPTION (REWEIGH) and the customer gets a revised quote.</p>
          <table className="w-full"><thead><tr>{["Piece", "Declared", "Verified kg"].map((h) => <th key={h} className="cap text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>{d.pieces.map((p, i) => <tr key={p.id}><td className="py-1">{i + 1} · {p.lengthCm}×{p.widthCm}×{p.heightCm} cm</td><td className="num">{p.weightKg} kg</td><td><input aria-label={`Verified weight piece ${i + 1}`} className="field-input num w-28" inputMode="decimal" value={weights[p.id] ?? ""} onChange={(e) => setWeights({ ...weights, [p.id]: e.target.value })} required /></td></tr>)}</tbody></table>
          <Field label="Location"><input className="field-input" value={f.location ?? ""} onChange={set("location")} required minLength={2} /></Field>
        </>
      )}
      {LOCATION_COMMANDS.has(command) && (
        <>
          <Field label="Location"><input className="field-input" value={f.location ?? ""} onChange={set("location")} required minLength={2} /></Field>
          <Field label="Occurred at"><input type="datetime-local" className="field-input" value={f.occurredAt ?? ""} onChange={set("occurredAt")} required /></Field>
          {command === "deliver" && <Field label="Proof of delivery — received by"><input className="field-input" value={f.podName ?? ""} onChange={set("podName")} required minLength={2} dir="auto" /></Field>}
        </>
      )}
      {command === "raise_exception" && <><Field label="Reason"><NativeSelect className="field-input" value={f.reason} onChange={set("reason")}>{["HELD", "DAMAGED", "LOST", "RETURNED", "REWEIGH"].map((r) => <option key={r}>{r}</option>)}</NativeSelect></Field><Field label="Note"><textarea className="field-input" value={f.note ?? ""} onChange={set("note")} minLength={3} required /></Field></>}
      {command === "resolve_exception" && <Field label="Resolution note"><textarea className="field-input" value={f.note ?? ""} onChange={set("note")} minLength={3} required /></Field>}
      {(command === "close" || command === "reopen") && <Field label="Note (optional)"><textarea className="field-input" value={f.note ?? ""} onChange={set("note")} /></Field>}
      {(command === "cancel" || command === "decline") && <><Field label="Reason code"><NativeSelect className="field-input" value={f.reasonCode} onChange={set("reasonCode")}>{(command === "decline" ? DEFAULT_WORKFLOW.declineReasons : DEFAULT_WORKFLOW.cancellationReasons).map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}</NativeSelect></Field><Field label="Message to the customer"><textarea className="field-input" value={f.message ?? ""} onChange={set("message")} required dir="auto" /></Field></>}
    </FormDialog>
  )
}

const LINE_KEYS = ["fuelSurcharge", "securitySurcharge", "handling", "customsBrokerage", "insurance", "pickup", "delivery"] as const

/** Partner quote: priced on chargeable weight; the partner must serve the lane and be compliance-cleared. */
export function CargoQuoteDialog({ d, done, open, onOpenChange }: { d: CargoDetail; done: () => Promise<void>; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState<Record<string, string>>({ currency: "GBP", ratePerKg: "", chargeableKg: String(d.weights.chargeableKg), duties: "", dutiesMode: "PAYABLE_BY_CONSIGNEE", partnerId: d.eligiblePartners.find((p) => p.complianceStatus === "CLEARED")?.id ?? "", transitNote: "", partnerCost: "" })
  const cur = f.currency!
  const m = (k: string): Money => ({ amountMinor: toMinor(f[k] ?? "0", cur), currency: cur })
  const freight = { amountMinor: Math.round(toMinor(f.ratePerKg ?? "0", cur) * Number(f.chargeableKg || 0)), currency: cur }
  const duties = f.dutiesMode === "PAYABLE_BY_CONSIGNEE" ? "PAYABLE_BY_CONSIGNEE" as const : m("duties")
  const total = freight.amountMinor + LINE_KEYS.reduce((n, k) => n + m(k).amountMinor, 0) + (duties === "PAYABLE_BY_CONSIGNEE" ? 0 : duties.amountMinor)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const submit = async () => {
    const lines: CargoLines = { freight: { ratePerKg: m("ratePerKg"), chargeableKg: Number(f.chargeableKg), amount: freight }, fuelSurcharge: m("fuelSurcharge"), securitySurcharge: m("securitySurcharge"), handling: m("handling"), customsBrokerage: m("customsBrokerage"), dutiesTaxes: duties, dutiesEstimate: f.dutiesMode === "ESTIMATE", insurance: m("insurance"), pickup: m("pickup"), delivery: m("delivery"), total: { amountMinor: total, currency: cur } }
    await api(`/v1/admin/cargo/requests/${d.ref}/quotes`, { body: { partnerId: f.partnerId, lines, transitNote: f.transitNote || undefined, partnerCostMinor: f.partnerCost ? toMinor(f.partnerCost, cur) : undefined } })
    await done()
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} wide title="Draft partner quote…" description={`Chargeable ${d.weights.chargeableKg} kg (actual ${d.weights.actualKg}, volumetric ${d.weights.volumetricKg}, divisor ${d.weights.divisor}).`} submitLabel="Save draft" onSubmit={submit} testId="dlg-cargo-quote">
      <div className="grid grid-cols-3 gap-2">
        <Field label="Partner" className="col-span-2"><NativeSelect className="field-input" value={f.partnerId} onChange={set("partnerId")} required>{d.eligiblePartners.map((p) => <option key={p.id} value={p.id} disabled={p.complianceStatus !== "CLEARED"}>{p.name} · {p.complianceStatus}{p.slaNote ? ` · ${p.slaNote}` : ""}</option>)}</NativeSelect></Field>
        <Field label="Currency"><NativeSelect className="field-input" value={f.currency} onChange={set("currency")}>{["GBP", "EUR", "USD"].map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
        <Field label="Rate per kg"><input className="field-input num" inputMode="decimal" value={f.ratePerKg} onChange={set("ratePerKg")} required /></Field>
        <Field label="Chargeable kg"><input className="field-input num" inputMode="decimal" value={f.chargeableKg} onChange={set("chargeableKg")} required /></Field>
        <Field label="Freight"><output className="field-input num flex items-center bg-ledger">{money(freight)}</output></Field>
        {LINE_KEYS.map((k) => <Field key={k} label={k.replace(/([A-Z])/g, " $1").toLowerCase()}><input className="field-input num" inputMode="decimal" value={f[k] ?? ""} onChange={set(k)} placeholder="0.00" /></Field>)}
        <Field label="Duties & taxes"><NativeSelect className="field-input" value={f.dutiesMode} onChange={set("dutiesMode")}><option value="PAYABLE_BY_CONSIGNEE">Payable by consignee</option><option value="ESTIMATE">Estimate included</option><option value="FIXED">Fixed amount</option></NativeSelect></Field>
        {f.dutiesMode !== "PAYABLE_BY_CONSIGNEE" && <Field label="Duties amount"><input className="field-input num" inputMode="decimal" value={f.duties} onChange={set("duties")} /></Field>}
        <Field label="Total"><output className="field-input num flex items-center bg-ledger font-medium">{money({ amountMinor: total, currency: cur })}</output></Field>
        <Field label="Partner cost (internal)"><input className="field-input num" inputMode="decimal" value={f.partnerCost} onChange={set("partnerCost")} /></Field>
        <Field label="Transit note" className="col-span-3"><input className="field-input" value={f.transitNote} onChange={set("transitNote")} /></Field>
      </div>
    </FormDialog>
  )
}

export function TrackingDialog({ d, done, open, onOpenChange }: { d: CargoDetail; done: () => Promise<void>; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState({ eventCode: "NOTE", location: "", occurredAt: localNow(), description: "" })
  const submit = async () => { await api(`/v1/admin/cargo/requests/${d.ref}/tracking-events`, { body: { ...f, occurredAt: new Date(f.occurredAt).toISOString(), description: f.description || undefined } }); await done() }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add tracking event…" submitLabel="Add event" onSubmit={submit}>
      <Field label="Event code"><NativeSelect className="field-input" value={f.eventCode} onChange={(e) => setF({ ...f, eventCode: e.target.value })}>{["PICKED_UP", "RECEIVED", "DEPARTED", "ARRIVED", "AT_CUSTOMS", "CLEARED", "OUT_FOR_DELIVERY", "DELIVERED", "HELD", "DAMAGED", "RETURNED", "NOTE"].map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
      <Field label="Location"><input className="field-input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} required minLength={2} /></Field>
      <Field label="Occurred at"><input type="datetime-local" className="field-input" value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} required /></Field>
      <Field label="Description"><input className="field-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
    </FormDialog>
  )
}

const TRACKING_CODES = ["PICKED_UP", "RECEIVED", "DEPARTED", "ARRIVED", "AT_CUSTOMS", "CLEARED", "OUT_FOR_DELIVERY", "DELIVERED", "HELD", "DAMAGED", "RETURNED", "NOTE"]
const toLocalInput = (iso: string) => { const d = new Date(iso); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

/** A correction is appended and points at the row it replaces; the original stays visible here and is hidden from the customer. */
export function TrackingCorrectionDialog({ d, target, done, onClose }: { d: CargoDetail; target: CargoDetail["tracking"][number] | null; done: () => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState({ eventCode: "NOTE", location: "", occurredAt: localNow(), description: "", reason: "" })
  useEffect(() => { if (target) setF({ eventCode: target.eventCode, location: target.location, occurredAt: toLocalInput(target.occurredAt), description: target.description ?? "", reason: "" }) }, [target])
  if (!target) return null
  const submit = async () => {
    await api(`/v1/admin/cargo/requests/${d.ref}/tracking-corrections`, { body: { correctsEventId: target.id, ...f, occurredAt: new Date(f.occurredAt).toISOString(), description: f.description || undefined } })
    await done()
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Correct tracking event…" submitLabel="Append correction" onSubmit={submit} testId="dlg-correct-tracking"
      description="The original stays in the history (audited). The customer sees the corrected state only.">
      <Field label="Event code"><NativeSelect className="field-input" value={f.eventCode} onChange={(e) => setF({ ...f, eventCode: e.target.value })}>{[...TRACKING_CODES, "RETRACTED"].map((c) => <option key={c} value={c}>{c === "RETRACTED" ? "RETRACTED — withdraw this event" : c}</option>)}</NativeSelect></Field>
      <Field label="Location"><input className="field-input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} required minLength={2} /></Field>
      <Field label="Occurred at"><input type="datetime-local" className="field-input" value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} required /></Field>
      <Field label="Description"><input className="field-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Reason (internal)" hint="Recorded in the audit log; never shown to the customer."><textarea className="field-input min-h-16" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={3} dir="auto" /></Field>
    </FormDialog>
  )
}

/** The delivery estimate is shown to the customer labelled as an estimate; clearing removes it. */
export function EstimateDialog({ d, done, open, onOpenChange }: { d: CargoDetail; done: () => Promise<void>; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [at, setAt] = useState("")
  useEffect(() => { if (open) setAt(d.estimatedDeliveryAt ? toLocalInput(d.estimatedDeliveryAt) : "") }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => { await api(`/v1/admin/cargo/requests/${d.ref}/estimated-delivery`, { method: "PUT", body: { estimatedDeliveryAt: at ? new Date(at).toISOString() : null } }); await done() }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Estimated delivery…" submitLabel="Save estimate" onSubmit={submit} testId="dlg-eta" description="Shown to the customer as an estimate, not a promise. Leave empty to clear it.">
      <Field label="Estimated delivery"><input type="datetime-local" className="field-input" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
    </FormDialog>
  )
}
