import { z } from "zod"

import { IsoDateTime, Uuid } from "./common"
import { CaseDecision, CaseStatus, CaseTrigger, PolicyAction, PolicyType, RequestType, ScreeningResult, ScreeningSubject } from "./enums"

export const PolicyBody = z.object({
  type: PolicyType,
  key: z.string().min(1).max(120),
  action: PolicyAction,
  reason: z.string().min(3).max(500),
  counselReference: z.string().max(120).optional(),
  effectiveFrom: IsoDateTime.optional(),
})
export const PolicyView = PolicyBody.extend({
  id: Uuid, version: z.number().int(), approvedBy: z.string().nullable(), approvedAt: IsoDateTime.nullable(), status: z.enum(["PENDING_APPROVAL", "ACTIVE", "RETIRED"]),
  createdBy: z.string(),
})
export type PolicyView = z.infer<typeof PolicyView>

export const ScreeningHitView = z.object({
  entryId: Uuid, listId: z.string(), externalId: z.string(), matchedName: z.string(), score: z.number(), reasons: z.array(z.string()), programmes: z.array(z.string()),
})

export const ScreeningView = z.object({
  id: Uuid, subjectType: ScreeningSubject, subjectName: z.string(), result: ScreeningResult, listsVersion: z.record(z.string(), z.string()), createdAt: IsoDateTime,
  hits: z.array(ScreeningHitView),
})

export const CaseView = z.object({
  id: Uuid,
  requestType: RequestType,
  requestRef: z.string(),
  trigger: CaseTrigger,
  status: CaseStatus,
  summary: z.string(),
  evidence: z.array(z.object({ kind: z.string(), label: z.string(), detail: z.string(), score: z.number().optional() })),
  screenings: z.array(ScreeningView),
  decisions: z.array(z.object({ id: Uuid, decision: CaseDecision, reason: z.string(), decidedBy: z.string(), secondApprover: z.string().nullable(), counselReference: z.string().nullable(), createdAt: IsoDateTime, supersedes: Uuid.nullable() })),
  openedAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
  assignedTo: z.string().nullable(),
  requiresFourEyes: z.boolean(),
  pendingOverride: z.object({ decisionId: Uuid, requestedBy: z.string() }).nullable(),
})
export type CaseView = z.infer<typeof CaseView>

export const DecideBody = z.object({
  decision: CaseDecision,
  reason: z.string().min(5).max(2000),
  reasonCode: z.string().optional(),
  customerMessage: z.string().max(2000).optional(),
  counselReference: z.string().max(120).optional(),
  /** Approving a pending four-eyes override. */
  approveOverrideOf: Uuid.optional(),
})

export const ScreenAdHocBody = z.object({ name: z.string().min(2).max(200), dateOfBirth: z.string().optional(), nationality: z.string().length(2).optional(), nameFa: z.string().optional() })
