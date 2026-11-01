"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRef, useState } from "react"

import { type AssignmentResult, ASSIGNABLE_SERVICE_TYPES, InsuranceRegion, type TravellerView, VisaPurpose } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@unitravel/ui/components/dialog"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { codeLabel, CURRENCIES, inDays } from "@/components/club"
import { FormDialog } from "@/components/form-dialog"
import { ServiceStatus, useServiceLabels } from "@/components/service-request"
import { Field } from "@/components/ui"
import { api, newIdempotencyKey } from "@/lib/api"
import { money, toMinor } from "@/lib/format"
import { useT } from "@/lib/i18n"

type Type = (typeof ASSIGNABLE_SERVICE_TYPES)[number]
type LineKind = "SERVICE_FEE" | "THIRD_PARTY_FEE"
interface Row { key: number; kind: LineKind; label: string; amount: string }
let rowKey = 0
const newRow = (): Row => ({ key: ++rowKey, kind: "SERVICE_FEE", label: "", amount: "" })
const KINDS: LineKind[] = ["SERVICE_FEE", "THIRD_PARTY_FEE"]

/**
 * Staff put a service on a customer's account (ADR-0020): `POST /v1/admin/customers/:id/assignments`. The server makes a
 * normal service request for the customer, screens it, claims it and sends the quote in one call. A compliance hold or
 * block is returned, not hidden: nothing here can bypass a policy. CIP at IKA is always held first, so for CIP the quote
 * is not stored and staff send it after release.
 */
