"use client"

import { useQueryClient } from "@tanstack/react-query"
import { PhoneCall, PhoneOutgoing } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { type CallLogView, CALL_DIRECTIONS, CALL_STATUSES, type StaffTicketSummary, SUPPORT_TICKET_STATUSES, SUPPORT_TOPICS } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { StatusChip } from "@/components/bento"
import { SlaChip, TableScroll } from "@/components/case"
import { tableClass } from "@/components/data-list"
import { codeLabel, localInput } from "@/components/club"
import { FormDialog } from "@/components/form-dialog"
import { Arrow, Field } from "@/components/ui"
import { api, ApiError } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/** Support inbox and call log pieces (ADR-0019, plan J5). The API decides who may do what; the console collects input and explains answers. */

export { CALL_DIRECTIONS, CALL_STATUSES, SUPPORT_TICKET_STATUSES, SUPPORT_TOPICS }

export function useSupportLabels() {
  const t = useT()
  return {
    t,
    topic: (c: string) => codeLabel(t, "sp.topic", c),
    status: (c: string) => codeLabel(t, "sp.status", c),
    direction: (c: string) => codeLabel(t, "sp.dir", c),
    callStatus: (c: string) => codeLabel(t, "sp.cs", c),
  }
}

const TICKET_TONE = { OPEN: "warn", PENDING_CUSTOMER: "info", RESOLVED: "ok", CLOSED: "neutral" } as const
export function TicketStatus({ value }: { value: string }) {
  const L = useSupportLabels()
  return <StatusChip tone={TICKET_TONE[value as keyof typeof TICKET_TONE] ?? "neutral"}><span data-status={value}>{L.status(value)}</span></StatusChip>
}

/** First-answer clock for open tickets; resolved and closed ones are done. */
export function TicketSla({ ticket }: { ticket: Pick<StaffTicketSummary, "slaDueAt" | "createdAt" | "overdue" | "status"> }) {
  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") return <span className="text-steel">—</span>
  if (ticket.status === "PENDING_CUSTOMER") return <span className="text-steel">—</span>
  return <SlaChip dueAt={ticket.slaDueAt} startAt={ticket.createdAt} breached={ticket.overdue} />
}

export const fmtDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60
  const p = (n: number) => String(n).padStart(2, "0")
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}

/** Phone numbers are Latin digits; keep them left-to-right inside Persian text. */
export const Phone = ({ value }: { value: string }) => <bdi dir="ltr" className="num whitespace-nowrap">{value}</bdi>

/** Reference to a request or a ticket, linked to the page that shows it. */
export function RefLink({ value, className }: { value: string; className?: string }) {
  const { can } = useSession()
  const href = value.startsWith("UT-F-") && can("flight_request.read.any") ? `/requests/${value}` : value.startsWith("UT-C-") && can("cargo_request.read.any") ? `/cargo/${value}` : value.startsWith("UT-S-") && can("service_request.read.any") ? `/services/${value}` : value.startsWith("TK-") && can("support.read") ? `/support/${value}` : null
  return href ? <Link href={href} className={`ref text-link hover:underline ${className ?? ""}`} dir="ltr">{value}</Link> : <span className={`ref ${className ?? ""}`} dir="ltr">{value}</span>
}

/* ---------- click to call ---------- */

/**
 * Click-to-call. Bonline's API is UNKNOWN (ADR-0019), so the API answers 501 NOT_CONFIGURED until it is wired: that is
 * a normal state of the product, shown as a notice, never as a failure.
 */
export function useClickToCall() {
  const t = useT()
  const qc = useQueryClient()
  const [notConfigured, setNotConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const call = async (toNumber: string, ticketRef?: string): Promise<boolean> => {
    setBusy(true)
    try {
      await api("/v1/admin/calls/click-to-call", { body: { toNumber, ...(ticketRef ? { ticketRef } : {}) } })
      setNotConfigured(false)
      toast.success(t("sp.call.started"))
      await qc.invalidateQueries({ queryKey: ["support"] })
      return true
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOT_CONFIGURED") { setNotConfigured(true); return false }
      throw e
    } finally { setBusy(false) }
  }
  return { call, notConfigured, busy, reset: () => setNotConfigured(false) }
}

export function BonlineNotice({ className }: { className?: string }) {
  const t = useT()
  return (
    <p role="status" className={`rounded-lg border border-info-border bg-info-subtle px-3 py-2 text-meta text-info-subtle-fg ${className ?? ""}`} data-testid="bonline-not-configured">
      <b>{t("sp.call.notConfigured")}</b> {t("sp.call.notConfigured.body")}
    </p>
  )
}

/** Dials a number through the telephony provider. Hidden without `call.log`. */
export function ClickToCallButton({ number, ticketRef, size = "sm", variant = "outline" }: { number: string; ticketRef?: string; size?: "sm" | "xs"; variant?: "outline" | "ghost" }) {
  const { can } = useSession()
  const t = useT()
  const c = useClickToCall()
  if (!can("call.log")) return null
  return (
    <>
      <Button type="button" size={size} variant={variant} loading={c.busy} onClick={() => void c.call(number, ticketRef).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))} data-testid="click-to-call">
        <PhoneOutgoing aria-hidden />{t("sp.call.dial")}
      </Button>
      {c.notConfigured && <BonlineNotice className="basis-full" />}
    </>
  )
}

