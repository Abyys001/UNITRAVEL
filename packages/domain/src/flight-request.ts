import type { FlightRequestStatus, PaymentStatus } from "@unitravel/contracts"

import type { TransitionTable } from "./machine"
import { isRecordLocator } from "./formats"

export const FLIGHT_TERMINAL: readonly FlightRequestStatus[] = ["COMPLETED", "DECLINED", "CANCELLED"]
const NON_TERMINAL: FlightRequestStatus[] = ["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "RESERVED", "TICKETED", "EXPIRED"]
const BEFORE_RESERVED: FlightRequestStatus[] = ["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "EXPIRED"]
const BEFORE_TICKETED: FlightRequestStatus[] = [...BEFORE_RESERVED, "RESERVED"]

export interface QuoteFacts {
  id: string
  status: "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "SUPERSEDED"
  validUntil: Date | null
  /** Per option: attribute paths still UNKNOWN (baggage, change, refund). */
  options: { id: string; unknownFields: string[] }[]
}

export interface FlightFacts {
  status: FlightRequestStatus
  paymentStatus: PaymentStatus
  now: Date
  /** The quote the command refers to (send_quote, accept_quote, record_acceptance). */
  quote?: QuoteFacts
  optionId?: string
  travellerDocumentsComplete?: boolean
  message?: string
  reasonCode?: string
  responseProvided?: boolean
  assigneeCanTransition?: boolean
  acceptanceNote?: { calledAt: Date; note: string }
  reservation?: {
    recordLocator: string
    ticketingDeadline: Date | null
    passengersMatch: boolean
    segmentsMatch: boolean
    mismatchReason?: string
  }
  activeReservation?: { status: "HELD" | "CONFIRMED" | "CANCELLED" | "LAPSED"; ticketingDeadline: Date } | null
  ticketsIssuedForEveryTraveller?: boolean
  creditOverrideApproved?: boolean
  lastSegmentDeparture?: Date | null
  decisionReason?: string
}

export type FlightCommandName =
  | "screen_pass" | "screen_flag" | "release_hold" | "decline" | "claim" | "assign" | "request_info" | "respond"
  | "send_quote" | "accept_quote" | "decline_quote" | "record_acceptance" | "record_reservation" | "record_tickets" | "close"
  | "expire_quote" | "expire_reservation" | "reopen" | "cancel_by_customer" | "cancel" | "complete"

const quoteSendable = (f: FlightFacts): string | null => {
  const q = f.quote
  if (!q) return "No quote selected"
  if (q.status !== "DRAFT") return `Quote is ${q.status}, only a draft can be sent`
  if (q.options.length === 0) return "A quote needs at least one option"
  const missing = q.options.findIndex((o) => o.unknownFields.length > 0)
  if (missing >= 0) return `Option ${missing + 1} needs confirmed ${q.options[missing]!.unknownFields.join(", ")}`
  if (!q.validUntil || q.validUntil <= f.now) return "Quote validity must be in the future"
  return null
}

const quoteAcceptable = (f: FlightFacts): string | null => {
  const q = f.quote
  if (!q) return "No quote selected"
  if (q.status !== "SENT") return `Quote is ${q.status}`
  if (!q.validUntil || q.validUntil <= f.now) return "Quote has expired"
  if (f.optionId && !q.options.some((o) => o.id === f.optionId)) return "Option does not belong to this quote"
  if (!f.optionId) return "Choose an option"
  return null
}

/** Table 13.1 — every command, its states, who may run it and its guards. */
export const FLIGHT_TRANSITIONS: TransitionTable<FlightRequestStatus, FlightFacts, FlightCommandName> = {
  screen_pass: { from: ["SUBMITTED"], to: "NEW", actor: "SYSTEM" },
  screen_flag: { from: ["SUBMITTED"], to: "COMPLIANCE_HOLD", actor: "SYSTEM" },
  release_hold: {
    from: ["COMPLIANCE_HOLD"], to: "NEW", actor: "STAFF", permissions: ["compliance.case.decide"],
    guard: (f) => (f.decisionReason && f.decisionReason.trim().length >= 5 ? null : "A decision reason is required"),
  },
  decline: {
    from: NON_TERMINAL.filter((s) => s !== "TICKETED"), to: "DECLINED", actor: "STAFF", permissions: ["flight_request.transition", "compliance.case.decide"],
    guard: (f) => (!f.reasonCode ? "Reason code required" : !f.message ? "A customer message is required" : null),
  },
  claim: {
    from: ["NEW"], to: "IN_REVIEW", actor: "STAFF", permissions: ["flight_request.assign"],
    guard: (f) => (f.assigneeCanTransition === false ? "Assignee lacks flight_request.transition" : null),
  },
  assign: {
    from: ["NEW", "IN_REVIEW"], to: "IN_REVIEW", actor: "STAFF", permissions: ["flight_request.assign"],
    guard: (f) => (f.assigneeCanTransition ? null : "Assignee lacks flight_request.transition"),
  },
  request_info: {
    from: ["IN_REVIEW"], to: "AWAITING_CUSTOMER", actor: "STAFF", permissions: ["flight_request.transition"],
    guard: (f) => (f.message && f.message.trim() ? null : "A customer-visible message is required"),
  },
  respond: {
    from: ["AWAITING_CUSTOMER"], to: "IN_REVIEW", actor: "CUSTOMER",
    guard: (f) => (f.responseProvided ? null : "A message or the requested data is required"),
  },
  // Re-quoting from QUOTED or ACCEPTED supersedes the earlier quote and needs a new acceptance (ch. 13.6, ADR-0003).
  send_quote: { from: ["IN_REVIEW", "QUOTED", "ACCEPTED"], to: "QUOTED", actor: "STAFF", permissions: ["quote.create"], guard: quoteSendable },
  accept_quote: {
    from: ["QUOTED"], to: "ACCEPTED", actor: "CUSTOMER",
    guard: (f) => quoteAcceptable(f) ?? (f.travellerDocumentsComplete ? null : "Passport details are needed for every traveller"),
  },
  decline_quote: { from: ["QUOTED"], to: "IN_REVIEW", actor: "CUSTOMER", guard: (f) => (f.quote?.status === "SENT" ? null : "No open quote") },
  record_acceptance: {
    from: ["QUOTED"], to: "ACCEPTED", actor: "STAFF", permissions: ["quote.create"],
    guard: (f) => quoteAcceptable(f) ?? (f.acceptanceNote && f.acceptanceNote.note.trim().length >= 3 ? null : "Record the call date/time and a note"),
  },
  record_reservation: {
    from: ["ACCEPTED"], to: "RESERVED", actor: "STAFF", permissions: ["reservation.record"],
    guard: (f) => {
      const r = f.reservation
      if (!r) return "Reservation details required"
      if (!isRecordLocator(r.recordLocator)) return "Record locator must be 6 letters or digits"
      if (!r.ticketingDeadline || r.ticketingDeadline <= f.now) return "Ticketing deadline must be set in the future"
      if ((!r.passengersMatch || !r.segmentsMatch) && !r.mismatchReason?.trim()) return "Passengers and segments differ from the accepted option: record a reason"
      return null
    },
  },
  record_tickets: {
    from: ["RESERVED"], to: "TICKETED", actor: "STAFF", permissions: ["ticket.record"],
    guard: (f) => {
      if (!f.ticketsIssuedForEveryTraveller) return "Every traveller needs one ISSUED ticket"
      if (f.paymentStatus !== "PAID" && !f.creditOverrideApproved) return "Payment status must be PAID, or an owner-approved credit override"
      return null
    },
  },
  close: { from: ["TICKETED"], to: "COMPLETED", actor: "STAFF", permissions: ["flight_request.transition"] },
  expire_quote: {
    from: ["QUOTED"], to: "EXPIRED", actor: "SYSTEM",
    guard: (f) => (f.quote?.validUntil && f.quote.validUntil <= f.now ? null : "Quote is still valid"),
  },
  expire_reservation: {
    from: ["RESERVED"], to: "EXPIRED", actor: "SYSTEM",
    guard: (f) => {
      const r = f.activeReservation
      if (!r) return "No reservation"
      if (r.ticketingDeadline > f.now) return "Deadline has not passed"
      return r.status === "LAPSED" ? null : "Reservation not marked lapsed by admin or supplier"
    },
  },
  reopen: { from: ["EXPIRED"], to: "IN_REVIEW", actor: "STAFF", permissions: ["flight_request.transition"] },
  cancel_by_customer: { from: BEFORE_RESERVED, to: "CANCELLED", actor: "CUSTOMER" },
  cancel: {
    from: BEFORE_TICKETED, to: "CANCELLED", actor: "STAFF", permissions: ["flight_request.transition"],
    guard: (f) => {
      if (f.activeReservation && (f.activeReservation.status === "HELD" || f.activeReservation.status === "CONFIRMED")) return "Cancel the active reservation first and record it"
      return !f.reasonCode ? "Reason code required" : null
    },
  },
  complete: {
    from: ["TICKETED"], to: "COMPLETED", actor: "SYSTEM",
    guard: (f) => (f.lastSegmentDeparture && f.now.getTime() >= f.lastSegmentDeparture.getTime() + 24 * 3600_000 ? null : "Travel not finished"),
  },
}

/** Customer label key: RESERVED reads "Awaiting payment" until paid, then "Issuing ticket" (ch. 13.2). */
export function reservedLabelKey(paymentStatus: PaymentStatus): "AWAITING_PAYMENT" | "ISSUING_TICKET" {
  return paymentStatus === "PAID" ? "ISSUING_TICKET" : "AWAITING_PAYMENT"
}
