"use client"

import { useEffect, useState } from "react"

import { validateTicketNumber } from "@unitravel/domain"

import { FormDialog } from "@/components/form-dialog"
import { Field } from "@/components/ui"
import { api, newIdempotencyKey } from "@/lib/api"
import { toMajor, toMinor } from "@/lib/format"
import type { FlightDetail, PaymentRecordingState } from "@/lib/types"
import { NativeSelect } from "@unitravel/ui/components/native-select"

type Bind = { open: boolean; onOpenChange: (o: boolean) => void }
const localNow = (plusHours = 0) => { const d = new Date(Date.now() + plusHours * 3600_000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const iso = (local: string) => new Date(local).toISOString()

export function accepted(d: FlightDetail) {
  const q = d.quotes.find((x) => x.status === "ACCEPTED")
  return q ? { quote: q, option: q.options.find((o) => o.id === q.acceptedOptionId) } : null
}

/** Reservation / PNR (ch. 13.7): locator, airline locators, deadline; must refer to the accepted option. */
export function ReservationDialog({ d, done, ...bind }: Bind & { d: FlightDetail; done: () => Promise<void> }) {
  const acc = accepted(d)
  const [f, setF] = useState({ system: "AMADEUS_TERMINAL", recordLocator: "", airline: "", deadline: localNow(48), status: "HELD", mismatch: "", travellers: d.travellers.map((t) => t.travellerId) })
  useEffect(() => { if (bind.open) setF((x) => ({ ...x, travellers: d.travellers.map((t) => t.travellerId) })) }, [bind.open, d.travellers])
  const submit = async () => {
    if (!acc?.option) throw new Error("No accepted quote option to reserve")
    const airlineLocators = Object.fromEntries(f.airline.split(/[,\s]+/).filter(Boolean).map((p) => p.split(":").map((s) => s.trim().toUpperCase()) as [string, string]))
    await api(`/v1/admin/flight-requests/${d.ref}/reservations`, {
      body: { system: f.system, recordLocator: f.recordLocator.toUpperCase(), airlineLocators, ticketingDeadline: iso(f.deadline), quoteOptionId: acc.option.id, travellerIds: f.travellers, slices: acc.option.slices, status: f.status, mismatchReason: f.mismatch || undefined },
      headers: { "if-match": String(d.version), "idempotency-key": newIdempotencyKey() },
    })
    await done()
  }
  return (
    <FormDialog {...bind} title="Record reservation…" description={acc?.option ? <>For accepted option “{acc.option.label}”. Mirror exactly what the reservation system shows.</> : "There is no accepted option yet."} submitLabel="Record reservation" onSubmit={submit} testId="dlg-reservation">
      <div className="grid grid-cols-2 gap-3">
        <Field label="System"><NativeSelect className="field-input" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })}>{["AMADEUS_TERMINAL", "DUFFEL_API", "PARTNER", "AIRLINE_DIRECT"].map((s) => <option key={s}>{s}</option>)}</NativeSelect></Field>
        <Field label="Record locator (PNR)"><input className="field-input font-mono uppercase" value={f.recordLocator} onChange={(e) => setF({ ...f, recordLocator: e.target.value.toUpperCase() })} pattern="[A-Za-z0-9]{6}" maxLength={6} required dir="ltr" /></Field>
        <Field label="Airline locators" hint="Carrier:locator, comma separated — TK:ABC12D"><input className="field-input font-mono" value={f.airline} onChange={(e) => setF({ ...f, airline: e.target.value })} dir="ltr" /></Field>
        <Field label="Ticketing deadline"><input type="datetime-local" className="field-input" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} required /></Field>
        <Field label="Status"><NativeSelect className="field-input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option>HELD</option><option>CONFIRMED</option></NativeSelect></Field>
        <Field label="Mismatch reason" hint="Only if the booked itinerary differs from the option"><input className="field-input" value={f.mismatch} onChange={(e) => setF({ ...f, mismatch: e.target.value })} /></Field>
      </div>
      <fieldset><legend className="cap">Travellers in this PNR</legend>
        {d.travellers.map((t) => <label key={t.travellerId} className="mt-1 flex items-center gap-2"><input type="checkbox" checked={f.travellers.includes(t.travellerId)} onChange={(e) => setF({ ...f, travellers: e.target.checked ? [...f.travellers, t.travellerId] : f.travellers.filter((x) => x !== t.travellerId) })} />{t.name.givenNames} {t.name.surname} <span className="text-steel">· {t.passengerType}</span></label>)}
      </fieldset>
    </FormDialog>
  )
}

