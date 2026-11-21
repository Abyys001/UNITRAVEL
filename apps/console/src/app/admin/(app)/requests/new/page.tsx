"use client"

import { Plus, Search, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState } from "@/components/bento"
import { Field, PageHead, Panel } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Match { userId: string; displayName: string; email: string | null; phone: string | null; phoneVerified: boolean; cargoRequests: number; lastRef: string | null }
type Pax = { title: string; givenNames: string; surname: string; dateOfBirth: string; genderOnDocument: string; nationality: string; relationship: string; passengerType: string; docNumber: string; docCountry: string; docExpiry: string }
const emptyPax = (first: boolean): Pax => ({ title: "MR", givenNames: "", surname: "", dateOfBirth: "", genderOnDocument: "M", nationality: "IR", relationship: first ? "SELF" : "FAMILY", passengerType: "ADT", docNumber: "", docCountry: "IR", docExpiry: "" })
const ageOn = (dob: string, on: string) => { const a = new Date(on), b = new Date(dob); let y = a.getFullYear() - b.getFullYear(); if (a < new Date(a.getFullYear(), b.getMonth(), b.getDate())) y--; return y }
const place = (code: string) => { const c = code.trim().toUpperCase(); return ["LON", "THR", "IST", "PAR", "NYC", "MIL", "ROM", "DXB"].includes(c) ? { city: c } : { airport: c } }

