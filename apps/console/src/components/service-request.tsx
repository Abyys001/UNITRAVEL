"use client"

import { useQuery } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { type LoyaltyBenefitView, type ServiceQuoteLine, serviceQuoteTotal, type StaffServiceRequestView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { StatusChip } from "@/components/bento"
import { statusTone } from "@/components/case"
import { benefitValue, CURRENCIES, inDays } from "@/components/club"
import { FormDialog } from "@/components/form-dialog"
import { StaffSelect } from "@/components/staff-select"
import { COMMAND_LABEL, Field } from "@/components/ui"
import { api, ApiError } from "@/lib/api"
import { COMMAND_LABEL_FA } from "@/lib/command-labels"
import { fmtDate, human, money, toMajor, toMinor } from "@/lib/format"
import { hasMsg, type T, useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"
import { useSession } from "@/lib/session"

/**
 * Service request pieces for the Admin Panel (ADR-0015): localised labels, the per-type details, the command dialog
 * (`POST /v1/admin/service-requests/:ref/transition`) and the quote builder for `send_quote`. The server's machine
 * decides which commands exist and validates every input; these components collect it and explain the answer.
 */

const label = (t: T, prefix: string, code: string) => { const k = `${prefix}.${code}`; return hasMsg(k) ? t(k) : human(code) }

export function useServiceLabels() {
  const t = useT()
  const [locale] = useLocale()
  return {
    t,
    type: (x: string) => label(t, "svc.t", x),
    status: (x: string) => label(t, "svc.s", x),
    command: (c: string) => (locale === "fa" ? COMMAND_LABEL_FA[c] : undefined) ?? COMMAND_LABEL[c] ?? human(c),
  }
}

/** Status as a chip with the localised word; `data-status` keeps the machine value for tests. */
export function ServiceStatus({ value }: { value: string }) {
  const L = useServiceLabels()
  return <StatusChip tone={statusTone(value === "IN_PROGRESS" ? "IN_REVIEW" : value)}><span data-status={value}>{L.status(value)}</span></StatusChip>
}

/* ---------- details ---------- */

const ENUM_FIELDS = new Set(["purpose", "direction", "destinationRegion"])
const DATE_FIELDS = new Set(["intendedTravelDate", "date", "startDate", "endDate", "checkIn", "checkOut"])
const ORDER = ["destinationCountry", "destination", "location", "from", "to", "airport", "direction", "flightNumber", "purpose", "destinationRegion", "date", "intendedTravelDate", "approxDates", "startDate", "endDate", "checkIn", "checkOut", "guests", "rooms", "passengers", "passengersCount", "travellersCount", "travellerIds", "bestTimeToCall", "linkedFlightRequestRef", "offerSnapshotId", "note"]

/** The customer's form, field by field in a readable order; traveller ids become names (no document data). */
export function ServiceDetails({ d }: { d: StaffServiceRequestView }) {
  const t = useT()
  const { can } = useSession()
  const entries = Object.entries(d.details).filter(([, v]) => v !== undefined && v !== null && v !== "")
  if (!entries.length) return <p className="text-steel">{t("svc.details.none")}</p>
  entries.sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99))
  const value = (k: string, v: unknown): React.ReactNode => {
    if (k === "travellerIds" && Array.isArray(v)) {
      return <ul>{v.map((id) => { const p = d.travellers.find((x) => x.id === id); return <li key={String(id)} dir="auto">{p ? <>{p.name}{p.nationality && <span className="text-steel"> · {p.nationality}</span>}</> : <span className="ref text-steel">{String(id).slice(0, 8)}</span>}</li> })}</ul>
    }
    if (k === "linkedFlightRequestRef" && typeof v === "string") return can("flight_request.read.any") ? <Link href={`/requests/${v}`} className="ref text-link hover:underline">{v}</Link> : <span className="ref">{v}</span>
    if (k === "offerSnapshotId" || k === "flightNumber" || k === "airport" || k === "destinationCountry") return <span className="ref" dir="ltr">{String(v)}</span>
    if (ENUM_FIELDS.has(k) && typeof v === "string") return label(t, "svc.v", v)
    if (DATE_FIELDS.has(k) && typeof v === "string") return <span className="num">{fmtDate(v)}</span>
    if (typeof v === "number") return <span className="num">{v}</span>
    if (typeof v === "string") return <span className="whitespace-pre-wrap" dir="auto">{k === "note" ? `“${v}”` : v}</span>
    return <code className="text-meta">{JSON.stringify(v)}</code>
  }
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5" data-testid="service-details">
      {entries.map(([k, v]) => <div key={k} className="contents"><dt className="text-steel">{label(t, "svc.f", k)}</dt><dd className="min-w-0">{value(k, v)}</dd></div>)}
    </dl>
  )
}

