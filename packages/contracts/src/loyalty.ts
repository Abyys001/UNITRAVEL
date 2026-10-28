import { z } from "zod"

import { IsoDateTime, Money, Uuid } from "./common"

// ADR-0016: customer club. Staff add members and grant benefits; a benefit reaches money only as its own line on a
// quotation built by staff. Supplier prices are never altered, issued invoices stay frozen (ADR-0006), bonus credit has
// no cash value. VAT treatment of discounts is UNKNOWN (accountant, O12).

export const LoyaltyMemberStatus = z.enum(["ACTIVE", "SUSPENDED", "REMOVED"])
export const LoyaltyBenefitKind = z.enum(["DISCOUNT_PERCENT", "DISCOUNT_FIXED", "BONUS_CREDIT", "PERK"])
export const LoyaltyAppliesTo = z.enum(["FLIGHT", "CARGO", "SERVICE", "ANY"])
export const LoyaltyBenefitStatus = z.enum(["PENDING_APPROVAL", "ACTIVE", "EXPIRED", "REVOKED"])
export const LoyaltyLedgerKind = z.enum(["GRANTED", "USED", "EXPIRED", "REVERSED"])

export const LoyaltyTierView = z.object({ id: Uuid, code: z.string(), nameEn: z.string(), nameFa: z.string(), active: z.boolean() })
export type LoyaltyTierView = z.infer<typeof LoyaltyTierView>
export const LoyaltyTierBody = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,23}$/),
  nameEn: z.string().trim().min(1).max(60),
  nameFa: z.string().trim().min(1).max(60),
  active: z.boolean().default(true),
})

export const LoyaltyMemberView = z.object({
  userId: Uuid,
  name: z.string(),
  tier: LoyaltyTierView,
  status: LoyaltyMemberStatus,
  joinedAt: IsoDateTime,
  addedBy: z.string(),
  note: z.string().nullable(),
  creditBalance: z.array(Money),
})
export type LoyaltyMemberView = z.infer<typeof LoyaltyMemberView>
export const AddMemberBody = z.object({ userId: Uuid, tierId: Uuid, note: z.string().trim().max(500).optional() })
export const UpdateMemberBody = z.object({ tierId: Uuid.optional(), status: LoyaltyMemberStatus.optional(), note: z.string().trim().max(500).optional(), reason: z.string().trim().min(5).max(500) })

export const LoyaltyBenefitBody = z
  .object({
    kind: LoyaltyBenefitKind,
    /** Percent for DISCOUNT_PERCENT (1–100); minor units for DISCOUNT_FIXED and BONUS_CREDIT; 0 for PERK. */
    value: z.number().int().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    appliesTo: LoyaltyAppliesTo,
    tierId: Uuid.optional(),
    userId: Uuid.optional(),
    description: z.object({ en: z.string().trim().min(1).max(200), fa: z.string().trim().min(1).max(200) }),
    validFrom: IsoDateTime,
    validTo: IsoDateTime,
  })
  .superRefine((b, ctx) => {
    if (!!b.tierId === !!b.userId) ctx.addIssue({ code: "custom", path: ["tierId"], message: "A benefit is for one tier or one member" })
    if (b.validTo <= b.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "The end must be after the start" })
    if (b.kind === "DISCOUNT_PERCENT" && (b.value < 1 || b.value > 100)) ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage is between 1 and 100" })
    if ((b.kind === "DISCOUNT_FIXED" || b.kind === "BONUS_CREDIT") && (b.value < 1 || !b.currency)) ctx.addIssue({ code: "custom", path: ["value"], message: "An amount and currency are required" })
    if (b.kind === "PERK" && b.value !== 0) ctx.addIssue({ code: "custom", path: ["value"], message: "A perk has no amount" })
  })
export type LoyaltyBenefitBody = z.infer<typeof LoyaltyBenefitBody>

export const LoyaltyBenefitView = z.object({
  id: Uuid,
  kind: LoyaltyBenefitKind,
  value: z.number().int(),
  currency: z.string().nullable(),
  appliesTo: LoyaltyAppliesTo,
  tierId: Uuid.nullable(),
  userId: Uuid.nullable(),
  description: z.object({ en: z.string(), fa: z.string() }),
  validFrom: IsoDateTime,
  validTo: IsoDateTime,
  status: LoyaltyBenefitStatus,
  createdBy: z.string(),
  approvedBy: z.string().nullable(),
  needsApproval: z.boolean(),
})
export type LoyaltyBenefitView = z.infer<typeof LoyaltyBenefitView>

export const LoyaltyLedgerEntry = z.object({
  id: Uuid,
  userId: Uuid,
  kind: LoyaltyLedgerKind,
  amount: Money,
  reason: z.string(),
  actor: z.string(),
  invoiceNumber: z.string().nullable(),
  createdAt: IsoDateTime,
})
export type LoyaltyLedgerEntry = z.infer<typeof LoyaltyLedgerEntry>
export const LedgerEntryBody = z.object({ userId: Uuid, kind: z.enum(["GRANTED", "USED", "REVERSED"]), amount: Money, reason: z.string().trim().min(5).max(500), invoiceId: Uuid.optional() })

/**
 * Customer view of their own membership; non-members get `member: null` and see the explanation. `enabled: false` while
 * loyalty.enabled is off (a feature state, not a permission refusal, so the route stays 200 for holders of loyalty.read.own).
 */
export const CustomerClubView = z.object({
  enabled: z.boolean(),
  member: z.object({ tier: z.object({ code: z.string(), nameEn: z.string(), nameFa: z.string() }), status: LoyaltyMemberStatus, joinedAt: IsoDateTime }).nullable(),
  benefits: z.array(LoyaltyBenefitView.pick({ id: true, kind: true, value: true, currency: true, appliesTo: true, description: true, validFrom: true, validTo: true })),
  creditBalance: z.array(Money),
})
export type CustomerClubView = z.infer<typeof CustomerClubView>

// ---- staff queries and commands (console club pages) ----
export const MemberListQuery = z.object({
  status: LoyaltyMemberStatus.optional(),
  tierId: Uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})
export const BenefitListQuery = z.object({
  userId: Uuid.optional(),
  tierId: Uuid.optional(),
  status: LoyaltyBenefitStatus.optional(),
  /** For the quote builder: benefits the customer can use now (theirs or their tier's, ACTIVE, inside the window). */
  usableBy: Uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})
export const LedgerQuery = z.object({ userId: Uuid, limit: z.coerce.number().int().min(1).max(200).default(100) })
export const RevokeBenefitBody = z.object({ reason: z.string().trim().min(5).max(500) })
/** A staff member picking a customer to enrol: matches email, phone or name. */
export const ClubCandidateQuery = z.object({ q: z.string().trim().min(2).max(80) })
export const ClubCandidate = z.object({ userId: Uuid, name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), member: z.boolean() })
export type ClubCandidate = z.infer<typeof ClubCandidate>
