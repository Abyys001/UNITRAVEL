import type { AtolMode, InvoiceStatus } from "@unitravel/contracts"

import type { TransitionTable } from "./machine"

// ADR-0006: the invoice state machine. All state decisions live here; the API supplies the facts and persists the result.
// DRAFT -> ISSUED -> PAID | CANCELLED, PAID -> REFUNDED. Expiry is CANCELLED with reason EXPIRED (a system command).

export type InvoiceCommand = "issue" | "cancel" | "expire" | "mark_paid" | "mark_refunded"

export interface InvoiceFacts {
  status: InvoiceStatus
  productType: "FLIGHT" | "CARGO" | "SERVICE"
  atolMode: AtolMode
  now: Date
  /** Flight: when the tickets were recorded; null while the request is not ticketed. */
  ticketedAt: Date | null
  expiresAt: Date | null
}

const DAY_MS = 24 * 3600_000
const TZ = "Europe/London"

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })

function parts(d: Date) {
  const o: Record<string, number> = {}
  for (const p of fmt.formatToParts(d)) if (p.type !== "literal") o[p.type] = Number(p.value)
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}

/** Calendar day in Europe/London, `YYYY-MM-DD` (ADR-0006 C5: the booklet's business hours use Europe/London). */
export function londonDay(d: Date): string {
  const p = parts(d)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

export function londonYear(d: Date): number {
  return parts(d).year
}

/** Milliseconds London is ahead of UTC at this instant (3 600 000 during summer time). */
function londonOffsetMs(d: Date): number {
  const p = parts(d)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000
}

/** The next 00:00 in Europe/London after `d` (daylight-saving aware); an invoice expires at this instant. */
export function endOfLondonDay(d: Date): Date {
  const p = parts(d)
  const naive = Date.UTC(p.year, p.month - 1, p.day + 1)
  let u = naive - londonOffsetMs(new Date(naive))
  u = naive - londonOffsetMs(new Date(u))
  return new Date(u)
}

/** `PREFIX-YYYY-NNNNNN`; the sequence is allocated per kind and London year by the database (ADR-0006 C6). */
export function formatDocumentNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`
}

/** When a freshly issued invoice stops being payable (ADR-0006 C5). */
export function invoiceExpiry(f: { productType: "FLIGHT" | "CARGO" | "SERVICE"; atolMode: AtolMode; now: Date; validityDays: number }): Date {
  if (f.productType === "FLIGHT" && f.atolMode === "PAY_ON_TICKETING") return endOfLondonDay(f.now)
  return new Date(f.now.getTime() + f.validityDays * DAY_MS)
}

/** Lines and totals can change only while the invoice is a draft; after issue a correction is cancel + reissue (C4). */
export const invoiceAmountsEditable = (status: InvoiceStatus): boolean => status === "DRAFT"

const issueGuard = (f: InvoiceFacts): string | null => {
  if (f.productType !== "FLIGHT" || f.atolMode !== "PAY_ON_TICKETING") return null
  if (!f.ticketedAt) return "PAY_ON_TICKETING: a flight invoice can be issued only once ticketing is confirmed"
  if (londonDay(f.ticketedAt) !== londonDay(f.now)) return "PAY_ON_TICKETING: tickets were recorded on an earlier day (Europe/London); the same-day invoice window has passed"
  return null
}

export const INVOICE_TRANSITIONS: TransitionTable<InvoiceStatus, InvoiceFacts, InvoiceCommand> = {
  issue: { from: ["DRAFT"], to: "ISSUED", actor: "STAFF", permissions: ["commercial_document.issue"], guard: issueGuard, label: "Issue invoice" },
  cancel: { from: ["DRAFT", "ISSUED"], to: "CANCELLED", actor: "STAFF", permissions: ["commercial_document.issue"], label: "Cancel invoice" },
  expire: { from: ["ISSUED"], to: "CANCELLED", actor: "SYSTEM", guard: (f) => (f.expiresAt && f.now.getTime() >= f.expiresAt.getTime() ? null : "The invoice has not expired yet") },
  // The seam for payments: offline recording today, the verified Stripe webhook in Phase D.
  mark_paid: { from: ["ISSUED"], to: "PAID", actor: "SYSTEM" },
  mark_refunded: { from: ["PAID"], to: "REFUNDED", actor: "SYSTEM" },
}