/* ---------- commands ---------- */

export const SERVICE_DIALOG_COMMANDS = new Set(["assign", "send_quote", "record_acceptance", "complete", "cancel", "decline", "release_hold"])
const REASON = new Set(["cancel", "decline", "release_hold"])
const NOTE = new Set(["record_acceptance", "complete"])

/** Thrown after a VERSION_CONFLICT: the caller already refetched, the message tells the user what happened. */
export const isConflict = (e: unknown) => e instanceof ApiError && e.code === "VERSION_CONFLICT"

/**
 * Sends one command with the version the user was looking at. On VERSION_CONFLICT the request is refetched and the
 * error says so, so nobody overwrites a change they have not seen.
 */
export async function transition(d: Pick<StaffServiceRequestView, "ref">, version: number, command: string, input: Record<string, unknown>, onConflict: () => Promise<unknown>, t: T) {
  try {
    return await api<StaffServiceRequestView>(`/v1/admin/service-requests/${d.ref}/transition`, { body: { command, expectedVersion: version, input } })
  } catch (e) {
    if (isConflict(e)) { await onConflict(); throw new Error(t("svc.conflict")) }
    throw e
  }
}

export function ServiceCommandDialog({ command, d, version, onClose, done, onConflict }: { command: string | null; d: StaffServiceRequestView; version: number; onClose: () => void; done: (r: StaffServiceRequestView) => Promise<void>; onConflict: () => Promise<unknown> }) {
  const L = useServiceLabels()
  const { t } = L
  const [text, setText] = useState("")
  const [assignee, setAssignee] = useState("")
  useEffect(() => { setText(""); setAssignee("") }, [command])
  if (!command) return null
  if (command === "send_quote") return <QuoteBuilder d={d} version={version} onClose={onClose} done={done} onConflict={onConflict} />
  const title = L.command(command)
  const input = (): Record<string, unknown> => command === "assign" ? { assigneeUserId: assignee } : REASON.has(command) ? { reason: text.trim() } : NOTE.has(command) ? { note: text.trim() } : {}
  const submit = async () => { const r = await transition(d, version, command, input(), onConflict, t); await done(r) }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={title} submitLabel={title.replace("…", "")} onSubmit={submit} destructive={command === "cancel" || command === "decline"} testId={`dlg-${command}`}>
      {command === "assign" && <StaffSelect value={assignee} onChange={setAssignee} />}
      {REASON.has(command) && <Field label={t("svc.d.reason")} hint={t("svc.d.reason.hint")}><textarea className="field-input min-h-20" value={text} onChange={(e) => setText(e.target.value)} required minLength={5} maxLength={1000} dir="auto" /></Field>}
      {NOTE.has(command) && <Field label={t("svc.d.note")} hint={t("svc.d.note.hint")}><textarea className="field-input min-h-20" value={text} onChange={(e) => setText(e.target.value)} required minLength={3} maxLength={1000} dir="auto" /></Field>}
    </FormDialog>
  )
}

/* ---------- quote builder ---------- */

type Kind = ServiceQuoteLine["kind"]
interface Row { key: number; kind: Kind; label: string; amount: string; benefitId: string }
const KINDS: Kind[] = ["SERVICE_FEE", "THIRD_PARTY_FEE", "CLUB_DISCOUNT"]
const DISCOUNT_KINDS = new Set(["DISCOUNT_FIXED", "DISCOUNT_PERCENT"])
const CLUB_LABEL = { en: "Customer club discount", fa: "تخفیف باشگاه مشتریان" } as const
let rowKey = 0
const newRow = (kind: Kind = "SERVICE_FEE"): Row => ({ key: ++rowKey, kind, label: "", amount: "", benefitId: "" })

/** Index of the quote line an API error points at: zod paths read `lines[2].amount`, the club check `lines.2`. */
const lineIndex = (path: string) => { const m = /^lines(?:\[(\d+)\]|\.(\d+))/.exec(path); return m ? Number(m[1] ?? m[2]) : null }

/**
 * `send_quote` input (ServiceQuoteBody): lines in one currency, amounts typed in major units and sent in minor units,
 * a validity and an optional note. A CLUB_DISCOUNT line must name one of the customer's usable discount benefits
 * (loaded only for holders of `loyalty.read`); the server re-checks every line and its errors show under the line.
 */
