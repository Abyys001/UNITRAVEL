"use client"

import { useEffect, useState } from "react"

import type { SearchQuery } from "@unitravel/contracts"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { FormDialog } from "@/components/form-dialog"
import { Field } from "@/components/ui"
import { api } from "@/lib/api"
import type { FlightDetail } from "@/lib/types"

type Place = SearchQuery["slices"][number]["from"]
const code = (p: Place) => ("city" in p ? p.city : p.airport)
/** Three letters: a city code where the reference data has one, otherwise an airport; the server validates either. */
const place = (s: string, was: Place): Place => ("city" in was ? { city: s.trim().toUpperCase() } : { airport: s.trim().toUpperCase() })
const CABINS = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] as const

/**
 * Staff amendment of the trip (ADR-0013 A1-A4): route, dates and cabin, with a reason. Travellers change through the same
 * endpoint (`travellers`), which this dialog leaves as they are. The open quote, if any, is never rewritten.
 */
export function AmendDialog({ d, open, onOpenChange, done }: { d: FlightDetail; open: boolean; onOpenChange: (o: boolean) => void; done: () => Promise<void> }) {
  const [slices, setSlices] = useState(d.query.slices)
  const [cabin, setCabin] = useState(d.query.cabin)
  const [reason, setReason] = useState("")
  const [ack, setAck] = useState(false)
  useEffect(() => { if (open) { setSlices(d.query.slices); setCabin(d.query.cabin); setReason(""); setAck(false) } }, [open, d.query])
  const setSlice = (i: number, patch: Partial<SearchQuery["slices"][number]>) => setSlices(slices.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} wide testId="amend-dialog" title="Amend trip…" submitLabel="Save amendment"
      description="Changes what the customer asked for; the status stays. Previous and new values are kept in the history and the customer is told."
      onSubmit={async () => {
        await api(`/v1/admin/flight-requests/${d.ref}/amend`, { body: { expectedVersion: d.version, reason, query: { ...d.query, slices, cabin }, ...(d.amendment.needsAcknowledge ? { acknowledgeOpenQuote: ack } : {}) } })
        await done()
      }}>
      {slices.map((s, i) => (
        <fieldset key={i} className="grid grid-cols-[1fr_1fr_1.4fr_0.8fr] items-end gap-2" data-testid={`amend-slice-${i}`}>
          <legend className="cap mb-1">Flight {i + 1}</legend>
          <Field label="From"><input className="field-input uppercase" required maxLength={3} minLength={3} value={code(s.from)} onChange={(e) => setSlice(i, { from: place(e.target.value, s.from) })} /></Field>
          <Field label="To"><input className="field-input uppercase" required maxLength={3} minLength={3} value={code(s.to)} onChange={(e) => setSlice(i, { to: place(e.target.value, s.to) })} /></Field>
          <Field label="Date"><input className="field-input num" type="date" required value={s.date} onChange={(e) => setSlice(i, { date: e.target.value })} /></Field>
          <Field label="± days"><input className="field-input num" type="number" min={0} max={3} value={s.flexDays ?? 0} onChange={(e) => setSlice(i, { flexDays: Number(e.target.value) })} /></Field>
        </fieldset>
      ))}
      <Field label="Cabin" className="max-w-xs"><NativeSelect className="field-input" value={cabin} onChange={(e) => setCabin(e.target.value as typeof cabin)}>{CABINS.map((c) => <option key={c} value={c}>{c.replace("_", " ").toLowerCase()}</option>)}</NativeSelect></Field>
      <Field label="Reason (internal, at least 5 characters)"><textarea className="field-input min-h-16" required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer phoned: travel one week later" /></Field>
      {d.amendment.needsAcknowledge && (
        <label className="flex items-start gap-2 rounded-sm border border-warning bg-warning-subtle px-2 py-1.5">
          <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} required />
          <span>A quote is already out. It will <strong>not</strong> change: send a new quote for the amended trip (it replaces the old one).</span>
        </label>
      )}
    </FormDialog>
  )
}