/** Free-number dialer for the calls page. */
export function DialDialog({ open, onOpenChange, ticketRef }: { open: boolean; onOpenChange: (o: boolean) => void; ticketRef?: string }) {
  const t = useT()
  const c = useClickToCall()
  const [number, setNumber] = useState("")
  return (
    <FormDialog open={open} onOpenChange={(o) => { if (!o) c.reset(); onOpenChange(o) }} title={t("sp.call.dialTitle")} description={t("sp.call.dialDesc")} submitLabel={t("sp.call.dial")} testId="dlg-dial"
      onSubmit={async () => { if (!(await c.call(number.trim(), ticketRef))) throw new Error(`${t("sp.call.notConfigured")} ${t("sp.call.notConfigured.body")}`) }}>
      <Field label={t("sp.call.number")}><input className="field-input num" value={number} onChange={(e) => setNumber(e.target.value)} required pattern="\+?[0-9 \(\)\-]{3,24}" inputMode="tel" dir="ltr" placeholder="+44 7700 900000" /></Field>
    </FormDialog>
  )
}

/* ---------- log a call ---------- */

/** `POST /v1/admin/calls`: a call that happened outside the telephony provider, or before it was connected. */
export function LogCallDialog({ open, onOpenChange, ticketRef, customerId, defaultNumber }: { open: boolean; onOpenChange: (o: boolean) => void; ticketRef?: string; customerId?: string | null; defaultNumber?: string | null }) {
  const L = useSupportLabels()
  const { t } = L
  const qc = useQueryClient()
  const [f, setF] = useState(() => ({ direction: "INBOUND" as (typeof CALL_DIRECTIONS)[number], from: defaultNumber ?? "", to: "", min: "0", sec: "0", status: "ANSWERED" as (typeof CALL_STATUSES)[number], startedAt: localInput(new Date()), ticket: ticketRef ?? "", note: "" }))
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const submit = async () => {
    await api("/v1/admin/calls", { body: {
      direction: f.direction, fromNumber: f.from.trim(), toNumber: f.to.trim(), durationSeconds: Math.max(0, Number(f.min || 0) * 60 + Number(f.sec || 0)), status: f.status, startedAt: new Date(f.startedAt).toISOString(),
      ...(f.ticket.trim() ? { ticketRef: f.ticket.trim().toUpperCase() } : {}), ...(customerId ? { customerId } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}),
    } })
    await qc.invalidateQueries({ queryKey: ["support"] })
  }
  const number = (k: "from" | "to", label: string) => <Field label={label}><input className="field-input num" value={f[k]} onChange={(e) => set(k, e.target.value)} required pattern="\+?[0-9 \(\)\-]{3,24}" inputMode="tel" dir="ltr" /></Field>
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("sp.log.title")} description={t("sp.log.desc")} submitLabel={t("sp.log.save")} onSubmit={submit} testId="dlg-log-call">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("sp.log.direction")}>
          <NativeSelect className="field-input" value={f.direction} onChange={(e) => set("direction", e.target.value as typeof f.direction)}>{CALL_DIRECTIONS.map((d) => <option key={d} value={d}>{L.direction(d)}</option>)}</NativeSelect>
        </Field>
        <Field label={t("sp.log.status")}>
          <NativeSelect className="field-input" value={f.status} onChange={(e) => set("status", e.target.value as typeof f.status)}>{CALL_STATUSES.map((s) => <option key={s} value={s}>{L.callStatus(s)}</option>)}</NativeSelect>
        </Field>
        {number("from", t("sp.log.from"))}
        {number("to", t("sp.log.to"))}
        <Field label={t("sp.log.started")}><input type="datetime-local" className="field-input" value={f.startedAt} onChange={(e) => set("startedAt", e.target.value)} required max={localInput(new Date())} /></Field>
        <Field label={t("sp.log.duration")}>
          <span className="flex items-center gap-2">
            <input className="field-input num w-20" type="number" min={0} max={1440} value={f.min} onChange={(e) => set("min", e.target.value)} aria-label={t("sp.log.min")} dir="ltr" />
            <span className="text-steel">{t("sp.log.min")}</span>
            <input className="field-input num w-20" type="number" min={0} max={59} value={f.sec} onChange={(e) => set("sec", e.target.value)} aria-label={t("sp.log.sec")} dir="ltr" />
            <span className="text-steel">{t("sp.log.sec")}</span>
          </span>
        </Field>
      </div>
      <Field label={t("sp.log.ticket")} hint={t("sp.log.ticket.hint")}><input className="field-input ref uppercase" value={f.ticket} onChange={(e) => set("ticket", e.target.value)} pattern="[Tt][Kk]-[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{6}" placeholder="TK-ABC234" dir="ltr" readOnly={!!ticketRef} /></Field>
      <Field label={t("sp.log.note")}><textarea className="field-input min-h-16" value={f.note} onChange={(e) => set("note", e.target.value)} maxLength={1000} dir="auto" /></Field>
    </FormDialog>
  )
}