/** Ticket numbers (13 digits, prefix = validating carrier's accounting code — the API checks the code). */
export function TicketsDialog({ d, done, ...bind }: Bind & { d: FlightDetail; done: () => Promise<void> }) {
  const res = d.reservations.find((r) => r.status === "HELD" || r.status === "CONFIRMED")
  const acc = accepted(d)
  const firstCarrier = acc?.option?.slices[0]?.segments[0]?.marketing.carrier ?? ""
  const [rows, setRows] = useState(d.travellers.map((t) => ({ travellerId: t.travellerId, ticketNumber: "", carrier: firstCarrier })))
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [withPayment, setWithPayment] = useState(d.atolMode === "PAY_ON_TICKETING" && d.paymentStatus !== "PAID")
  const [pay, setPay] = useState({ amount: acc?.option ? String(acc.option.priceBreakdown.total.amountMinor / 100) : "", currency: acc?.option?.priceBreakdown.total.currency ?? "GBP", method: "BANK_TRANSFER", ref: "", payer: "", received: localNow() })
  const [override, setOverride] = useState("")
  useEffect(() => { if (bind.open) setRows(d.travellers.map((t) => ({ travellerId: t.travellerId, ticketNumber: "", carrier: firstCarrier }))) }, [bind.open, d.travellers, firstCarrier])
  const coupons = (acc?.option?.slices ?? []).flatMap((s, si) => s.segments.map((_, gi) => ({ sliceIndex: si, segmentIndex: gi })))
  const submit = async () => {
    if (!res) throw new Error("Record the reservation first")
    await api(`/v1/admin/flight-requests/${d.ref}/tickets`, {
      body: {
        reservationId: res.id,
        tickets: rows.map((r) => ({ travellerId: r.travellerId, ticketNumber: r.ticketNumber, validatingCarrier: r.carrier.toUpperCase(), issueDate, coupons: coupons.length ? coupons : [{ sliceIndex: 0, segmentIndex: 0 }] })),
        payment: withPayment ? { amount: { amountMinor: toMinor(pay.amount, pay.currency), currency: pay.currency }, method: pay.method, receivedAt: iso(pay.received), externalReference: pay.ref, payerName: pay.payer } : undefined,
        creditOverride: !withPayment && override ? { reason: override } : undefined,
      },
      headers: { "if-match": String(d.version), "idempotency-key": newIdempotencyKey() },
    })
    await done()
  }
  return (
    <FormDialog {...bind} wide title="Record tickets…" description={<>Against reservation <span className="num">{res?.recordLocator ?? "—"}</span>. ATOL mode <span className="num">{d.atolMode}</span>.</>} submitLabel="Record tickets" onSubmit={submit} testId="dlg-tickets">
      <table className="w-full">
        <thead><tr>{["Traveller", "Ticket number", "Carrier", ""].map((h) => <th key={h} className="cap py-1 text-start font-normal">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const t = d.travellers.find((x) => x.travellerId === r.travellerId)!
            const fmt = r.ticketNumber ? (/^\d{13}$/.test(r.ticketNumber) ? null : "13 digits") : null
            const prefix = r.ticketNumber.length === 13 ? validateTicketNumber(r.ticketNumber, r.ticketNumber.slice(0, 3)) : null
            return (
              <tr key={r.travellerId} className="align-top">
                <td className="py-1 pe-2">{t.name.givenNames} {t.name.surname}</td>
                <td className="py-1 pe-2"><input aria-label={`Ticket number for ${t.name.surname}`} className="field-input font-mono" inputMode="numeric" maxLength={13} value={r.ticketNumber} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ticketNumber: e.target.value.replace(/\D/g, "") } : x)))} required dir="ltr" aria-invalid={!!fmt} />{fmt && <span className="text-[11px] text-danger">{fmt}</span>}{prefix?.ok && <span className="text-[11px] text-steel">Prefix {r.ticketNumber.slice(0, 3)} — checked against {r.carrier || "the carrier"}&apos;s accounting code on save</span>}</td>
                <td className="w-24 py-1 pe-2"><input aria-label="Validating carrier" className="field-input font-mono uppercase" maxLength={3} value={r.carrier} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, carrier: e.target.value.toUpperCase() } : x)))} required dir="ltr" /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Field label="Issue date" className="w-48"><input type="date" className="field-input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required /></Field>
      <label className="flex items-center gap-2"><input type="checkbox" checked={withPayment} onChange={(e) => setWithPayment(e.target.checked)} /> Record the customer&apos;s payment in this step (PAY_ON_TICKETING)</label>
      {withPayment ? <PaymentFields p={pay} set={setPay} /> : <Field label="Credit override reason" hint="Only with an owner-approved credit override on this request"><input className="field-input" value={override} onChange={(e) => setOverride(e.target.value)} /></Field>}
    </FormDialog>
  )
}

