"use client"

import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Search } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { type CreateTicketDocumentBody, type CustomerListPage, TICKET_DOCUMENT_KINDS, type TicketDocumentKind, type TicketDocumentRecords, type TicketDocumentStaffDetail } from "@unitravel/contracts"
import { normaliseReference, validateTicketNumber } from "@unitravel/domain"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { ListSkeleton, StateChip } from "@/components/case"
import { Check, Segmented } from "@/components/controls"
import { accepted, iso, localNow, type Pay, PaymentFields } from "@/components/flight/records"
import { Arrow, ErrorLine, Field, PageHead, Panel, RouteText } from "@/components/ui"
import { api, newIdempotencyKey } from "@/lib/api"
import { fmtDate, fmtDateTime, toMinor } from "@/lib/format"
import { useDebounced } from "@/lib/hooks"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import type { FlightDetail, FlightListItem, Page } from "@/lib/types"

import { IssueControls } from "./actions"
import { IntegrityPanel, kindLabel, PdfDrop, PreviewPair, TicketErrorLine } from "./shared"

const DRAFTABLE = ["ACCEPTED", "RESERVED", "TICKETED", "COMPLETED"]
type Step = "booking" | "travellers" | "upload" | "records" | "details" | "preview"
const STEP_LABEL: Record<Step, MsgKey> = { booking: "td.step.booking", travellers: "td.step.travellers", upload: "td.step.upload", records: "td.step.records", details: "td.step.details", preview: "td.step.preview" }

const activeReservation = (d: FlightDetail) => d.reservations.find((r) => r.status === "HELD" || r.status === "CONFIRMED")
const issuedTicket = (d: FlightDetail, travellerId: string) => d.tickets.find((tk) => tk.travellerId === travellerId && tk.status === "ISSUED")
const travellerName = (d: FlightDetail, id: string) => { const x = d.travellers.find((tr) => tr.travellerId === id); return x ? `${x.name.givenNames} ${x.name.surname}` : id }

