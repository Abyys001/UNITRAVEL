import { SERVICE_TERMINAL, type ServiceRequestStatus, type ServiceRequestType } from "@unitravel/contracts"

import type { TransitionTable } from "./machine"

// ADR-0015, spec §4.2: SUBMITTED → IN_PROGRESS → QUOTED → CONFIRMED → COMPLETED. Screening at submit can hold
// (COMPLIANCE_HOLD) or block (DECLINED). A tour call-back is a call, never a sale: it completes from IN_PROGRESS and
// can never be quoted (O10).

export interface ServiceFacts {
  status: ServiceRequestStatus
  type: ServiceRequestType
  now: Date
  quote?: { status: string; validUntil: Date | null; linesComplete: boolean }
  reason?: string
  note?: string
  assigneeCanWrite?: boolean
}

export type ServiceCommandName =
  | "screen_flag" | "screen_block" | "release_hold" | "claim" | "assign" | "send_quote" | "accept_quote" | "decline_quote"
  | "record_acceptance" | "complete" | "cancel_by_customer" | "cancel" | "decline" | "close_no_response"

const W = ["service_request.write"] as const
const OPEN: ServiceRequestStatus[] = ["SUBMITTED", "COMPLIANCE_HOLD", "IN_PROGRESS", "QUOTED", "CONFIRMED"]
/** The customer may cancel until the service is confirmed (spec §4.2). */
const BEFORE_CONFIRMED: ServiceRequestStatus[] = ["SUBMITTED", "COMPLIANCE_HOLD", "IN_PROGRESS", "QUOTED"]

const reasonGiven = (f: ServiceFacts) => (f.reason && f.reason.trim().length >= 5 ? null : "A reason of at least 5 characters is required")
const noteGiven = (f: ServiceFacts) => (f.note && f.note.trim().length >= 3 ? null : "A note is required")
const quoteValid = (f: ServiceFacts) => (f.quote?.status === "SENT" && f.quote.validUntil && f.quote.validUntil > f.now ? null : "Quote is not valid")

export const SERVICE_TRANSITIONS: TransitionTable<ServiceRequestStatus, ServiceFacts, ServiceCommandName> = {
  screen_flag: { from: ["SUBMITTED"], to: "COMPLIANCE_HOLD", actor: "SYSTEM" },
  screen_block: { from: ["SUBMITTED"], to: "DECLINED", actor: "SYSTEM" },
  release_hold: { from: ["COMPLIANCE_HOLD"], to: "SUBMITTED", actor: "STAFF", permissions: ["compliance.case.decide"], inputGuard: reasonGiven, label: "Release hold" },
  claim: { from: ["SUBMITTED"], to: "IN_PROGRESS", actor: "STAFF", permissions: W, label: "Claim" },
  assign: {
    from: ["SUBMITTED", "IN_PROGRESS", "QUOTED", "CONFIRMED"], to: (f) => (f.status === "SUBMITTED" ? "IN_PROGRESS" : f.status), actor: "STAFF", permissions: W,
    inputGuard: (f) => (f.assigneeCanWrite ? null : "Assignee lacks service_request.write"), label: "Assign",
  },
  send_quote: {
    from: ["IN_PROGRESS", "QUOTED"], to: "QUOTED", actor: "STAFF", permissions: W, label: "Send quote",
    guard: (f) => (f.type === "TOUR_CALLBACK" ? "A tour call-back is not quoted (no package sale)" : null),
    inputGuard: (f) => (!f.quote ? "No quote" : !f.quote.linesComplete ? "Quote lines are incomplete" : !f.quote.validUntil || f.quote.validUntil <= f.now ? "Validity must be in the future" : null),
  },
  accept_quote: { from: ["QUOTED"], to: "CONFIRMED", actor: "CUSTOMER", guard: quoteValid },
  decline_quote: { from: ["QUOTED"], to: "IN_PROGRESS", actor: "CUSTOMER" },
  record_acceptance: { from: ["QUOTED"], to: "CONFIRMED", actor: "STAFF", permissions: W, guard: quoteValid, inputGuard: noteGiven, label: "Record acceptance" },
  complete: {
    from: ["IN_PROGRESS", "CONFIRMED"], to: "COMPLETED", actor: "STAFF", permissions: W, inputGuard: noteGiven, label: "Complete",
    guard: (f) => (f.status === "IN_PROGRESS" && f.type !== "TOUR_CALLBACK" ? "Only a tour call-back completes without a confirmed quote" : null),
  },
  cancel_by_customer: { from: BEFORE_CONFIRMED, to: "CANCELLED", actor: "CUSTOMER" },
  cancel: { from: OPEN, to: "CANCELLED", actor: "STAFF", permissions: W, inputGuard: reasonGiven, label: "Cancel" },
  decline: { from: ["SUBMITTED", "COMPLIANCE_HOLD", "IN_PROGRESS"], to: "DECLINED", actor: "STAFF", permissions: ["service_request.write", "compliance.case.decide"], inputGuard: reasonGiven, label: "Decline" },
  close_no_response: { from: ["IN_PROGRESS", "QUOTED"], to: "CLOSED_NO_RESPONSE", actor: "SYSTEM" },
}

export const isServiceTerminal = (s: ServiceRequestStatus) => SERVICE_TERMINAL.includes(s)
