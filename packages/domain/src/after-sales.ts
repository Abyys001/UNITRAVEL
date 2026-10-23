import type { AfterSalesStatus } from "@unitravel/contracts"

import type { TransitionTable } from "./machine"

export interface AfterSalesFacts {
  status: AfterSalesStatus
  message?: string
  resolutionNote?: string
}

export type AfterSalesCommandName = "start" | "request_info" | "respond" | "resolve" | "reject"

// Chapter 13.8 — OPEN → IN_PROGRESS → AWAITING_CUSTOMER → RESOLVED / REJECTED.
export const AFTER_SALES_TRANSITIONS: TransitionTable<AfterSalesStatus, AfterSalesFacts, AfterSalesCommandName> = {
  start: { from: ["OPEN"], to: "IN_PROGRESS", actor: "STAFF", permissions: ["flight_request.transition"] },
  request_info: { from: ["IN_PROGRESS"], to: "AWAITING_CUSTOMER", actor: "STAFF", permissions: ["flight_request.transition"], guard: (f) => (f.message ? null : "Message required") },
  respond: { from: ["AWAITING_CUSTOMER"], to: "IN_PROGRESS", actor: "CUSTOMER", guard: (f) => (f.message ? null : "Message required") },
  resolve: { from: ["IN_PROGRESS", "AWAITING_CUSTOMER"], to: "RESOLVED", actor: "STAFF", permissions: ["flight_request.transition"], guard: (f) => (f.resolutionNote ? null : "Resolution note required") },
  reject: { from: ["OPEN", "IN_PROGRESS", "AWAITING_CUSTOMER"], to: "REJECTED", actor: "STAFF", permissions: ["flight_request.transition"], guard: (f) => (f.resolutionNote ? null : "Reason required") },
}