export function AssignServiceDialog({ customerId, travellers, onOpenChange }: { customerId: string; travellers: TravellerView[]; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const L = useServiceLabels()
  const qc = useQueryClient()
  const key = useRef(newIdempotencyKey())
  // FormDialog closes itself after a successful submit; here that must show the result instead of closing.
  const submitted = useRef(false)
  const [type, setType] = useState<Type>("HOTEL")
  const [v, setV] = useState<Record<string, string>>({ purpose: "TOURISM", direction: "ARRIVAL", region: "EUROPE", guests: "2", rooms: "1", count: "1" })
  const [people, setPeople] = useState<string[]>([])
  const [currency, setCurrency] = useState<string>("GBP")
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
  const [validUntil, setValidUntil] = useState(() => inDays(3))
  const [quoteNote, setQuoteNote] = useState("")
  const [result, setResult] = useState<AssignmentResult | null>(null)
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }))
  const text = (k: string, label: string, props: React.ComponentProps<"input"> = {}) => <Field label={label}><input className="field-input" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} dir="auto" {...props} /></Field>
  const num = (k: string, label: string, min: number, max: number) => text(k, label, { type: "number", min, max, required: true, className: "field-input num", dir: "ltr" })
  const date = (k: string, label: string, min?: string) => text(k, label, { type: "date", required: true, min, dir: "ltr" })
  const f = (k: string) => codeLabel(t, "svc.f", k)
  const note = (v.note ?? "").trim()

  const details = (): Record<string, unknown> => {
    const n = note ? { note } : {}
    switch (type) {
      case "VISA": return { destinationCountry: (v.country ?? "").trim().toUpperCase(), purpose: v.purpose, travellerIds: people, intendedTravelDate: v.date, ...n }
      case "CIP": return { airport: "IKA", direction: v.direction, flightNumber: (v.flight ?? "").trim().toUpperCase(), date: v.date, passengersCount: Number(v.count), ...n }
      case "INSURANCE": return { destinationRegion: v.region, startDate: v.start, endDate: v.end, travellerIds: people, ...n }
      case "HOTEL": case "STAY": return { location: (v.location ?? "").trim(), checkIn: v.checkIn, checkOut: v.checkOut, guests: Number(v.guests), rooms: Number(v.rooms), ...n }
      default: return { from: (v.from ?? "").trim(), to: (v.to ?? "").trim(), date: v.date, passengers: Number(v.count), ...n }
    }
  }
  const needsTravellers = type === "VISA" || type === "INSURANCE"
  const lines = rows.map((r) => ({ kind: r.kind, label: r.label.trim(), amount: { amountMinor: toMinor(r.amount.replace(",", "."), currency), currency } }))
  const total = lines.reduce((s, l) => s + l.amount.amountMinor, 0)
  const update = (k: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)))

  const submit = async () => {
    if (needsTravellers && !people.length) throw new Error(t("as.travellers.required"))
    const r = await api<AssignmentResult>(`/v1/admin/customers/${customerId}/assignments`, {
      body: { type, details: details(), quote: { lines, validUntil: new Date(validUntil).toISOString(), ...(quoteNote.trim() ? { note: quoteNote.trim() } : {}) } },
      headers: { "idempotency-key": key.current },
    })
    key.current = newIdempotencyKey()
    await qc.invalidateQueries({ queryKey: ["services"] })
    await qc.invalidateQueries({ queryKey: ["customers"] })
    submitted.current = true
    setResult(r)
  }

  if (result) return <AssignmentResultDialog result={result} onClose={() => onOpenChange(false)} />
  return (
    <FormDialog open onOpenChange={(o) => { if (!o && !submitted.current) onOpenChange(false) }} wide title={t("as.title")} description={t("as.desc")} submitLabel={t("as.submit")} onSubmit={submit} testId="dlg-assign">
      <Field label={t("as.type")}>
        <NativeSelect className="field-input" value={type} onChange={(e) => setType(e.target.value as Type)} data-testid="assign-type">
          {ASSIGNABLE_SERVICE_TYPES.map((x) => <option key={x} value={x}>{L.type(x)}</option>)}
        </NativeSelect>
      </Field>
      {type === "CIP" && <p role="note" className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-meta text-warning-subtle-fg" data-testid="cip-held-note"><b>{t("as.cip.title")}</b> {t("as.cip.body")}</p>}

      <fieldset className="space-y-3 rounded-lg border border-rule p-3" data-testid="assign-details">
        <legend className="px-1 text-meta font-medium text-ink">{t("as.details")}</legend>
        {type === "VISA" && (
          <div className="grid gap-3 sm:grid-cols-3">
            {text("country", f("destinationCountry"), { required: true, maxLength: 2, minLength: 2, pattern: "[A-Za-z]{2}", placeholder: "GB", className: "field-input uppercase", dir: "ltr" })}
            <Field label={f("purpose")}><NativeSelect className="field-input" value={v.purpose} onChange={(e) => set("purpose", e.target.value)}>{VisaPurpose.options.map((o) => <option key={o} value={o}>{codeLabel(t, "svc.v", o)}</option>)}</NativeSelect></Field>
            {date("date", f("intendedTravelDate"))}
          </div>
        )}
        {type === "CIP" && (
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={f("airport")}><input className="field-input" value="IKA" readOnly dir="ltr" /></Field>
            <Field label={f("direction")}><NativeSelect className="field-input" value={v.direction} onChange={(e) => set("direction", e.target.value)}>{["ARRIVAL", "DEPARTURE"].map((o) => <option key={o} value={o}>{codeLabel(t, "svc.v", o)}</option>)}</NativeSelect></Field>
            {text("flight", f("flightNumber"), { required: true, pattern: "[A-Za-z0-9]{2,3} ?[0-9]{1,4}[A-Za-z]?", placeholder: "IR 710", className: "field-input uppercase", dir: "ltr" })}
            {date("date", f("date"))}
            {num("count", f("passengersCount"), 1, 20)}
          </div>
        )}
        {type === "INSURANCE" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={f("destinationRegion")}><NativeSelect className="field-input" value={v.region} onChange={(e) => set("region", e.target.value)}>{InsuranceRegion.options.map((o) => <option key={o} value={o}>{codeLabel(t, "svc.v", o)}</option>)}</NativeSelect></Field>
            {date("start", f("startDate"))}
            {date("end", f("endDate"), v.start)}
          </div>
        )}
        {(type === "HOTEL" || type === "STAY") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">{text("location", f("location"), { required: true, minLength: 2, maxLength: 120 })}</div>
            {date("checkIn", f("checkIn"))}
            {date("checkOut", f("checkOut"), v.checkIn)}
            {num("guests", f("guests"), 1, 20)}
            {num("rooms", f("rooms"), 1, 10)}
          </div>
        )}
        {(type === "TRAIN" || type === "BUS") && (
          <div className="grid gap-3 sm:grid-cols-2">
            {text("from", f("from"), { required: true, minLength: 2, maxLength: 120 })}
            {text("to", f("to"), { required: true, minLength: 2, maxLength: 120 })}
            {date("date", f("date"))}
            {num("count", f("passengers"), 1, 20)}
          </div>
        )}
        {needsTravellers && (
          <div>
            <p className="text-meta font-medium text-ink">{f("travellerIds")}</p>
            {!travellers.length ? <p className="mt-1 text-meta text-danger" data-testid="no-travellers">{t("as.travellers.none")}</p> : (
              <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {travellers.map((p) => (
                  <li key={p.id}>
                    <label className="flex min-h-control cursor-pointer items-center gap-2 rounded-lg border border-rule px-3 py-1.5 pointer-coarse:min-h-11">
                      <input type="checkbox" checked={people.includes(p.id)} onChange={(e) => setPeople((x) => e.target.checked ? [...x, p.id] : x.filter((i) => i !== p.id))} />
                      <span dir="auto">{p.givenNames} {p.surname}</span><span className="text-meta text-steel">{p.nationality}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-caption text-steel">{t("as.travellers.hint")}</p>
          </div>
        )}
        <Field label={f("note")}><textarea className="field-input min-h-16" value={v.note ?? ""} onChange={(e) => set("note", e.target.value)} maxLength={1000} dir="auto" /></Field>
      </fieldset>

      <fieldset className="space-y-2" data-testid="assign-lines">
        <legend className="mb-1 text-meta font-medium text-ink">{type === "CIP" ? t("as.lines.cip") : t("as.lines")}</legend>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label={t("q.currency")}><NativeSelect className="field-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
          <Field label={t("q.validUntil")}><input type="datetime-local" className="field-input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required min={inDays(0)} /></Field>
        </div>
        {rows.map((r, i) => (
          <div key={r.key} role="group" aria-label={t("q.line", { n: i + 1 })} className="grid gap-2 rounded-lg border border-rule p-3 sm:grid-cols-[11rem_1fr_8rem_auto] sm:items-end">
            <Field label={t("q.kind")}><NativeSelect className="field-input" value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as LineKind })}>{KINDS.map((k) => <option key={k} value={k}>{codeLabel(t, "q.k", k)}</option>)}</NativeSelect></Field>
            <Field label={t("q.label")}><input className="field-input" value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} required maxLength={120} dir="auto" /></Field>
            <Field label={`${t("q.amount")} (${currency})`}><input className="field-input num" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} required placeholder="0.00" dir="ltr" /></Field>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={rows.length === 1} aria-label={t("q.remove", { n: i + 1 })} className="text-steel hover:text-danger"><Trash2 aria-hidden /></Button>
          </div>
        ))}
        {rows.length < 20 && <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, newRow()])}><Plus aria-hidden />{t("q.add")}</Button>}
        <div className="flex items-baseline justify-between gap-3 border-t border-rule pt-3" aria-live="polite">
          <span className="font-medium">{t("svc.total")}</span>
          <output className={cn("num text-lead font-semibold", total <= 0 && "text-danger")} data-testid="assign-total">{money({ amountMinor: total, currency })}</output>
        </div>
        <Field label={t("q.note")}><textarea className="field-input min-h-14" value={quoteNote} onChange={(e) => setQuoteNote(e.target.value)} maxLength={2000} dir="auto" /></Field>
      </fieldset>
      <p className="text-caption text-steel">{t("as.after")}</p>
    </FormDialog>
  )
}

/** What the API did: a quote sent, or a case held or declined by compliance (shown to staff only). */
function AssignmentResultDialog({ result, onClose }: { result: AssignmentResult; onClose: () => void }) {
  const t = useT()
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="gap-3 p-5 sm:max-w-md" data-testid="dlg-assign-result">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-normal">{result.quoteSent ? t("as.result.sent") : t("as.result.held")}</DialogTitle>
          <DialogDescription className="text-steel">{result.quoteSent ? t("as.result.sent.body", { n: result.quotationNumber ?? "" }) : result.status === "DECLINED" ? t("as.result.declined.body") : t("as.result.held.body")}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5">
          <dt className="text-steel">{t("pg.c.ref")}</dt><dd className="ref font-semibold" dir="ltr">{result.ref}</dd>
          <dt className="text-steel">{t("pg.c.status")}</dt><dd><ServiceStatus value={result.status} /></dd>
          <dt className="text-steel">{t("as.result.quote")}</dt><dd>{result.quoteSent ? <span className="num" dir="ltr">{result.quotationNumber}</span> : t("as.result.notSent")}</dd>
        </dl>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>{t("as.result.close")}</Button>
          <Link href={`/services/${result.ref}`} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/90" data-testid="open-assigned">{t("as.result.open")}</Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
