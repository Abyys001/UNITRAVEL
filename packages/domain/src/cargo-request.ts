import type { CargoStatus } from "@unitravel/contracts"

import type { TransitionTable } from "./machine"
import { validateAwb } from "./formats"

const NON_TERMINAL: CargoStatus[] = [
  "SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "BOOKED", "AWAITING_HANDOVER",
  "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION", "EXPIRED",
]
/** Cancel only before RECEIVED (ch. 14.5). */
const BEFORE_RECEIVED: CargoStatus[] = ["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "EXPIRED"]
const IN_FULFILMENT: CargoStatus[] = ["BOOKED", "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY"]

export interface CargoFacts {
  status: CargoStatus
  now: Date
  quote?: { status: string; validUntil: Date | null; linesComplete: boolean }
  message?: string
  reasonCode?: string
  responseProvided?: boolean
  assigneeCanTransition?: boolean
  acceptanceNote?: string
  partner?: { servesLaneAndService: boolean; complianceCleared: boolean }
  awbNumber?: string
  /** Re-weigh at RECEIVED: change in chargeable weight in percent, compared with the tolerance. */
  reweighChangePct?: number
  reweighTolerancePct?: number
  exceptionResumeTo?: CargoStatus
  exceptionReason?: string
  revisedQuoteAccepted?: boolean
  podName?: string
  decisionReason?: string
}

export type CargoCommandName =
  | "screen_pass" | "screen_flag" | "screen_prohibited" | "release_hold" | "claim" | "assign" | "request_info" | "respond" | "send_quote"
  | "accept_quote" | "decline_quote" | "record_acceptance" | "record_booking" | "schedule_handover" | "receive" | "depart" | "arrive_customs"
  | "clear_customs" | "out_for_delivery" | "deliver" | "close" | "raise_exception" | "resolve_exception" | "accept_revised_quote"
  | "cancel_by_customer" | "cancel" | "decline" | "expire_quote" | "reopen"

const P = ["cargo_request.transition"] as const

export const CARGO_TRANSITIONS: TransitionTable<CargoStatus, CargoFacts, CargoCommandName> = {
  screen_pass: { from: ["SUBMITTED"], to: "NEW", actor: "SYSTEM" },
  screen_flag: { from: ["SUBMITTED"], to: "COMPLIANCE_HOLD", actor: "SYSTEM" },
  screen_prohibited: { from: ["SUBMITTED"], to: "DECLINED", actor: "SYSTEM" },
  release_hold: { from: ["COMPLIANCE_HOLD"], to: "NEW", actor: "STAFF", permissions: ["compliance.case.decide"], inputGuard: (f) => (f.decisionReason && f.decisionReason.length >= 5 ? null : "A decision reason is required") },
  claim: { from: ["NEW"], to: "IN_REVIEW", actor: "STAFF", permissions: P },
  assign: { from: ["NEW", "IN_REVIEW"], to: "IN_REVIEW", actor: "STAFF", permissions: P, inputGuard: (f) => (f.assigneeCanTransition ? null : "Assignee lacks cargo_request.transition") },
  request_info: { from: ["IN_REVIEW"], to: "AWAITING_CUSTOMER", actor: "STAFF", permissions: P, inputGuard: (f) => (f.message?.trim() ? null : "A customer-visible message is required") },
  respond: { from: ["AWAITING_CUSTOMER"], to: "IN_REVIEW", actor: "CUSTOMER", inputGuard: (f) => (f.responseProvided ? null : "A message or the requested documents are required") },
  send_quote: {
    from: ["IN_REVIEW", "QUOTED"], to: "QUOTED", actor: "STAFF", permissions: P,
    guard: (f) => (!f.quote ? "No quote" : f.quote.status !== "DRAFT" ? "Only a draft can be sent" : !f.quote.linesComplete ? "Quote lines are incomplete" : !f.quote.validUntil || f.quote.validUntil <= f.now ? "Validity must be in the future" : null),
  },
  accept_quote: { from: ["QUOTED"], to: "ACCEPTED", actor: "CUSTOMER", guard: (f) => (f.quote?.status === "SENT" && f.quote.validUntil && f.quote.validUntil > f.now ? null : "Quote is not valid") },
  decline_quote: { from: ["QUOTED"], to: "IN_REVIEW", actor: "CUSTOMER" },
  record_acceptance: { from: ["QUOTED"], to: "ACCEPTED", actor: "STAFF", permissions: P, guard: (f) => (f.quote?.status === "SENT" ? null : "Only a sent quote can be accepted"), inputGuard: (f) => (f.acceptanceNote?.trim() ? null : "Record the call and a note") },
  record_booking: {
    from: ["ACCEPTED"], to: "BOOKED", actor: "STAFF", permissions: P,
    inputGuard: (f) => {
      if (!f.partner) return "Choose a partner"
      if (!f.partner.servesLaneAndService) return "Partner does not serve this lane and service"
      if (!f.partner.complianceCleared) return "Partner is not compliance-cleared"
      if (f.awbNumber) { const r = validateAwb(f.awbNumber); if (!r.ok) return r.reason }
      return null
    },
  },
  schedule_handover: { from: ["BOOKED"], to: "AWAITING_HANDOVER", actor: "STAFF", permissions: P },
  receive: {
    from: ["AWAITING_HANDOVER"], actor: "STAFF", permissions: P,
    to: (f) => (Math.abs(f.reweighChangePct ?? 0) > (f.reweighTolerancePct ?? 5) ? "EXCEPTION" : "RECEIVED"),
  },
  depart: { from: ["RECEIVED"], to: "IN_TRANSIT", actor: "STAFF", permissions: P },
  arrive_customs: { from: ["IN_TRANSIT"], to: "AT_CUSTOMS", actor: "STAFF", permissions: P },
  clear_customs: { from: ["AT_CUSTOMS"], to: "OUT_FOR_DELIVERY", actor: "STAFF", permissions: P },
  out_for_delivery: { from: ["IN_TRANSIT"], to: "OUT_FOR_DELIVERY", actor: "STAFF", permissions: P },
  deliver: { from: ["OUT_FOR_DELIVERY"], to: "DELIVERED", actor: "STAFF", permissions: P, inputGuard: (f) => (f.podName?.trim() ? null : "Proof of delivery is required") },
  close: { from: ["DELIVERED"], to: "COMPLETED", actor: "STAFF", permissions: P },
  raise_exception: { from: IN_FULFILMENT, to: "EXCEPTION", actor: "STAFF", permissions: P, inputGuard: (f) => (f.exceptionReason ? null : "Reason required") },
  resolve_exception: {
    from: ["EXCEPTION"], actor: "STAFF", permissions: P,
    to: (f) => f.exceptionResumeTo ?? "RECEIVED",
    guard: (f) => (f.exceptionReason === "REWEIGH" && !f.revisedQuoteAccepted ? "The customer must accept the revised quote first" : null),
  },
  accept_revised_quote: {
    from: ["EXCEPTION"], to: (f) => f.exceptionResumeTo ?? "RECEIVED", actor: "CUSTOMER",
    guard: (f) => (f.exceptionReason !== "REWEIGH" ? "No revised quote is pending" : f.quote?.status === "SENT" && f.quote.validUntil && f.quote.validUntil > f.now ? null : "Revised quote is not valid"),
  },
  cancel_by_customer: { from: BEFORE_RECEIVED.filter((s) => s !== "BOOKED" && s !== "AWAITING_HANDOVER"), to: "CANCELLED", actor: "CUSTOMER" },
  cancel: { from: BEFORE_RECEIVED, to: "CANCELLED", actor: "STAFF", permissions: P, inputGuard: (f) => (f.reasonCode ? null : "Reason code required") },
  decline: { from: NON_TERMINAL.filter((s) => !IN_FULFILMENT.includes(s) && s !== "DELIVERED"), to: "DECLINED", actor: "STAFF", permissions: [...P, "compliance.case.decide"], inputGuard: (f) => (f.reasonCode && f.message ? null : "Reason code and customer message required") },
  expire_quote: { from: ["QUOTED"], to: "EXPIRED", actor: "SYSTEM", guard: (f) => (f.quote?.validUntil && f.quote.validUntil <= f.now ? null : "Quote still valid") },
  reopen: { from: ["EXPIRED"], to: "IN_REVIEW", actor: "STAFF", permissions: P },
}

/** Chapter 14.3: volumetric = L × W × H ÷ divisor; chargeable = max(actual, volumetric). Always labelled an estimate. */
export function cargoWeights(pieces: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number; verifiedWeightKg?: number | null }[], divisor: number) {
  const round = (n: number) => Math.round(n * 100) / 100
  const actualKg = round(pieces.reduce((s, p) => s + (p.verifiedWeightKg ?? p.weightKg), 0))
  const volumetricKg = round(pieces.reduce((s, p) => s + (p.lengthCm * p.widthCm * p.heightCm) / divisor, 0))
  return { actualKg, volumetricKg, chargeableKg: Math.max(actualKg, volumetricKg), divisor, estimate: true as const }
}