function QuoteBuilder({ d, version, onClose, done, onConflict }: { d: StaffServiceRequestView; version: number; onClose: () => void; done: (r: StaffServiceRequestView) => Promise<void>; onConflict: () => Promise<unknown> }) {
  const L = useServiceLabels()
  const { t } = L
  const { can } = useSession()
  const [locale] = useLocale()
  const [currency, setCurrency] = useState<string>("GBP")
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
  const [validUntil, setValidUntil] = useState(() => inDays(3))
  const [note, setNote] = useState("")
  const [errors, setErrors] = useState<{ lines: Record<number, string[]>; general: string[] }>({ lines: {}, general: [] })
  const clubAllowed = can("loyalty.read")
  const hasDiscount = rows.some((r) => r.kind === "CLUB_DISCOUNT")
  const benefits = useQuery({
    queryKey: ["club", "benefits", "usable", d.customer.userId],
    queryFn: () => api<LoyaltyBenefitView[]>(`/v1/admin/club/benefits?usableBy=${d.customer.userId}`),
    enabled: clubAllowed && hasDiscount, retry: false,
  })
  const benefitText = (b: LoyaltyBenefitView) => `${locale === "fa" ? b.description.fa : b.description.en} · ${benefitValue(b, t)}`
  const lines: ServiceQuoteLine[] = rows.map((r) => ({ kind: r.kind, label: r.label.trim(), amount: { amountMinor: toMinor(r.amount.replace(",", "."), currency), currency }, ...(r.kind === "CLUB_DISCOUNT" && r.benefitId ? { benefitId: r.benefitId } : {}) }))
  const total = serviceQuoteTotal(lines)
  const gross = lines.filter((l) => l.kind !== "CLUB_DISCOUNT").reduce((s, l) => s + l.amount.amountMinor, 0)
  /** The most a benefit allows on this quote (same rule the server applies); null when it cannot apply here. */
  const cap = (b: LoyaltyBenefitView | undefined) => !b ? null : b.kind === "DISCOUNT_PERCENT" ? Math.floor((gross * b.value) / 100) : b.kind === "DISCOUNT_FIXED" && b.currency === currency ? b.value : null
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const pickBenefit = (row: Row, id: string) => {
    const b = benefits.data?.find((x) => x.id === id)
    const max = cap(b)
    update(row.key, { benefitId: id, label: row.label || CLUB_LABEL[d.submittedLocale], amount: max && max > 0 ? toMajor(max, currency) : row.amount })
  }
  const submit = async () => {
    setErrors({ lines: {}, general: [] })
    const input = { lines, validUntil: new Date(validUntil).toISOString(), note: note.trim() || undefined }
    try {
      const r = await transition(d, version, "send_quote", input, onConflict, t)
      await done(r)
    } catch (e) {
      if (e instanceof ApiError && e.code === "VALIDATION_FAILED" && e.problem.errors?.length) {
        const out: { lines: Record<number, string[]>; general: string[] } = { lines: {}, general: [] }
        for (const x of e.problem.errors) {
          const text = hasMsg(`qerr.${x.code}`) ? t(`qerr.${x.code}` as never) : (x.message ?? human(x.code))
          const i = lineIndex(x.path)
          if (i !== null && i < rows.length) (out.lines[i] ??= []).push(text)
          else out.general.push(text)
        }
        setErrors(out)
        throw new Error(Object.keys(out.lines).length ? [t("q.err.lines"), ...out.general].join(" ") : out.general.join(" "))
      }
      throw e
    }
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} wide title={t("q.title")} description={t("q.desc")} submitLabel={t("q.title")} onSubmit={submit} testId="dlg-send_quote">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label={t("q.currency")} hint={t("q.currency.hint")}>
          <NativeSelect className="field-input" value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="quote-currency">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect>
        </Field>
        <Field label={t("q.validUntil")}><input type="datetime-local" className="field-input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required min={inDays(0)} /></Field>
      </div>
      <fieldset className="space-y-2" data-testid="quote-lines">
        <legend className="mb-1 text-meta font-medium text-ink">{t("q.lines")}</legend>
        {rows.map((r, i) => {
          const errs = errors.lines[i]
          const chosen = benefits.data?.find((b) => b.id === r.benefitId)
          const max = r.kind === "CLUB_DISCOUNT" ? cap(chosen) : null
          return (
            <div key={r.key} role="group" aria-label={t("q.line", { n: i + 1 })} className={cn("rounded-lg border p-3", errs ? "border-danger" : "border-rule", r.kind === "CLUB_DISCOUNT" && "bg-surface-sunk")} data-testid="quote-line">
              <div className="grid gap-2 sm:grid-cols-[11rem_1fr_8rem_auto] sm:items-end">
                <Field label={t("q.kind")}>
                  <NativeSelect className="field-input" value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as Kind, benefitId: "" })} data-testid="quote-line-kind">
                    {KINDS.map((k) => <option key={k} value={k}>{label(t, "q.k", k)}</option>)}
                  </NativeSelect>
                </Field>
                <Field label={t("q.label")}><input className="field-input" value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} required maxLength={120} dir="auto" data-testid="quote-line-label" /></Field>
                <Field label={`${t("q.amount")} (${currency})`}><input className="field-input num" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} required placeholder="0.00" dir="ltr" aria-invalid={errs ? true : undefined} data-testid="quote-line-amount" /></Field>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={rows.length === 1} aria-label={t("q.remove", { n: i + 1 })} className="text-steel hover:text-danger"><Trash2 aria-hidden /></Button>
              </div>
              {r.kind === "CLUB_DISCOUNT" && (
                <div className="mt-2">
                  {!clubAllowed ? <p className="text-meta text-danger">{t("q.benefit.noAccess")}</p> : benefits.error ? <p className="text-meta text-danger">{t("q.benefit.error")}</p> : (
                    <Field label={t("q.benefit")} hint={chosen ? <>{benefitText(chosen)}{max !== null && <> · {t("q.benefit.max", { m: money({ amountMinor: max, currency }) })}</>}</> : benefits.data && !benefits.data.length ? t("q.benefit.none") : undefined}>
                      <NativeSelect className="field-input" value={r.benefitId} onChange={(e) => pickBenefit(r, e.target.value)} required disabled={benefits.isPending} data-testid="quote-line-benefit">
                        <option value="" disabled>{benefits.isPending ? t("q.benefit.loading") : t("q.benefit.choose")}</option>
                        {(benefits.data ?? []).map((b) => <option key={b.id} value={b.id} disabled={!DISCOUNT_KINDS.has(b.kind)}>{benefitText(b)}{DISCOUNT_KINDS.has(b.kind) ? "" : ` (${t("q.benefit.onlyDiscount")})`}</option>)}
                      </NativeSelect>
                    </Field>
                  )}
                </div>
              )}
              {errs && <ul role="alert" className="mt-2 space-y-0.5 text-meta text-danger" data-testid="quote-line-error">{errs.map((x, n) => <li key={n}>{x}</li>)}</ul>}
            </div>
          )
        })}
        {rows.length < 20 && <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, newRow()])}><Plus aria-hidden />{t("q.add")}</Button>}
      </fieldset>
      {errors.general.length > 0 && <ul role="alert" className="space-y-0.5 text-meta text-danger">{errors.general.map((x, n) => <li key={n}>{x}</li>)}</ul>}
      <div className="flex items-baseline justify-between gap-3 border-t border-rule pt-3" aria-live="polite">
        <span><span className="font-medium">{t("svc.total")}</span> <span className="text-meta text-steel">{t("q.total.hint")}</span></span>
        <output className={cn("num text-lead font-semibold", total.amountMinor <= 0 && "text-danger")} data-testid="quote-total">{money(total)}</output>
      </div>
      <Field label={t("q.note")}><textarea className="field-input min-h-16" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} dir="auto" /></Field>
    </FormDialog>
  )
}