/* ---------- call list (cards below xl, table from xl) ---------- */

const CALL_TONE = { ANSWERED: "ok", MISSED: "danger", BUSY: "warn", FAILED: "danger", VOICEMAIL: "info" } as const
const CallStatus = ({ value }: { value: string }) => {
  const L = useSupportLabels()
  return <StatusChip tone={CALL_TONE[value as keyof typeof CALL_TONE] ?? "neutral"}>{L.callStatus(value)}</StatusChip>
}
const DirectionLabel = ({ value }: { value: string }) => {
  const L = useSupportLabels()
  return <span className="inline-flex items-center gap-1.5"><PhoneCall className="size-3.5 text-steel rtl:-scale-x-100" aria-hidden />{L.direction(value)}</span>
}
const Parties = ({ c, wrap }: { c: CallLogView; wrap?: boolean }) => <span className={cn("inline-flex items-center gap-x-1.5", wrap && "flex-wrap")}><Phone value={c.fromNumber} /><Arrow /><Phone value={c.toNumber} /></span>

function useCallCell() {
  const t = useT()
  const { can } = useSession()
  return (c: CallLogView) => c.customerId && can("customer.read") ? <Link href={`/customers/${c.customerId}`} className="text-link hover:underline">{t("sp.call.customer")}</Link> : null
}

/** Phone and tablet layout: one card per call. */
export function CallCards({ calls, showTicket = true, className }: { calls: CallLogView[]; showTicket?: boolean; className?: string }) {
  const t = useT()
  const customer = useCallCell()
  return (
    <ul className={cn("space-y-2", className)} data-testid="call-cards">
      {calls.map((c) => (
        <li key={c.id} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5">
          <p className="flex flex-wrap items-center justify-between gap-2"><DirectionLabel value={c.direction} /><CallStatus value={c.status} /></p>
          <p className="mt-1.5"><Parties c={c} wrap /></p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-steel"><span className="num">{fmtDateTime(c.startedAt)}</span><span className="num">{fmtDuration(c.durationSeconds)}</span>{c.source === "BONLINE" && <span>Bonline</span>}</p>
          {(c.ticketRef && showTicket) || c.customerId ? <p className="mt-1 flex flex-wrap items-center gap-x-3 text-meta">{c.ticketRef && showTicket && <RefLink value={c.ticketRef} />}{customer(c)}</p> : null}
          {c.note && <p className="mt-1 whitespace-pre-wrap text-steel" dir="auto">{c.note}</p>}
          {c.recordedBy && <p className="mt-1 text-caption text-steel">{t("sp.call.by", { n: c.recordedBy })}</p>}
        </li>
      ))}
    </ul>
  )
}

/** Desktop layout (xl and up): a table that scrolls inside its card. */
export function CallsTable({ calls, showTicket = true }: { calls: CallLogView[]; showTicket?: boolean }) {
  const t = useT()
  const customer = useCallCell()
  return (
    <TableScroll label={t("sp.calls.title")}>
      <table className={tableClass} data-testid="calls">
        <thead><tr><th>{t("sp.call.c.when")}</th><th>{t("sp.call.c.direction")}</th><th>{t("sp.call.c.parties")}</th><th>{t("sp.call.c.status")}</th><th>{t("sp.call.c.duration")}</th>{showTicket && <th>{t("sp.call.c.ticket")}</th>}<th>{t("sp.call.c.note")}</th></tr></thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.id}>
              <td className="num whitespace-nowrap">{fmtDateTime(c.startedAt)}<span className="block text-caption text-steel">{c.source === "BONLINE" ? "Bonline" : c.recordedBy ?? t("sp.call.manual")}</span></td>
              <td className="whitespace-nowrap"><DirectionLabel value={c.direction} /></td>
              <td className="whitespace-nowrap"><Parties c={c} /></td>
              <td className="whitespace-nowrap"><CallStatus value={c.status} /></td>
              <td className="num whitespace-nowrap">{fmtDuration(c.durationSeconds)}</td>
              {showTicket && <td className="whitespace-nowrap">{c.ticketRef ? <RefLink value={c.ticketRef} /> : <span className="text-steel">—</span>} {customer(c) && <span className="ms-2">{customer(c)}</span>}</td>}
              <td className="max-w-48 truncate" dir="auto" title={c.note ?? undefined}>{c.note ?? <span className="text-steel">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  )
}

/** Compact list for a side panel (one ticket's calls): cards at every width. */
export function CallsList({ calls, showTicket = true, empty }: { calls: CallLogView[]; showTicket?: boolean; empty: React.ReactNode }) {
  if (!calls.length) return <p className="py-6 text-center text-steel" data-testid="calls-empty">{empty}</p>
  return <CallCards calls={calls} showTicket={showTicket} />
}