function Stepper({ steps, current, onPick, reached }: { steps: Step[]; current: Step; onPick: (s: Step) => void; reached: Set<Step> }) {
  const t = useT()
  const at = steps.indexOf(current)
  return (
    <nav aria-label={t("td.wizard.steps")} className="px-4 md:px-6">
      <p className="mb-2 text-meta text-steel sm:hidden" aria-live="polite">{t("td.wizard.stepOf", { n: at + 1, m: steps.length })} · <span className="font-medium text-ink">{t(STEP_LABEL[current])}</span></p>
      <ol className="hidden flex-wrap gap-1.5 sm:flex" data-testid="wizard-steps">
        {steps.map((s, i) => {
          const done = i < at, here = s === current, can = reached.has(s) && !here
          return (
            <li key={s}>
              <button type="button" disabled={!can} onClick={() => onPick(s)} aria-current={here ? "step" : undefined}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-meta font-medium", here ? "border-navy-900 bg-navy-900 text-white dark:border-[#bcd9ff] dark:bg-[#bcd9ff] dark:text-[#0b1220]" : done ? "border-success/50 text-success" : "border-rule-strong text-steel", can && "hover:border-control")}>
                <span className="num">{done ? "✓" : i + 1}</span>{t(STEP_LABEL[s])}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Customer → their flight request. A reference typed directly skips the customer search. */
function BookingStep({ onPick }: { onPick: (ref: string) => void }) {
  const t = useT()
  const { can } = useSession()
  const [q, setQ] = useState("")
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null)
  const dq = useDebounced(q.trim())
  const asRef = normaliseReference(dq)
  const customers = useQuery({ queryKey: ["td-customers", dq], queryFn: () => api<CustomerListPage>(`/v1/admin/customers?limit=8&q=${encodeURIComponent(dq)}`), enabled: can("customer.read") && dq.length >= 2 && !asRef?.startsWith("UT-F-") })
  // The staff list filters by one status at a time, so the four draftable states are fetched for this customer in parallel.
  const requests = useQuery({
    queryKey: ["td-customer-requests", customer?.id],
    enabled: !!customer,
    queryFn: async () => (await Promise.all(DRAFTABLE.map((s) => api<Page<FlightListItem>>(`/v1/admin/flight-requests?status=${s}&customerUserId=${encodeURIComponent(customer!.id)}&limit=100`)))).flatMap((p) => p.items).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
  })
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={t("td.booking.customer")}>
        <label className="relative block">
          <span className="sr-only">{t("td.booking.search")}</span>
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-ink-subtle" aria-hidden />
          <input type="search" className="field-input field-search" value={q} onChange={(e) => { setQ(e.target.value); setCustomer(null) }} placeholder={t("td.booking.search")} dir="auto" autoFocus data-testid="customer-search" />
        </label>
        {asRef?.startsWith("UT-F-") && <Button className="mt-3" size="sm" onClick={() => onPick(asRef)} data-testid="use-ref">{t("td.booking.useRef", { ref: asRef })} <Arrow /></Button>}
        <ErrorLine error={customers.error} />
        {customers.data && (
          <ul className="mt-3 divide-y divide-rule rounded-md border border-rule" data-testid="customer-results">
            {!customers.data.items.length && <li className="px-3 py-3 text-steel">{t("td.booking.noCustomer")}</li>}
            {customers.data.items.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setCustomer({ id: c.id, name: c.displayName })} aria-pressed={customer?.id === c.id} className={cn("flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start hover:bg-hover pointer-coarse:py-3.5", customer?.id === c.id && "bg-info-subtle")}>
                  <span className="min-w-0"><span className="block truncate font-medium" dir="auto">{c.displayName}</span><span className="block truncate text-meta text-steel" dir="ltr">{[c.email, c.phone].filter(Boolean).join(" · ")}</span></span>
                  {c.openRequests > 0 && <span className="num shrink-0 text-meta text-steel">{t("td.booking.open", { n: c.openRequests })}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!can("customer.read") && <p className="mt-2 text-meta text-steel">{t("td.booking.refOnly")}</p>}
      </Panel>
      <Panel title={t("td.booking.requests")}>
        {!customer ? <p className="text-steel">{t("td.booking.pickCustomer")}</p> : requests.isLoading ? <ListSkeleton rows={3} /> : requests.error ? <ErrorLine error={requests.error} /> : !requests.data?.length ? <p className="text-steel">{t("td.booking.none")}</p> : (
          <ul className="space-y-2" data-testid="request-results">
            {requests.data.map((r) => (
              <li key={r.ref}>
                <button type="button" onClick={() => onPick(r.ref)} className="w-full rounded-md border border-rule bg-surface-raised px-3 py-2.5 text-start hover:border-control">
                  <span className="flex items-center justify-between gap-2"><span className="ref font-semibold">{r.ref}</span><StateChip value={r.status} /></span>
                  <span className="mt-0.5 block text-meta"><RouteText>{r.routeLabel}</RouteText> · {fmtDate(r.firstTravelDate)} · {t("td.booking.pax", { n: r.travellers })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

interface RecordsForm {
  res: { system: string; recordLocator: string; externalReference: string; airline: string; deadline: string; status: string; mismatch: string; note: string }
  rows: { travellerId: string; ticketNumber: string; carrier: string }[]
  issueDate: string; withPayment: boolean; pay: Pay; override: string
}

function freshRecords(d: FlightDetail, travellerIds: string[]): RecordsForm {
  const acc = accepted(d)
  const carrier = acc?.option?.slices[0]?.segments[0]?.marketing.carrier ?? ""
  return {
    res: { system: "AMADEUS_TERMINAL", recordLocator: "", externalReference: "", airline: "", deadline: localNow(48), status: "CONFIRMED", mismatch: "", note: "" },
    rows: travellerIds.filter((id) => !issuedTicket(d, id)).map((travellerId) => ({ travellerId, ticketNumber: "", carrier })),
    issueDate: new Date().toISOString().slice(0, 10),
    withPayment: d.atolMode === "PAY_ON_TICKETING" && d.paymentStatus !== "PAID",
    pay: { amount: acc?.option ? String(acc.option.priceBreakdown.total.amountMinor / 100) : "", currency: acc?.option?.priceBreakdown.total.currency ?? "GBP", method: "BANK_TRANSFER", ref: "", payer: "", received: localNow() },
    override: "",
  }
}

/** D5: the same fields as the reservation and tickets dialogs; the API runs record_reservation / record_tickets on issue. */
function buildRecords(d: FlightDetail, f: RecordsForm): TicketDocumentRecords | undefined {
  const acc = accepted(d)
  const res = activeReservation(d)
  const reservation = !res && acc?.option ? {
    system: f.res.system as "AMADEUS_TERMINAL", recordLocator: f.res.recordLocator.trim() ? f.res.recordLocator.toUpperCase() : undefined, externalReference: f.res.externalReference.trim() || undefined,
    note: f.res.note.trim() || undefined, airlineLocators: Object.fromEntries(f.res.airline.split(/[,\s]+/).filter(Boolean).map((p) => p.split(":").map((s) => s.trim().toUpperCase()) as [string, string])),
    ticketingDeadline: iso(f.res.deadline), quoteOptionId: acc.option.id, travellerIds: d.travellers.map((x) => x.travellerId), slices: acc.option.slices, status: f.res.status as "HELD" | "CONFIRMED", mismatchReason: f.res.mismatch || undefined,
  } : undefined
  const coupons = (acc?.option?.slices ?? []).flatMap((s, si) => s.segments.map((_, gi) => ({ sliceIndex: si, segmentIndex: gi })))
  const tickets = f.rows.length ? {
    reservationId: res?.id,
    tickets: f.rows.map((r) => ({ travellerId: r.travellerId, ticketNumber: r.ticketNumber, validatingCarrier: r.carrier.toUpperCase(), issueDate: f.issueDate, coupons: coupons.length ? coupons : [{ sliceIndex: 0, segmentIndex: 0 }] })),
    payment: f.withPayment ? { amount: { amountMinor: toMinor(f.pay.amount, f.pay.currency), currency: f.pay.currency }, method: f.pay.method as "BANK_TRANSFER", receivedAt: iso(f.pay.received), externalReference: f.pay.ref, payerName: f.pay.payer } : undefined,
    creditOverride: !f.withPayment && f.override.trim() ? { reason: f.override.trim() } : undefined,
  } : undefined
  return reservation || tickets ? { reservation, tickets } : undefined
}

function RecordsStep({ d, f, set }: { d: FlightDetail; f: RecordsForm; set: (f: RecordsForm) => void }) {
  const t = useT()
  const res = activeReservation(d)
  const acc = accepted(d)
  const setRes = (patch: Partial<RecordsForm["res"]>) => set({ ...f, res: { ...f.res, ...patch } })
  return (
    <div className="space-y-4" data-testid="records-step">
      <p className="text-steel">{t("td.rec.intro")}</p>
      <Panel title={t("td.rec.reservation")}>
        {res ? <p data-testid="rec-has-res">{t("td.rec.hasRes")} <span className="num font-medium">{res.recordLocator ?? res.externalReference}</span> · <StateChip value={res.status} /></p> : !acc?.option ? <p className="text-danger">{t("td.rec.noOption")}</p> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("td.rec.system")}><NativeSelect className="field-input" value={f.res.system} onChange={(e) => setRes({ system: e.target.value })}>{["AMADEUS_TERMINAL", "DUFFEL_API", "PARTNER", "AIRLINE_DIRECT"].map((s) => <option key={s}>{s}</option>)}</NativeSelect></Field>
            <Field label={t("td.rec.pnr")} hint={t("res.pnr.hint")}><input className="field-input font-mono uppercase" value={f.res.recordLocator} onChange={(e) => setRes({ recordLocator: e.target.value.toUpperCase() })} pattern="[A-Za-z0-9]{6}" maxLength={6} required={!f.res.externalReference.trim()} dir="ltr" data-testid="rec-pnr" /></Field>
            <Field label={t("res.extRef")} hint={t("res.extRef.hint")}><input className="field-input font-mono" value={f.res.externalReference} onChange={(e) => setRes({ externalReference: e.target.value })} maxLength={64} required={!f.res.recordLocator.trim()} dir="ltr" /></Field>
            <Field label={t("td.rec.airline")} hint={t("td.rec.airlineHint")}><input className="field-input font-mono" value={f.res.airline} onChange={(e) => setRes({ airline: e.target.value })} dir="ltr" /></Field>
            <Field label={t("td.rec.deadline")}><input type="datetime-local" className="field-input" value={f.res.deadline} onChange={(e) => setRes({ deadline: e.target.value })} required /></Field>
            <Field label={t("td.rec.status")}><NativeSelect className="field-input" value={f.res.status} onChange={(e) => setRes({ status: e.target.value })}><option>HELD</option><option>CONFIRMED</option></NativeSelect></Field>
            <Field label={t("td.rec.mismatch")} hint={t("td.rec.mismatchHint")}><input className="field-input" value={f.res.mismatch} onChange={(e) => setRes({ mismatch: e.target.value })} dir="auto" /></Field>
            <Field label={t("res.note")}><input className="field-input" value={f.res.note} onChange={(e) => setRes({ note: e.target.value })} maxLength={2000} dir="auto" /></Field>
          </div>
        )}
      </Panel>
      <Panel title={t("td.rec.tickets")}>
        {!f.rows.length ? <p data-testid="rec-has-tickets">{t("td.rec.hasTickets")}</p> : (
          <div className="space-y-3">
            <ul className="space-y-3">
              {f.rows.map((r, i) => {
                const fmt = r.ticketNumber && !/^\d{13}$/.test(r.ticketNumber)
                const prefix = r.ticketNumber.length === 13 ? validateTicketNumber(r.ticketNumber, r.ticketNumber.slice(0, 3)) : null
                const upd = (patch: Partial<typeof r>) => set({ ...f, rows: f.rows.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
                return (
                  <li key={r.travellerId} className="grid gap-2 rounded-md border border-rule p-3 sm:grid-cols-[minmax(0,1fr)_14rem_6rem] sm:items-start">
                    <p className="font-medium sm:pt-2" dir="auto">{travellerName(d, r.travellerId)}</p>
                    <Field label={t("td.ticketNo")}><input className="field-input font-mono" inputMode="numeric" maxLength={13} value={r.ticketNumber} onChange={(e) => upd({ ticketNumber: e.target.value.replace(/\D/g, "") })} required dir="ltr" aria-invalid={!!fmt} data-testid={`rec-ticket-${i}`} /></Field>
                    <Field label={t("td.rec.carrier")}><input className="field-input font-mono uppercase" maxLength={3} value={r.carrier} onChange={(e) => upd({ carrier: e.target.value.toUpperCase() })} required dir="ltr" /></Field>
                    {fmt && <p className="text-caption text-danger sm:col-span-3">{t("td.rec.13digits")}</p>}
                    {prefix?.ok && <p className="text-caption text-steel sm:col-span-3">{t("td.rec.prefix", { p: r.ticketNumber.slice(0, 3) })}</p>}
                  </li>
                )
              })}
            </ul>
            <Field label={t("td.rec.issueDate")} className="w-48"><input type="date" className="field-input" value={f.issueDate} onChange={(e) => set({ ...f, issueDate: e.target.value })} required /></Field>
            <Check label={t("td.rec.withPayment")} checked={f.withPayment} onChange={(e) => set({ ...f, withPayment: e.target.checked })} />
            {f.withPayment ? <PaymentFields p={f.pay} set={(pay) => set({ ...f, pay })} /> : <Field label={t("td.rec.override")} hint={t("td.rec.overrideHint")}><input className="field-input" value={f.override} onChange={(e) => set({ ...f, override: e.target.value })} dir="auto" /></Field>}
          </div>
        )}
      </Panel>
    </div>
  )
}

/** Issue Flight Ticket (ADR-0038): booking → travellers and kind → provider PDF → records if missing → cover details → preview, checks and issue. */
export function IssueWizard() {
  const t = useT()
  const router = useRouter()
  const params = useSearchParams()
  const [ref, setRef] = useState<string | null>(params.get("ref"))
  const [draftId, setDraftId] = useState<string | null>(params.get("draft"))
  const [step, setStep] = useState<Step>(params.get("draft") ? "preview" : params.get("ref") ? "travellers" : "booking")
  const [reached, setReached] = useState<Set<Step>>(new Set(["booking"]))
  const [travellers, setTravellers] = useState<string[]>([])
  const [kind, setKind] = useState<TicketDocumentKind>("E_TICKET")
  const [file, setFile] = useState<{ documentId: string; filename: string } | null>(null)
  const [records, setRecords] = useState<RecordsForm | null>(null)
  const [notes, setNotes] = useState("")
  const [ovPnr, setOvPnr] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)
  const [issued, setIssued] = useState<TicketDocumentStaffDetail | null>(null)

  const req = useQuery({ queryKey: ["fr-detail", ref], queryFn: () => api<FlightDetail>(`/v1/admin/flight-requests/${ref}`), enabled: !!ref })
  const draft = useQuery({ queryKey: ["td", "detail", draftId], queryFn: () => api<TicketDocumentStaffDetail>(`/v1/admin/ticket-documents/${draftId}`), enabled: !!draftId })
  const d = req.data
  const [initFor, setInitFor] = useState<string | null>(null)
  // Every traveller is ticked once per request; unticking them all afterwards stays unticked.
  useEffect(() => { if (d && initFor !== d.ref) { setInitFor(d.ref); setTravellers(d.travellers.map((x) => x.travellerId)) } }, [d, initFor])
  useEffect(() => { if (draft.data && !ref) setRef(draft.data.requestRef) }, [draft.data, ref])

  const needsRecords = !!d && (!activeReservation(d) || travellers.some((id) => !issuedTicket(d, id)))
  const steps: Step[] = useMemo(() => ["booking", "travellers", "upload", ...(needsRecords ? ["records" as const] : []), "details", "preview"], [needsRecords])
  const go = (s: Step) => { setReached((r) => new Set([...r, s])); setStep(s) }
  const next = () => { const i = steps.indexOf(step); if (i >= 0 && i < steps.length - 1) go(steps[i + 1]!) }
  const pickRef = (r: string) => { setRef(r); setTravellers([]); setFile(null); setRecords(null); setDraftId(null); router.replace(`/tickets/issue?ref=${encodeURIComponent(r)}`); go("travellers") }
  useEffect(() => { if (step === "records" && d && !records) setRecords(freshRecords(d, travellers)) }, [step, d, records, travellers])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!d || !file) return
    setCreating(true); setCreateError(null)
    const body: CreateTicketDocumentBody = {
      requestRef: d.ref, originalDocumentId: file.documentId, kind, travellerIds: travellers, notes: notes.trim() || undefined,
      overrides: ovPnr.trim() ? { pnr: ovPnr.trim().toUpperCase() } : undefined,
      records: needsRecords && records ? buildRecords(d, records) : undefined,
    }
    try {
      const r = await api<TicketDocumentStaffDetail>("/v1/admin/ticket-documents", { body, headers: { "idempotency-key": newIdempotencyKey() } })
      setDraftId(r.id)
      router.replace(`/tickets/issue?ref=${encodeURIComponent(d.ref)}&draft=${r.id}`)
      go("preview")
    } catch (e2) { setCreateError(e2) } finally { setCreating(false) }
  }

  const header = d && (
    <div className="mx-4 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-rule bg-surface-raised px-3 py-2 text-meta md:mx-6" data-testid="wizard-context">
      <Link href={`/requests/${d.ref}`} className="ref font-semibold text-link hover:underline">{d.ref}</Link>
      <span dir="auto">{d.customer.displayName}</span>
      <RouteText className="text-steel">{d.routeLabel}</RouteText>
      <StateChip value={d.status} />
    </div>
  )
  const nav = (ok: boolean, label = t("td.next")) => (
    <div className="flex flex-wrap justify-between gap-2 pt-2">
      <Button type="button" variant="ghost" onClick={() => { const i = steps.indexOf(step); if (i > 0) setStep(steps[i - 1]!) }}><Arrow back /> {t("td.back")}</Button>
      <Button type="submit" disabled={!ok} data-testid="wizard-next">{label} <Arrow /></Button>
    </div>
  )

  if (issued) {
    return (
      <div className="pb-10">
        <PageHead title={t("td.issue.title")} />
        <div className="mx-4 max-w-2xl rounded-[var(--radius-card)] border border-success/50 bg-success-subtle p-5 md:mx-6" data-testid="issued">
          <p className="flex items-center gap-2 text-lead font-semibold text-success"><CheckCircle2 className="size-5" aria-hidden />{t("td.issued.title")}</p>
          <p className="mt-1">{t("td.issued.body", { ref: issued.requestRef, v: issued.version })}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => router.push(`/tickets/${issued.id}`)} data-testid="open-issued">{t("td.issued.open")}</Button>
            <Button variant="outline" onClick={() => { setIssued(null); setDraftId(null); setFile(null); setRecords(null); setNotes(""); setOvPnr(""); router.replace(`/tickets/issue?ref=${encodeURIComponent(issued.requestRef)}`); setStep("travellers") }}>{t("td.issued.another")}</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-10" data-testid="issue-wizard">
      <PageHead kicker={t("td.area")} title={t("td.issue.title")} />
      <Stepper steps={steps} current={step} reached={reached} onPick={setStep} />
      <div className="mt-4">{step !== "booking" && header}</div>
      <div className="px-4 md:px-6">
        <ErrorLine error={req.error ?? draft.error} />
        {d && !DRAFTABLE.includes(d.status) && step !== "booking" && <p role="alert" className="mb-3 rounded-sm bg-warning-subtle px-3 py-2">{t("td.booking.notDraftable", { s: d.status })}</p>}

        {step === "booking" && <BookingStep onPick={pickRef} />}

        {step === "travellers" && (!d ? <ListSkeleton rows={3} /> : (
          <form className="max-w-2xl space-y-5" onSubmit={(e) => { e.preventDefault(); next() }}>
            <fieldset>
              <legend className="mb-2 font-semibold">{t("td.trav.title")}</legend>
              <ul className="space-y-1.5" data-testid="traveller-picks">
                {d.travellers.map((x) => {
                  const tk = issuedTicket(d, x.travellerId)
                  return (
                    <li key={x.travellerId}>
                      <Check checked={travellers.includes(x.travellerId)} onChange={(e) => { setRecords(null); setTravellers(e.target.checked ? [...travellers, x.travellerId] : travellers.filter((y) => y !== x.travellerId)) }}
                        label={<><span dir="auto">{x.name.givenNames} {x.name.surname}</span> <span className="text-steel">· {x.passengerType}{tk && <> · <span className="num">{tk.ticketNumber}</span></>}</span></>} />
                    </li>
                  )
                })}
              </ul>
              {travellers.length > 9 && <p className="mt-1 text-meta text-danger">{t("td.trav.max")}</p>}
            </fieldset>
            <div>
              <p className="mb-2 font-semibold">{t("td.kind")}</p>
              <Segmented label={t("td.kind")} hideLabel value={kind} onChange={setKind} options={TICKET_DOCUMENT_KINDS.map((k) => ({ value: k, label: kindLabel(t, k) }))} />
              <p className="mt-1 text-meta text-steel">{kind === "BOARDING_PASS" ? t("td.kind.bpHint") : t("td.kind.etHint")}</p>
            </div>
            {nav(travellers.length > 0 && travellers.length <= 9)}
          </form>
        ))}

        {step === "upload" && d && (
          <form className="max-w-2xl space-y-3" onSubmit={(e) => { e.preventDefault(); next() }}>
            <p className="text-steel">{t("td.up.intro")}</p>
            <PdfDrop requestRef={d.ref} onReady={setFile} />
            {nav(!!file)}
          </form>
        )}

        {step === "records" && d && records && (
          <form className="max-w-3xl space-y-3" onSubmit={(e) => { e.preventDefault(); next() }}>
            <RecordsStep d={d} f={records} set={setRecords} />
            {nav(true)}
          </form>
        )}

        {step === "details" && d && (
          <form className="max-w-2xl space-y-4" onSubmit={(e) => void create(e)}>
            <dl className="grid gap-x-4 gap-y-1 rounded-md border border-rule bg-surface-raised p-3 text-meta sm:grid-cols-[auto_minmax(0,1fr)]" data-testid="draft-summary">
              <dt className="text-steel">{t("td.trav.title")}</dt><dd dir="auto">{travellers.map((id) => travellerName(d, id)).join(", ")}</dd>
              <dt className="text-steel">{t("td.kind")}</dt><dd>{kindLabel(t, kind)}</dd>
              <dt className="text-steel">{t("td.file")}</dt><dd><bdi dir="ltr" className="font-mono">{file?.filename ?? "—"}</bdi></dd>
              <dt className="text-steel">{t("td.step.records")}</dt><dd>{needsRecords ? t("td.details.recordsOnIssue") : t("td.details.recordsDone")}</dd>
            </dl>
            <Field label={t("td.notes")} hint={t("td.notes.hint")}><textarea className="field-input min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} dir="auto" data-testid="td-notes" /></Field>
            {!activeReservation(d) && !(records?.res.recordLocator) && (
              <Field label={t("td.ov.pnr")} hint={t("td.ov.pnrHint")}><input className="field-input w-40 font-mono uppercase" value={ovPnr} onChange={(e) => setOvPnr(e.target.value.toUpperCase())} pattern="[A-Za-z0-9]{6}" maxLength={6} dir="ltr" /></Field>
            )}
            <TicketErrorLine error={createError} />
            {creating && <p className="text-meta text-steel" aria-live="polite">{t("td.details.building")}</p>}
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setStep(steps[steps.indexOf("details") - 1]!)}><Arrow back /> {t("td.back")}</Button>
              <Button type="submit" loading={creating} disabled={!file} data-testid="create-draft">{t("td.details.create")}</Button>
            </div>
          </form>
        )}

        {step === "preview" && (!draft.data ? <ListSkeleton rows={4} /> : (
          <div className="space-y-5" data-testid="preview-step">
            <PreviewPair id={draft.data.id} branded={!!draft.data.brandedDocumentId} />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Panel title={t("td.int.title")}><IntegrityPanel v={draft.data.verification} /></Panel>
              <Panel title={t("td.issue.panel")}>
                {draft.data.status === "DRAFT" ? <IssueControls d={draft.data} onIssued={setIssued} /> : <p>{t("td.issue.notDraft")} <StateChip value={draft.data.status} /> · <Link className="text-link hover:underline" href={`/tickets/${draft.data.id}`}>{t("td.issued.open")}</Link></p>}
                <p className="mt-3 text-caption text-steel">{t("td.issue.created", { t: fmtDateTime(draft.data.createdAt) })}</p>
              </Panel>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
