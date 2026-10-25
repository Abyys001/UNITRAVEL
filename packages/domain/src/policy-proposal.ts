import type { TransitionTable } from "./machine"

export type PolicyProposalStatus = "PENDING_APPROVAL" | "ACTIVE" | "RETIRED" | "REJECTED" | "WITHDRAWN"
export type PolicyProposalCommand = "approve" | "reject" | "withdraw"

export interface PolicyProposalFacts {
  status: PolicyProposalStatus
  createdBy: string
  actorId: string
  /** Only an owner approves or rejects (ch. 24.4 "owner approval for changes"). */
  actorIsOwner: boolean
  reason?: string
}

/**
 * A policy proposal is decided exactly once and never auto-approved (CLAUDE.md rule 5). Approval and rejection are the
 * owner's (approval also needs someone other than the author); only the proposer may withdraw (ADR-0008 W5).
 * Rejection and withdrawal leave the active policy untouched.
 */
export const POLICY_PROPOSAL_TRANSITIONS: TransitionTable<PolicyProposalStatus, PolicyProposalFacts, PolicyProposalCommand> = {
  approve: {
    from: ["PENDING_APPROVAL"], to: "ACTIVE", actor: "STAFF", permissions: ["compliance.case.decide"],
    guard: (f) => (!f.actorIsOwner ? "Policies are approved by an owner" : f.createdBy === f.actorId ? "A policy must be approved by someone other than its author" : null),
  },
  reject: {
    from: ["PENDING_APPROVAL"], to: "REJECTED", actor: "STAFF", permissions: ["compliance.case.decide"],
    guard: (f) => (f.actorIsOwner ? null : "Policies are rejected by an owner"),
    inputGuard: (f) => ((f.reason?.trim().length ?? 0) >= 3 ? null : "A reason is required"),
  },
  withdraw: {
    from: ["PENDING_APPROVAL"], to: "WITHDRAWN", actor: "STAFF", permissions: ["compliance.case.decide"],
    guard: (f) => (f.createdBy === f.actorId ? null : "Only the proposer can withdraw a proposal"),
  },
}
