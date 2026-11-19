import type { TicketDocumentStatus } from "@unitravel/contracts"

import type { TransitionTable } from "./machine"

// ADR-0038 D1: DRAFT -> ISSUED -> SUPERSEDED (a newer version was issued) or REVOKED. A draft can be revoked (discarded).
// SUPERSEDED and REVOKED are final: a correction is always a new version, never an edit of an old one.

export interface TicketDocumentFacts {
  status: TicketDocumentStatus
  /** D4: every code of the original was found with identical bytes in the branded file. */
  codesMatch?: boolean
  /** D4: the entered PNR or a ticket number was not found in the PDF text. */
  textWarnings?: boolean
  /** Staff acknowledged the text warnings in the issue dialog. */
  textWarningsAcknowledged?: boolean
  /** D5: the request has its reservation and an ISSUED ticket for every covered traveller (after any records step). */
  recordsComplete?: boolean
  /** A reason was given (replace, reissue, revoke). */
  reason?: string
}

export type TicketDocumentCommandName = "issue" | "supersede" | "revoke" | "resend" | "replace" | "reissue"

const ISSUE = ["ticket.document.issue"] as const

export const TICKET_DOCUMENT_TRANSITIONS: TransitionTable<TicketDocumentStatus, TicketDocumentFacts, TicketDocumentCommandName> = {
  issue: {
    from: ["DRAFT"], to: "ISSUED", actor: "STAFF", permissions: ISSUE, label: "Issue",
    guard: (f) => (f.codesMatch === false ? CODE_INTEGRITY_FAILED_REASON : null),
    inputGuard: (f) => (f.recordsComplete === false ? "Record the reservation and tickets first" : f.textWarnings && !f.textWarningsAcknowledged ? "Acknowledge the text warnings first" : null),
  },
  /** Run by the system when the version that replaces this one is issued. */
  supersede: { from: ["ISSUED"], to: "SUPERSEDED", actor: "SYSTEM" },
  revoke: { from: ["DRAFT", "ISSUED"], to: "REVOKED", actor: "STAFF", permissions: ISSUE, label: "Revoke", inputGuard: (f) => (reasonGiven(f.reason) ? null : "A reason is required") },
  // Commands that keep the status: they act on an ISSUED version and create a new one (replace, reissue) or a delivery (resend).
  resend: { from: ["ISSUED"], to: (f) => f.status, actor: "STAFF", permissions: ["ticket.document.resend"], label: "Resend" },
  replace: { from: ["ISSUED"], to: (f) => f.status, actor: "STAFF", permissions: ISSUE, label: "Replace", inputGuard: (f) => (reasonGiven(f.reason) ? null : "A reason is required") },
  reissue: { from: ["ISSUED"], to: (f) => f.status, actor: "STAFF", permissions: ISSUE, label: "Reissue", inputGuard: (f) => (reasonGiven(f.reason) ? null : "A reason is required") },
}

export const CODE_INTEGRITY_FAILED_REASON = "A code in the original is missing or altered in the branded file"

const reasonGiven = (r?: string) => !!r && r.trim().length >= 5

export const TICKET_DOCUMENT_FINAL: readonly TicketDocumentStatus[] = ["SUPERSEDED", "REVOKED"]

/** Customers only ever see the current issued version. */
export const isCustomerVisibleTicketDocument = (s: TicketDocumentStatus) => s === "ISSUED"

/** sha256 of the stored original must equal the value recorded at upload; anything else fails closed (D2). */
export function originalIntact(recorded: string | null | undefined, actual: string): boolean {
  return !!recorded && /^[0-9a-f]{64}$/.test(recorded) && recorded === actual
}

/** D4: codes of the original absent from the branded file, compared by format and exact payload bytes. Returns their indices. */
export function missingCodes(original: readonly { format: string; bytesBase64: string }[], branded: readonly { format: string; bytesBase64: string }[]): number[] {
  const pool = new Map<string, number>()
  for (const c of branded) pool.set(`${c.format}:${c.bytesBase64}`, (pool.get(`${c.format}:${c.bytesBase64}`) ?? 0) + 1)
  const missing: number[] = []
  original.forEach((c, i) => {
    const k = `${c.format}:${c.bytesBase64}`
    const n = pool.get(k) ?? 0
    if (n > 0) pool.set(k, n - 1)
    else missing.push(i)
  })
  return missing
}

/** Text match for D4 warnings: ignores spacing and case, and the hyphen some providers print inside ticket numbers. */
export function textContains(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/[\s\-]/g, "")
  return needle.trim() !== "" && norm(haystack).includes(norm(needle))
}