type Pay = { amount: string; currency: string; method: string; ref: string; payer: string; received: string }
function PaymentFields({ p, set }: { p: Pay; set: (p: Pay) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="Amount"><input className="field-input num" inputMode="decimal" value={p.amount} onChange={(e) => set({ ...p, amount: e.target.value })} required dir="ltr" /></Field>
      <Field label="Currency"><input className="field-input font-mono uppercase" maxLength={3} value={p.currency} onChange={(e) => set({ ...p, currency: e.target.value.toUpperCase() })} required /></Field>
      <Field label="Method"><NativeSelect className="field-input" value={p.method} onChange={(e) => set({ ...p, method: e.target.value })}>{["BANK_TRANSFER", "CASH", "CARD_TERMINAL", "OTHER"].map((m) => <option key={m}>{m}</option>)}</NativeSelect></Field>
      <Field label="External reference"><input className="field-input font-mono" value={p.ref} onChange={(e) => set({ ...p, ref: e.target.value })} required /></Field>
      <Field label="Payer name"><input className="field-input" value={p.payer} onChange={(e) => set({ ...p, payer: e.target.value })} required minLength={2} dir="auto" /></Field>
      <Field label="Received at"><input type="datetime-local" className="field-input" value={p.received} onChange={(e) => set({ ...p, received: e.target.value })} required /></Field>
    </div>
  )
}

/** Payment record (ch. 27.6); above the four-eyes threshold a different person verifies it. */
export function PaymentDialog({ d, done, product = "flight", ...bind }: Bind & { d: { ref: string; paymentRecording?: PaymentRecordingState }; product?: "flight" | "cargo"; done: () => Promise<void> }) {
  const fresh = (): Pay => {
    const s = d.paymentRecording?.suggestedAmount
    return { amount: s && s.amountMinor > 0 ? toMajor(s.amountMinor, s.currency) : "", currency: s?.currency ?? "GBP", method: "BANK_TRANSFER", ref: "", payer: "", received: localNow() }
  }
  const [p, setP] = useState<Pay>(fresh)
  // Pre-fill the outstanding amount each time the dialog opens (ADR-0008 W8).
  useEffect(() => { if (bind.open) setP(fresh()) }, [bind.open]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    await api(`/v1/admin/${product === "cargo" ? "cargo/requests" : "flight-requests"}/${d.ref}/payments`, { body: { amount: { amountMinor: toMinor(p.amount, p.currency), currency: p.currency }, method: p.method, receivedAt: iso(p.received), externalReference: p.ref, payerName: p.payer }, headers: { "idempotency-key": newIdempotencyKey() } })
    await done()
  }
  return <FormDialog {...bind} wide title="Record payment…" description="Mirror a payment received outside the platform. The payer is screened before it is recorded." submitLabel="Record payment" onSubmit={submit} testId="dlg-payment"><PaymentFields p={p} set={setP} /></FormDialog>
}

/** Credit override request: ticket before payment, needs an owner's approval (four-eyes). */
export function CreditOverrideDialog({ d, done, ...bind }: Bind & { d: FlightDetail; done: () => Promise<void> }) {
  const [reason, setReason] = useState("")
  const submit = async () => { await api(`/v1/admin/flight-requests/${d.ref}/credit-override`, { body: { reason } }); await done() }
  return (
    <FormDialog {...bind} title="Request credit override…" description="Lets tickets be issued before the customer pays. An owner other than you must approve it." submitLabel="Request override" onSubmit={submit}>
      <Field label="Reason"><textarea className="field-input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required /></Field>
    </FormDialog>
  )
}

export function AfterSalesDialog({ d, done, ...bind }: Bind & { d: FlightDetail; done: () => Promise<void> }) {
  const issued = d.tickets.filter((t) => t.status === "ISSUED")
  const [f, setF] = useState({ type: "CHANGE", ticketIds: issued.map((t) => t.id), note: "" })
  const submit = async () => { await api(`/v1/admin/flight-requests/${d.ref}/after-sales`, { body: f }); await done() }
  return (
    <FormDialog {...bind} title="Open after-sales case…" description="Change, refund or cancellation of issued tickets. Opens a UT-A case." submitLabel="Open case" onSubmit={submit}>
      <Field label="Type"><NativeSelect className="field-input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option>CHANGE</option><option>REFUND</option><option>CANCEL</option></NativeSelect></Field>
      <fieldset><legend className="cap">Tickets</legend>{issued.map((t) => <label key={t.id} className="mt-1 flex items-center gap-2"><input type="checkbox" checked={f.ticketIds.includes(t.id)} onChange={(e) => setF({ ...f, ticketIds: e.target.checked ? [...f.ticketIds, t.id] : f.ticketIds.filter((x) => x !== t.id) })} /><span className="num">{t.ticketNumber}</span> {t.travellerName}</label>)}</fieldset>
      <Field label="Note"><textarea className="field-input min-h-20" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required /></Field>
    </FormDialog>
  )
}