/** ADR-0044: staff create a manual flight request for a customer; nothing has to be verified to submit. */
export default function NewFlightRequest() {
  const t = useT()
  const router = useRouter()
  const { can } = useSession()
  const [mode, setMode] = useState<"find" | "new">("find")
  const [lookup, setLookup] = useState("")
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [customer, setCustomer] = useState<Match | null>(null)
  const [newCustomer, setNewCustomer] = useState({ name: "", email: "" })
  const [contactPhone, setContactPhone] = useState("")
  const [trip, setTrip] = useState({ tripType: "ONE_WAY", from: "", to: "", date: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10), back: "", cabin: "ECONOMY", flexDays: 2 })
  const [manual, setManual] = useState({ flexibility: "", budget: "", airlinesPrefer: "", airlinesAvoid: "" })
  const [pax, setPax] = useState<Pax[]>([emptyPax(true)])
  const [channel, setChannel] = useState("PHONE")
  const [note, setNote] = useState("")
  const [staffNote, setStaffNote] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!can("flight_request.create.any")) return <div className="p-6"><EmptyState title={t("fnew.noAccess")} /></div>
  const find = async () => {
    setErr(null)
    try { const r = await api<Match[]>(`/v1/admin/intake/customers?q=${encodeURIComponent(lookup.trim())}`); setMatches(r); if (r[0]) setCustomer(r[0]) } catch (e) { setErr(errText(e)) }
  }
  const setP = (i: number, patch: Partial<Pax>) => setPax(pax.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const codes = (s: string) => s.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (mode === "find" && !customer) return setErr(t("new.pickCustomer"))
    setBusy(true)
    try {
      const slices = [{ from: place(trip.from), to: place(trip.to), date: trip.date, flexDays: trip.flexDays }, ...(trip.tripType === "RETURN" ? [{ from: place(trip.to), to: place(trip.from), date: trip.back, flexDays: trip.flexDays }] : [])]
      const passengers = pax.map((p) => (p.passengerType === "CHD" ? { type: "CHD", age: ageOn(p.dateOfBirth, trip.date) } : { type: p.passengerType }))
      const r = await api<{ ref: string }>("/v1/admin/intake/flight-requests", {
        headers: { "idempotency-key": crypto.randomUUID() },
        body: {
          customer: mode === "find" ? { userId: customer!.userId } : newCustomer, contactPhone: contactPhone || undefined,
          query: { tripType: trip.tripType, slices, passengers, cabin: trip.cabin },
          manual: { flexibility: manual.flexibility || undefined, budget: manual.budget ? { amountMinor: Math.round(Number(manual.budget) * 100), currency: "GBP" } : undefined, airlinesPrefer: codes(manual.airlinesPrefer), airlinesAvoid: codes(manual.airlinesAvoid), overlandAcceptable: false },
          travellers: pax.map((p) => ({
            passengerType: p.passengerType,
            traveller: { title: p.title, givenNames: p.givenNames, surname: p.surname, dateOfBirth: p.dateOfBirth, genderOnDocument: p.genderOnDocument, nationality: p.nationality, relationship: p.relationship, ...(p.docNumber ? { document: { number: p.docNumber, issuingCountry: p.docCountry, expiryDate: p.docExpiry } } : {}) },
          })),
          channel, note: note || undefined, staffNote: staffNote || undefined, customerConfirmed: confirmed,
        },
      })
      toast.success(t("new.created", { ref: r.ref }))
      router.push(`/requests/${r.ref}`)
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }
  const sel = (v: string, on: (v: string) => void, opts: [string, string][], testId?: string) => <NativeSelect className="field-input" value={v} onChange={(e) => on(e.target.value)} data-testid={testId}>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
  return (
    <form onSubmit={submit} className="mx-auto max-w-5xl pb-16" data-testid="new-flight">
      <PageHead title={t("fnew.title")} kicker={t("nav.requests")} />
      <p className="px-4 pb-2 text-meta text-steel md:px-6">{t("fnew.intro")}</p>
      <div className="px-4 md:px-6">
        <Panel title={t("new.customer")}>
          <div className="mb-3 flex gap-2">{(["find", "new"] as const).map((m) => <Button key={m} type="button" size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>{t(m === "find" ? "new.existing" : "new.newCustomer")}</Button>)}</div>
          {mode === "find" ? (
            <>
              <div className="flex gap-2"><input className="field-input" dir="ltr" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder={t("fnew.lookupHint")} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void find() } }} data-testid="customer-lookup" /><Button type="button" variant="outline" onClick={() => void find()} disabled={lookup.trim().length < 3}><Search className="size-4" />{t("new.find")}</Button></div>
              {matches && !matches.length && <p className="mt-2 text-meta text-steel">{t("new.noMatch")}</p>}
              {customer && <p className="mt-2 rounded-md bg-success-subtle px-3 py-2 text-meta" data-testid="customer-picked"><b dir="auto">{customer.displayName}</b> · <span dir="ltr">{customer.email ?? customer.phone}</span>{customer.phone && !customer.phoneVerified && ` · ${t("fnew.phoneUnverified")}`}</p>}
            </>
          ) : (
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label={t("new.name")}><input className="field-input" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} required minLength={2} dir="auto" /></Field>
              <Field label={t("ops.edit.email")} hint={t("new.emailHint")}><input type="email" className="field-input" dir="ltr" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} required /></Field>
            </div>
          )}
          <Field label={t("fnew.contactPhone")} hint={t("fnew.contactHint")}><input type="tel" className="field-input" dir="ltr" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} data-testid="contact-phone" /></Field>
        </Panel>
        <Panel title={t("fnew.journey")}>
          <div className="grid gap-x-4 sm:grid-cols-4">
            <Field label={t("fnew.trip")}>{sel(trip.tripType, (v) => setTrip({ ...trip, tripType: v }), [["ONE_WAY", t("fnew.oneWay")], ["RETURN", t("fnew.return")]])}</Field>
            <Field label={t("fnew.from")} hint={t("fnew.codeHint")}><input className="field-input font-mono uppercase" dir="ltr" value={trip.from} onChange={(e) => setTrip({ ...trip, from: e.target.value })} required pattern="[A-Za-z]{3}" maxLength={3} data-testid="from" /></Field>
            <Field label={t("fnew.to")}><input className="field-input font-mono uppercase" dir="ltr" value={trip.to} onChange={(e) => setTrip({ ...trip, to: e.target.value })} required pattern="[A-Za-z]{3}" maxLength={3} data-testid="to" /></Field>
            <Field label={t("fnew.cabin")}>{sel(trip.cabin, (v) => setTrip({ ...trip, cabin: v }), [["ECONOMY", "Economy"], ["PREMIUM_ECONOMY", "Premium economy"], ["BUSINESS", "Business"], ["FIRST", "First"]])}</Field>
            <Field label={t("fnew.depart")}><input type="date" className="field-input" value={trip.date} onChange={(e) => setTrip({ ...trip, date: e.target.value })} required /></Field>
            {trip.tripType === "RETURN" && <Field label={t("fnew.back")}><input type="date" className="field-input" min={trip.date} value={trip.back} onChange={(e) => setTrip({ ...trip, back: e.target.value })} required /></Field>}
            <Field label={t("fnew.flex")}><input type="number" min={0} max={7} className="field-input num" value={trip.flexDays} onChange={(e) => setTrip({ ...trip, flexDays: Number(e.target.value) })} /></Field>
            <Field label={t("fnew.budget")}><input type="number" min={0} className="field-input num" value={manual.budget} onChange={(e) => setManual({ ...manual, budget: e.target.value })} /></Field>
          </div>
          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label={t("fnew.flexibility")}><input className="field-input" value={manual.flexibility} onChange={(e) => setManual({ ...manual, flexibility: e.target.value })} maxLength={500} dir="auto" /></Field>
            <Field label={t("fnew.prefer")}><input className="field-input font-mono uppercase" dir="ltr" value={manual.airlinesPrefer} onChange={(e) => setManual({ ...manual, airlinesPrefer: e.target.value })} placeholder="TK, BA" /></Field>
            <Field label={t("fnew.avoid")}><input className="field-input font-mono uppercase" dir="ltr" value={manual.airlinesAvoid} onChange={(e) => setManual({ ...manual, airlinesAvoid: e.target.value })} /></Field>
          </div>
        </Panel>
        <Panel title={t("fnew.travellers")}>
          <p className="mb-2 text-meta text-steel">{t("fnew.travellersHint")}</p>
          {pax.map((p, i) => (
            <fieldset key={i} className="mb-3 rounded-lg border border-rule p-3" data-testid="pax">
              <div className="grid gap-x-3 sm:grid-cols-4">
                <Field label={t("fnew.type")}>{sel(p.passengerType, (v) => setP(i, { passengerType: v }), [["ADT", t("fnew.adult")], ["CHD", t("fnew.child")], ["INF", t("fnew.infant")]])}</Field>
                <Field label={t("fnew.title_")}>{sel(p.title, (v) => setP(i, { title: v }), ["MR", "MRS", "MS", "MISS", "MSTR", "DR"].map((x) => [x, x]))}</Field>
                <Field label={t("fnew.given")}><input className="field-input uppercase" dir="ltr" value={p.givenNames} onChange={(e) => setP(i, { givenNames: e.target.value })} required minLength={2} /></Field>
                <Field label={t("fnew.surname")}><input className="field-input uppercase" dir="ltr" value={p.surname} onChange={(e) => setP(i, { surname: e.target.value })} required minLength={2} /></Field>
                <Field label={t("fnew.dob")}><input type="date" className="field-input" value={p.dateOfBirth} onChange={(e) => setP(i, { dateOfBirth: e.target.value })} required /></Field>
                <Field label={t("fnew.gender")}>{sel(p.genderOnDocument, (v) => setP(i, { genderOnDocument: v }), [["M", "M"], ["F", "F"], ["X", "X"]])}</Field>
                <Field label={t("fnew.nationality")}><input className="field-input font-mono uppercase" dir="ltr" maxLength={2} value={p.nationality} onChange={(e) => setP(i, { nationality: e.target.value.toUpperCase() })} required pattern="[A-Za-z]{2}" /></Field>
                <Field label={t("fnew.relationship")}>{sel(p.relationship, (v) => setP(i, { relationship: v }), [["SELF", t("fnew.self")], ["FAMILY", t("fnew.family")], ["OTHER", t("fnew.other")]])}</Field>
                <Field label={t("fnew.passport")} hint={t("fnew.passportHint")}><input className="field-input font-mono uppercase" dir="ltr" value={p.docNumber} onChange={(e) => setP(i, { docNumber: e.target.value.toUpperCase() })} /></Field>
                {p.docNumber && <Field label={t("fnew.issuer")}><input className="field-input font-mono uppercase" dir="ltr" maxLength={2} value={p.docCountry} onChange={(e) => setP(i, { docCountry: e.target.value.toUpperCase() })} required /></Field>}
                {p.docNumber && <Field label={t("fnew.expiry")}><input type="date" className="field-input" value={p.docExpiry} onChange={(e) => setP(i, { docExpiry: e.target.value })} required /></Field>}
              </div>
              {pax.length > 1 && <Button type="button" size="xs" variant="ghost" onClick={() => setPax(pax.filter((_, j) => j !== i))}><Trash2 className="size-3.5" />{t("agt.remove")}</Button>}
            </fieldset>))}
          <Button type="button" size="sm" variant="outline" onClick={() => setPax([...pax, emptyPax(false)])} disabled={pax.length >= 9}><Plus className="size-4" />{t("fnew.addTraveller")}</Button>
        </Panel>
        <Panel title={t("new.confirm")}>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label={t("new.channel")}>{sel(channel, setChannel, ["PHONE", "IN_PERSON", "EMAIL", "OTHER"].map((c) => [c, t(`new.ch.${c}` as never)]))}</Field>
            <Field label={t("fnew.customerNote")}><input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} dir="auto" /></Field>
          </div>
          <Field label={t("new.staffNote")}><textarea className="field-input min-h-14" value={staffNote} onChange={(e) => setStaffNote(e.target.value)} maxLength={1000} dir="auto" /></Field>
          <label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4 accent-orange" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required data-testid="customer-confirmed" /><span>{t("fnew.customerConfirmed")}</span></label>
          <p className="mt-2 text-caption text-steel">{t("fnew.screening")}</p>
        </Panel>
        {err && <p role="alert" className="mb-3 rounded-md bg-danger-subtle px-3 py-2 text-danger">{err}</p>}
        <Button type="submit" className="h-12 w-full sm:w-auto" loading={busy} data-testid="new-submit">{t("fnew.submit")}</Button>
      </div>
    </form>
  )
}