/** Sent and earlier quotes with their lines; discount lines read as subtracted. */
export function QuotesList({ d }: { d: StaffServiceRequestView }) {
  const t = useT()
  const quotes = d.quotes.length ? d.quotes : d.quote ? [d.quote] : []
  if (!quotes.length) return <p className="text-steel">{t("svc.quotes.none")}</p>
  return (
    <ul className="space-y-3" data-testid="service-quotes">
      {quotes.map((q) => (
        <li key={q.id} className="rounded-lg border border-rule p-3">
          <p className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-meta text-steel">{q.quotationNumber ? <span className="ref">{t("svc.quote.number", { n: q.quotationNumber })}</span> : null}{q.sentAt && <> · {t("svc.quote.sent", { d: fmtDate(q.sentAt) })}</>}</span>
            <StatusChip tone={statusTone(q.status)}><span data-status={q.status}>{human(q.status)}</span></StatusChip>
          </p>
          <ul className="mt-2 ledger-rows">
            {q.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-1">
                <span><span dir="auto">{l.label}</span> <span className="text-caption text-steel">{label(t, "q.k", l.kind)}</span></span>
                <span className={cn("num whitespace-nowrap", l.kind === "CLUB_DISCOUNT" && "text-success")}>{l.kind === "CLUB_DISCOUNT" ? "−" : ""}{money(l.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 flex justify-between gap-3 border-t border-rule pt-1.5 font-semibold"><span>{t("svc.total")}</span><span className="num">{money(q.total)}</span></p>
          <p className="mt-1 text-meta text-steel">{t("svc.quote.valid", { d: fmtDate(q.validUntil) })}</p>
          {q.note && <p className="mt-1 whitespace-pre-wrap text-steel" dir="auto">{q.note}</p>}
        </li>
      ))}
    </ul>
  )
}
