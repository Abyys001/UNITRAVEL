import type { CargoMilestone, CargoStatus } from "@unitravel/contracts"

/**
 * ADR-0042: cargo last-mile helpers. Framework-free and pure: tracking numbers, the customer milestone derived from
 * the request state and its effective tracking timeline, and the agent's allowed actions.
 */

/** Luhn check digit over a string of digits. */
export function luhnDigit(digits: string): number {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return (10 - (sum % 10)) % 10
}

/** `UT` + 10 random digits + Luhn check digit. `randomDigits` must return 10 decimal digits. */
export function makeTrackingNumber(randomDigits: string): string {
  if (!/^\d{10}$/.test(randomDigits)) throw new Error("ten digits required")
  return `UT${randomDigits}${luhnDigit(randomDigits)}`
}

/** Normalises what a person typed (spaces, dashes, lower case) and checks the format and the check digit. */
export function parseTrackingNumber(input: string): string | null {
  const s = input.replace(/[\s-]/g, "").toUpperCase()
  if (!/^UT\d{11}$/.test(s)) return null
  const body = s.slice(2, 12)
  return luhnDigit(body) === Number(s[12]) ? s : null
}

/** Groups for reading aloud and printing: UT 1234 5678 901. */
export const formatTrackingNumber = (n: string) => `${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6, 10)} ${n.slice(10)}`

export interface MilestoneEvent { eventCode: string; occurredAt: string }

const PRE_CONFIRM: CargoStatus[] = ["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "EXPIRED"]

const latestOf = (events: readonly MilestoneEvent[], codes: readonly string[]) => {
  let last: MilestoneEvent | null = null
  for (const e of events) if (codes.includes(e.eventCode) && (!last || e.occurredAt >= last.occurredAt)) last = e
  return last
}

/**
 * The customer milestone (ADR-0042 D3). The state machine decides the phase; inside a phase the latest effective
 * tracking event refines it (agent assigned, scheduled, failed attempt, sorting facility). Never moves a shipment
 * backwards across phases: once collected, a later "agent assigned" for delivery does not reopen collection.
 */
export function cargoMilestone(status: CargoStatus, exceptionReason: string | null | undefined, events: readonly MilestoneEvent[]): CargoMilestone {
  if (status === "CANCELLED" || status === "DECLINED") return "CANCELLED"
  if (PRE_CONFIRM.includes(status)) return "REQUEST_RECEIVED"
  if (status === "ACCEPTED") return "REQUEST_CONFIRMED"
  if (status === "DELIVERED" || status === "COMPLETED") return "DELIVERED"
  if (status === "EXCEPTION") return exceptionReason === "RETURNED" ? "RETURNED_TO_SENDER" : "ON_HOLD"
  if (status === "BOOKED" || status === "AWAITING_HANDOVER") {
    if (latestOf(events, ["PICKED_UP"])) return "CARGO_COLLECTED"
    const last = latestOf(events, ["COLLECTION_AGENT_ASSIGNED", "COLLECTION_SCHEDULED", "COLLECTION_FAILED"])
    if (last?.eventCode === "COLLECTION_FAILED") return "COLLECTION_FAILED"
    if (last?.eventCode === "COLLECTION_AGENT_ASSIGNED") return "AGENT_ASSIGNED"
    if (last?.eventCode === "COLLECTION_SCHEDULED" || status === "AWAITING_HANDOVER") return "COLLECTION_SCHEDULED"
    return "AWAITING_COLLECTION"
  }
  if (status === "RECEIVED" || status === "IN_TRANSIT" || status === "AT_CUSTOMS") {
    const last = latestOf(events, ["SORTING_FACILITY", "HANDLED", "RECEIVED", "DEPARTED", "ARRIVED", "AT_CUSTOMS", "CLEARED"])
    if (last?.eventCode === "SORTING_FACILITY") return "AT_SORTING_FACILITY"
    return status === "RECEIVED" ? "CARGO_COLLECTED" : "IN_TRANSIT"
  }
  if (status === "OUT_FOR_DELIVERY") {
    const last = latestOf(events, ["OUT_FOR_DELIVERY", "DELIVERY_FAILED"])
    return last?.eventCode === "DELIVERY_FAILED" ? "DELIVERY_FAILED" : "OUT_FOR_DELIVERY"
  }
  return "REQUEST_RECEIVED"
}

/** The happy path shown as a progress bar; the current milestone maps onto one step. */
export const PROGRESS_STEPS: readonly CargoMilestone[] = ["REQUEST_RECEIVED", "REQUEST_CONFIRMED", "CARGO_COLLECTED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"]
const STEP_OF: Record<CargoMilestone, number> = {
  REQUEST_RECEIVED: 0, REQUEST_CONFIRMED: 1, AWAITING_COLLECTION: 1, AGENT_ASSIGNED: 1, COLLECTION_SCHEDULED: 1, COLLECTION_FAILED: 1,
  CARGO_COLLECTED: 2, IN_TRANSIT: 3, AT_SORTING_FACILITY: 3, OUT_FOR_DELIVERY: 4, DELIVERY_FAILED: 4, DELIVERED: 5, RETURNED_TO_SENDER: -1, ON_HOLD: -1, CANCELLED: -1,
}
/** Index of the progress step reached; -1 when the shipment left the happy path (returned, on hold, cancelled). */
export const progressStep = (m: CargoMilestone) => STEP_OF[m]

export type AgentJobKind = "COLLECTION" | "HANDLING" | "DELIVERY"

/**
 * What an assigned agent may do now (ADR-0043; the API re-checks each through the state machine and the stage gate).
 * An OFFERED job can only be accepted or declined; a closed job takes notes only.
 */
export function agentActions(kind: AgentJobKind, assignmentStatus: string, status: CargoStatus, milestone: CargoMilestone): string[] {
  if (assignmentStatus === "OFFERED") return ["accept", "decline"]
  if (assignmentStatus !== "ASSIGNED") return ["note"]
  const tail = ["report_problem", "note"]
  if (kind === "COLLECTION") {
    if (!(status === "BOOKED" || status === "AWAITING_HANDOVER") || milestone === "CARGO_COLLECTED") return tail
    return ["start_collection", "collected", "collection_failed", ...tail]
  }
  if (kind === "HANDLING") {
    if (["RECEIVED", "IN_TRANSIT", "AT_CUSTOMS"].includes(status)) return ["handled", "at_sorting_facility", "handling_done", ...tail]
    return ["handling_done", ...tail]
  }
  // Customs clearance stays with staff; the delivery agent takes over once the shipment is cleared and in transit.
  if (status === "IN_TRANSIT") return ["out_for_delivery", ...tail]
  if (status === "OUT_FOR_DELIVERY") return [...(milestone === "DELIVERY_FAILED" ? ["out_for_delivery"] : []), "delivered", "delivery_failed", ...tail]
  return tail
}

/** Failed delivery attempts after which staff must decide (re-deliver, hold or return to sender). */
export const MAX_DELIVERY_ATTEMPTS = 3
