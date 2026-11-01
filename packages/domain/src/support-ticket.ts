import type { SupportTicketStatus } from "@unitravel/contracts"

import type { TransitionTable } from "./machine"

// Plan J5: OPEN (waiting on us) -> PENDING_CUSTOMER (we replied) -> RESOLVED -> CLOSED. A customer reply reopens a
// pending or resolved ticket; CLOSED is final, so a new problem is a new ticket.

export interface TicketFacts {
  status: SupportTicketStatus
  now: Date
  assigneeCanReply?: boolean
}

export type TicketCommandName = "customer_reply" | "staff_reply" | "assign" | "resolve" | "reopen" | "close" | "auto_close"

const W = ["support.reply"] as const
const LIVE: SupportTicketStatus[] = ["OPEN", "PENDING_CUSTOMER"]

export const TICKET_TRANSITIONS: TransitionTable<SupportTicketStatus, TicketFacts, TicketCommandName> = {
  customer_reply: { from: ["OPEN", "PENDING_CUSTOMER", "RESOLVED"], to: "OPEN", actor: "CUSTOMER" },
  staff_reply: { from: LIVE, to: "PENDING_CUSTOMER", actor: "STAFF", permissions: W, label: "Reply" },
  assign: { from: LIVE, to: (f) => f.status, actor: "STAFF", permissions: W, inputGuard: (f) => (f.assigneeCanReply ? null : "Assignee lacks support.reply"), label: "Assign" },
  resolve: { from: LIVE, to: "RESOLVED", actor: "STAFF", permissions: W, label: "Resolve" },
  reopen: { from: ["RESOLVED"], to: "OPEN", actor: "STAFF", permissions: W, label: "Reopen" },
  close: { from: ["RESOLVED"], to: "CLOSED", actor: "STAFF", permissions: W, label: "Close" },
  auto_close: { from: ["RESOLVED"], to: "CLOSED", actor: "SYSTEM" },
}

export const isTicketOpen = (s: SupportTicketStatus) => s !== "CLOSED"

/** Days a RESOLVED ticket waits for a customer reply before the system closes it. */
export const TICKET_AUTO_CLOSE_DAYS = 7

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
/** `TK-` plus six Crockford characters, like request references but a separate series (never confused with UT-F/C/A/S). */
export function generateTicketRef(randomBytes: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  let code = ""
  for (const b of randomBytes(6)) code += ALPHABET[b & 31]
  return `TK-${code}`
}

export function normaliseTicketRef(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, "").replace(/O/g, "0").replace(/[IL]/g, "1")
  const m = /^TK-?([0-9A-HJKMNP-TV-Z]{6})$/.exec(s)
  return m ? `TK-${m[1]}` : null
}
