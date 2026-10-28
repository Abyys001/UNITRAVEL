import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"

import type {
  ClubCandidate, CustomerClubView, LoyaltyBenefitBody, LoyaltyBenefitView, LoyaltyLedgerEntry, LoyaltyMemberView, LoyaltyTierView, Money,
} from "@unitravel/contracts"
import {
  type Db, type DbOrTx, invoices, loyaltyBenefits, loyaltyLedger, loyaltyMembers, loyaltyTiers, roles, type Tx, userIdentities, userRoles, users,
} from "@unitravel/db"
import { benefitNeedsApproval, canDebit, effectiveBenefitStatus, ledgerBalance } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { OutboxService } from "../platform/outbox.service"

type Tier = typeof loyaltyTiers.$inferSelect
type Member = typeof loyaltyMembers.$inferSelect
type Benefit = typeof loyaltyBenefits.$inferSelect
type Ctx = { requestId: string }

const iso = (d: Date) => d.toISOString()
const tierView = (t: Tier): LoyaltyTierView => ({ id: t.id, code: t.code, nameEn: t.nameEn, nameFa: t.nameFa, active: t.active })
const toMoney = (balance: Record<string, number>): Money[] =>
  Object.entries(balance).filter(([, v]) => v > 0).sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => ({ amountMinor, currency }))

/**
 * Customer club (ADR-0016, spec §4.4). Staff enrol customers into a tier and grant benefits; a benefit reaches money only
 * as its own line on a quote (validated in `club-discount.hook.ts`), bonus credit only through the insert-only ledger.
 * Every change is audited; four eyes above the payment threshold or a 10 % discount.
 */
@Injectable()
export class LoyaltyService {
  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly config: ConfigService) {}

  private threshold() {
    return this.config.get("WORKFLOW").paymentFourEyesThresholdMinor
  }

  private async names(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))]
    if (!list.length) return new Map()
    const rows = await this.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, list))
    return new Map(rows.map((r) => [r.id, r.name]))
  }

  private async balances(userIds: string[], tx: DbOrTx = this.db): Promise<Map<string, Record<string, number>>> {
    const out = new Map<string, Record<string, number>>()
    if (!userIds.length) return out
    const rows = await tx.select({ userId: loyaltyLedger.userId, kind: loyaltyLedger.kind, amountMinor: loyaltyLedger.amountMinor, currency: loyaltyLedger.currency }).from(loyaltyLedger).where(inArray(loyaltyLedger.userId, userIds))
    for (const id of userIds) out.set(id, ledgerBalance(rows.filter((r) => r.userId === id)))
    return out
  }

  // ---- tiers ----
  async tiers(): Promise<LoyaltyTierView[]> {
    return (await this.db.select().from(loyaltyTiers).orderBy(loyaltyTiers.code)).map(tierView)
  }

  async createTier(body: { code: string; nameEn: string; nameFa: string; active: boolean }, actor: Actor, ctx: Ctx): Promise<LoyaltyTierView> {
    return this.uow.run(async (tx) => {
      const [dup] = await tx.select({ id: loyaltyTiers.id }).from(loyaltyTiers).where(eq(loyaltyTiers.code, body.code))
      if (dup) throw new AppError("VALIDATION_FAILED", "A tier with this code exists", [{ path: "code", code: "DUPLICATE" }])
      const [t] = await tx.insert(loyaltyTiers).values(body).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "loyalty.tier_created", entityType: "loyalty_tier", entityId: t!.id, after: body, ip: actor.ip, requestId: ctx.requestId })
      return tierView(t!)
    })
  }

  async updateTier(id: string, body: { code: string; nameEn: string; nameFa: string; active: boolean }, actor: Actor, ctx: Ctx): Promise<LoyaltyTierView> {
    return this.uow.run(async (tx) => {
      const [before] = await tx.select().from(loyaltyTiers).where(eq(loyaltyTiers.id, id)).for("update")
      if (!before) throw notFound("Tier")
      if (body.code !== before.code) {
        const [dup] = await tx.select({ id: loyaltyTiers.id }).from(loyaltyTiers).where(eq(loyaltyTiers.code, body.code))
        if (dup) throw new AppError("VALIDATION_FAILED", "A tier with this code exists", [{ path: "code", code: "DUPLICATE" }])
      }
      const [t] = await tx.update(loyaltyTiers).set(body).where(eq(loyaltyTiers.id, id)).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "loyalty.tier_updated", entityType: "loyalty_tier", entityId: id, before: tierView(before), after: body, ip: actor.ip, requestId: ctx.requestId })
      return tierView(t!)
    })
  }

  // ---- members ----
  /** Customers a staff member may enrol: customer-role accounts matching an email, phone or name. */
  async candidates(q: string): Promise<ClubCandidate[]> {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    const customerIds = this.db.select({ id: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(roles.key, "customer"))
    const matched = await this.db.selectDistinct({ id: users.id, name: users.displayName }).from(users)
      .leftJoin(userIdentities, and(eq(userIdentities.userId, users.id), isNull(userIdentities.revokedAt)))
      .where(and(inArray(users.id, customerIds), eq(users.status, "ACTIVE"), or(ilike(users.displayName, like), ilike(userIdentities.valueNormalised, like))))
      .limit(20)
    if (!matched.length) return []
    const ids = matched.map((m) => m.id)
    const idents = await this.db.select({ userId: userIdentities.userId, type: userIdentities.type, value: userIdentities.valueNormalised }).from(userIdentities).where(and(inArray(userIdentities.userId, ids), isNull(userIdentities.revokedAt)))
    const members = new Set((await this.db.select({ id: loyaltyMembers.userId }).from(loyaltyMembers).where(inArray(loyaltyMembers.userId, ids))).map((m) => m.id))
    return matched.map((m) => ({
      userId: m.id, name: m.name,
      email: idents.find((i) => i.userId === m.id && i.type === "EMAIL")?.value ?? null,
      phone: idents.find((i) => i.userId === m.id && i.type === "PHONE")?.value ?? null,
      member: members.has(m.id),
    }))
  }

  private async memberViews(rows: Member[]): Promise<LoyaltyMemberView[]> {
    if (!rows.length) return []
    const tiers = new Map((await this.db.select().from(loyaltyTiers).where(inArray(loyaltyTiers.id, [...new Set(rows.map((r) => r.tierId))]))).map((t) => [t.id, t]))
    const names = await this.names(rows.flatMap((r) => [r.userId, r.addedBy]))
    const bal = await this.balances(rows.map((r) => r.userId))
    return rows.map((r) => ({
      userId: r.userId, name: names.get(r.userId) ?? "", tier: tierView(tiers.get(r.tierId)!), status: r.status, joinedAt: iso(r.joinedAt),
      addedBy: names.get(r.addedBy) ?? "", note: r.note, creditBalance: toMoney(bal.get(r.userId) ?? {}),
    }))
  }

  async members(q: { status?: Member["status"]; tierId?: string; limit: number }): Promise<LoyaltyMemberView[]> {
    const where = and(q.status ? eq(loyaltyMembers.status, q.status) : undefined, q.tierId ? eq(loyaltyMembers.tierId, q.tierId) : undefined)
    return this.memberViews(await this.db.select().from(loyaltyMembers).where(where).orderBy(desc(loyaltyMembers.joinedAt)).limit(q.limit))
  }

  async member(userId: string): Promise<LoyaltyMemberView> {
    const [m] = await this.db.select().from(loyaltyMembers).where(eq(loyaltyMembers.userId, userId))
    if (!m) throw notFound("Member")
    return (await this.memberViews([m]))[0]!
  }

  private async activeTier(tx: DbOrTx, tierId: string): Promise<Tier> {
    const [t] = await tx.select().from(loyaltyTiers).where(eq(loyaltyTiers.id, tierId))
    if (!t || !t.active) throw new AppError("VALIDATION_FAILED", "Choose an active tier", [{ path: "tierId", code: "INVALID" }])
    return t
  }

  async addMember(body: { userId: string; tierId: string; note?: string }, actor: Actor, ctx: Ctx): Promise<LoyaltyMemberView> {
    await this.uow.run(async (tx) => {
      const tier = await this.activeTier(tx, body.tierId)
      const [u] = await tx.select({ id: users.id, status: users.status }).from(users)
        .where(and(eq(users.id, body.userId), inArray(users.id, tx.select({ id: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(roles.key, "customer")))))
      if (!u || u.status !== "ACTIVE") throw new AppError("VALIDATION_FAILED", "Choose an active customer account", [{ path: "userId", code: "INVALID" }])
      const [existing] = await tx.select().from(loyaltyMembers).where(eq(loyaltyMembers.userId, body.userId)).for("update")
      if (existing && existing.status !== "REMOVED") throw new AppError("VALIDATION_FAILED", "This customer is already a member", [{ path: "userId", code: "ALREADY_MEMBER" }])
      if (existing) {
        await tx.update(loyaltyMembers).set({ tierId: tier.id, status: "ACTIVE", joinedAt: new Date(), addedBy: actor.userId, note: body.note ?? null, version: sql`${loyaltyMembers.version} + 1` }).where(eq(loyaltyMembers.userId, body.userId))
      } else {
        await tx.insert(loyaltyMembers).values({ userId: body.userId, tierId: tier.id, addedBy: actor.userId, note: body.note ?? null })
      }
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "loyalty.member_added", entityType: "loyalty_member", entityId: body.userId, after: { tier: tier.code }, ip: actor.ip, requestId: ctx.requestId })
      await this.outbox.add(tx, { aggregateType: "loyalty_member", aggregateId: body.userId, eventType: "loyalty.member_added", payload: { customerUserId: body.userId, tier: tier.nameEn, tier_fa: tier.nameFa }, dedupeKey: `loyalty-added:${body.userId}:${Date.now()}` })
    })
    return this.member(body.userId)
  }

  async updateMember(userId: string, body: { tierId?: string; status?: Member["status"]; note?: string; reason: string }, actor: Actor, ctx: Ctx): Promise<LoyaltyMemberView> {
    await this.uow.run(async (tx) => {
      const [before] = await tx.select().from(loyaltyMembers).where(eq(loyaltyMembers.userId, userId)).for("update")
      if (!before) throw notFound("Member")
      const patch: Partial<typeof loyaltyMembers.$inferInsert> = {}
      if (body.tierId && body.tierId !== before.tierId) patch.tierId = (await this.activeTier(tx, body.tierId)).id
      if (body.status && body.status !== before.status) patch.status = body.status
      if (body.note !== undefined) patch.note = body.note || null
      if (!Object.keys(patch).length) return
      await tx.update(loyaltyMembers).set({ ...patch, version: sql`${loyaltyMembers.version} + 1` }).where(eq(loyaltyMembers.userId, userId))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "loyalty.member_updated", entityType: "loyalty_member", entityId: userId, before: { tierId: before.tierId, status: before.status, note: before.note }, after: { ...patch, reason: body.reason }, ip: actor.ip, requestId: ctx.requestId })
    })
    return this.member(userId)
  }

  // ---- benefits ----
  private async benefitViews(rows: Benefit[]): Promise<LoyaltyBenefitView[]> {
    const names = await this.names(rows.flatMap((r) => [r.createdBy, r.approvedBy]))
    const now = new Date()
    const t = this.threshold()
    return rows.map((r) => ({
      id: r.id, kind: r.kind, value: r.value, currency: r.currency, appliesTo: r.appliesTo, tierId: r.tierId, userId: r.userId, description: r.description,
      validFrom: iso(r.validFrom), validTo: iso(r.validTo), status: effectiveBenefitStatus(r, now), createdBy: names.get(r.createdBy) ?? "",
      approvedBy: r.approvedBy ? (names.get(r.approvedBy) ?? "") : null, needsApproval: r.status === "PENDING_APPROVAL" && benefitNeedsApproval(r.kind, r.value, t),
    }))
  }

  /** Benefits the customer could use now: their own or their tier's, ACTIVE and inside the window. */
  async usableBenefitRows(tx: DbOrTx, userId: string, now = new Date()): Promise<{ member: Member | null; benefits: Benefit[] }> {
    const [member] = await tx.select().from(loyaltyMembers).where(eq(loyaltyMembers.userId, userId))
    if (!member || member.status !== "ACTIVE") return { member: member ?? null, benefits: [] }
    const rows = await tx.select().from(loyaltyBenefits).where(and(eq(loyaltyBenefits.status, "ACTIVE"), or(eq(loyaltyBenefits.userId, userId), eq(loyaltyBenefits.tierId, member.tierId))))
    return { member, benefits: rows.filter((b) => b.validFrom <= now && b.validTo > now) }
  }

  async benefits(q: { userId?: string; tierId?: string; status?: Benefit["status"]; usableBy?: string; limit: number }): Promise<LoyaltyBenefitView[]> {
    if (q.usableBy) return this.benefitViews((await this.usableBenefitRows(this.db, q.usableBy)).benefits)
    const now = new Date()
    const statusWhere = q.status === "EXPIRED"
      ? or(eq(loyaltyBenefits.status, "EXPIRED"), and(eq(loyaltyBenefits.status, "ACTIVE"), sql`${loyaltyBenefits.validTo} <= ${now}`))
      : q.status === "ACTIVE" ? and(eq(loyaltyBenefits.status, "ACTIVE"), sql`${loyaltyBenefits.validTo} > ${now}`)
        : q.status ? eq(loyaltyBenefits.status, q.status) : undefined
    const where = and(q.userId ? eq(loyaltyBenefits.userId, q.userId) : undefined, q.tierId ? eq(loyaltyBenefits.tierId, q.tierId) : undefined, statusWhere)
    return this.benefitViews(await this.db.select().from(loyaltyBenefits).where(where).orderBy(desc(loyaltyBenefits.createdAt)).limit(q.limit))
  }

  private async grantCredit(tx: Tx, b: Benefit, actor: Actor) {
    if (b.kind !== "BONUS_CREDIT" || !b.userId || !b.currency) return
    await tx.insert(loyaltyLedger).values({ userId: b.userId, kind: "GRANTED", amountMinor: b.value, currency: b.currency, reason: b.description.en, actorUserId: actor.userId, benefitId: b.id })
  }

  async createBenefit(body: LoyaltyBenefitBody, actor: Actor, ctx: Ctx): Promise<LoyaltyBenefitView> {
    if (body.kind === "BONUS_CREDIT" && !body.userId) throw new AppError("VALIDATION_FAILED", "Bonus credit is granted to one member, not a tier", [{ path: "userId", code: "REQUIRED" }])
    const id = await this.uow.run(async (tx) => {
      if (body.tierId) await this.activeTier(tx, body.tierId)
      if (body.userId) {
        const [m] = await tx.select().from(loyaltyMembers).where(eq(loyaltyMembers.userId, body.userId))
        if (!m || m.status !== "ACTIVE") throw new AppError("VALIDATION_FAILED", "The customer is not an active member", [{ path: "userId", code: "NOT_A_MEMBER" }])
      }
      const pending = benefitNeedsApproval(body.kind, body.value, this.threshold())
      const [b] = await tx.insert(loyaltyBenefits).values({
        kind: body.kind, value: body.value, currency: body.kind === "DISCOUNT_FIXED" || body.kind === "BONUS_CREDIT" ? body.currency! : null, appliesTo: body.appliesTo,
        tierId: body.tierId ?? null, userId: body.userId ?? null, description: body.description, validFrom: new Date(body.validFrom), validTo: new Date(body.validTo),
        status: pending ? "PENDING_APPROVAL" : "ACTIVE", createdBy: actor.userId,
      }).returning()
      if (!pending) await this.grantCredit(tx, b!, actor)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "loyalty.benefit_created", entityType: "loyalty_benefit", entityId: b!.id, after: { kind: b!.kind, value: b!.value, currency: b!.currency, appliesTo: b!.appliesTo, tierId: b!.tierId, userId: b!.userId, status: b!.status }, ip: actor.ip, requestId: ctx.requestId })
      return b!.id
    })
    return (await this.benefitViews(await this.db.select().from(loyaltyBenefits).where(eq(loyaltyBenefits.id, id))))[0]!
  }

  async approveBenefit(id: string, actor: Actor, ctx: Ctx): Promise<LoyaltyBenefitView> {
    await this.uow.run(async (tx) => {
      const [b] = await tx.select().from(loyaltyBenefits).where(eq(loyaltyBenefits.id, id)).for("update")
      if (!b) throw notFound("Benefit")
      if (b.status !== "PENDING_APPROVAL") throw new AppError("INVALID_TRANSITION", "Only a pending benefit can be approved")
      if (b.createdBy === actor.userId) throw new AppError("FOUR_EYES_REQUIRED", "A different person must approve this benefit")
      if (b.validTo <= new Date()) throw new AppError("INVALID_TRANSITION", "The benefit has already ended")
      const [after] = await tx.update(loyaltyBenefits).set({ status: "ACTIVE", approvedBy: actor.userId, approvedAt: new Date() }).where(eq(loyaltyBenefits.id, id)).returning()
      await this.grantCredit(tx, after!, actor)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "loyalty.benefit_approved", entityType: "loyalty_benefit", entityId: id, before: { status: b.status }, after: { status: "ACTIVE" }, ip: actor.ip, requestId: ctx.requestId })
    })
    return (await this.benefitViews(await this.db.select().from(loyaltyBenefits).where(eq(loyaltyBenefits.id, id))))[0]!
  }

  /** Revoking bonus credit reverses what is still unused; credit already used on an invoice stays used. */
  async revokeBenefit(id: string, reason: string, actor: Actor, ctx: Ctx): Promise<LoyaltyBenefitView> {
    await this.uow.run(async (tx) => {
      const [b] = await tx.select().from(loyaltyBenefits).where(eq(loyaltyBenefits.id, id)).for("update")
      if (!b) throw notFound("Benefit")
      if (b.status === "REVOKED" || b.status === "EXPIRED") throw new AppError("INVALID_TRANSITION", "The benefit is no longer active")
      await tx.update(loyaltyBenefits).set({ status: "REVOKED", revokedBy: actor.userId, revokedAt: new Date(), revokeReason: reason }).where(eq(loyaltyBenefits.id, id))
      if (b.kind === "BONUS_CREDIT" && b.status === "ACTIVE" && b.userId && b.currency) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`loyalty:${b.userId}`}))`)
        const remaining = (await this.balances([b.userId], tx)).get(b.userId)?.[b.currency] ?? 0
        const amount = Math.min(remaining, b.value)
        if (amount > 0) await tx.insert(loyaltyLedger).values({ userId: b.userId, kind: "REVERSED", amountMinor: amount, currency: b.currency, reason: `Benefit revoked: ${reason}`, actorUserId: actor.userId, benefitId: b.id })
      }
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "loyalty.benefit_revoked", entityType: "loyalty_benefit", entityId: id, before: { status: b.status }, after: { status: "REVOKED", reason }, ip: actor.ip, requestId: ctx.requestId })
    })
    return (await this.benefitViews(await this.db.select().from(loyaltyBenefits).where(eq(loyaltyBenefits.id, id))))[0]!
  }

  // ---- ledger ----
  async ledger(userId: string, limit: number): Promise<LoyaltyLedgerEntry[]> {
    const rows = await this.db.select({ l: loyaltyLedger, number: invoices.number }).from(loyaltyLedger).leftJoin(invoices, eq(invoices.id, loyaltyLedger.invoiceId))
      .where(eq(loyaltyLedger.userId, userId)).orderBy(desc(loyaltyLedger.createdAt)).limit(limit)
    const names = await this.names(rows.map((r) => r.l.actorUserId))
    return rows.map(({ l, number }) => ({ id: l.id, userId: l.userId, kind: l.kind, amount: { amountMinor: l.amountMinor, currency: l.currency }, reason: l.reason, actor: names.get(l.actorUserId) ?? "", invoiceNumber: number ?? null, createdAt: iso(l.createdAt) }))
  }

  /**
   * Manual ledger entries. USED names an issued or paid invoice of the same customer and currency; a debit never takes the
   * balance below zero. A manual GRANTED is limited to the four-eyes threshold: larger grants go through a BONUS_CREDIT
   * benefit, which needs a second approver.
   */
  async addLedgerEntry(body: { userId: string; kind: "GRANTED" | "USED" | "REVERSED"; amount: Money; reason: string; invoiceId?: string }, actor: Actor, ctx: Ctx): Promise<LoyaltyLedgerEntry[]> {
    await this.uow.run(async (tx) => {
      const [m] = await tx.select().from(loyaltyMembers).where(eq(loyaltyMembers.userId, body.userId))
      if (!m) throw notFound("Member")
      if (body.amount.amountMinor <= 0) throw new AppError("VALIDATION_FAILED", "Amount must be greater than zero", [{ path: "amount", code: "INVALID" }])
      if (body.kind === "GRANTED") {
        if (m.status !== "ACTIVE") throw new AppError("VALIDATION_FAILED", "The customer is not an active member", [{ path: "userId", code: "NOT_A_MEMBER" }])
        if (body.amount.amountMinor > this.threshold()) throw new AppError("FOUR_EYES_REQUIRED", "Grant larger amounts as a bonus-credit benefit so a second person approves it")
      }
      if (body.kind === "USED") {
        if (!body.invoiceId) throw new AppError("VALIDATION_FAILED", "Name the invoice the credit is used on", [{ path: "invoiceId", code: "REQUIRED" }])
        const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, body.invoiceId), eq(invoices.customerUserId, body.userId), isNotNull(invoices.number)))
        if (!inv || !["ISSUED", "PAID"].includes(inv.status)) throw new AppError("VALIDATION_FAILED", "Choose an issued invoice of this customer", [{ path: "invoiceId", code: "INVALID" }])
        if (inv.currency !== body.amount.currency) throw new AppError("VALIDATION_FAILED", "The credit is in another currency than the invoice", [{ path: "amount", code: "CURRENCY" }])
      }
      if (body.kind !== "GRANTED") {
        // Serialise debits per customer so two staff cannot spend the same credit at once.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`loyalty:${body.userId}`}))`)
        const bal = (await this.balances([body.userId], tx)).get(body.userId) ?? {}
        if (!canDebit(bal, body.amount.currency, body.amount.amountMinor)) throw new AppError("VALIDATION_FAILED", "Not enough club credit", [{ path: "amount", code: "INSUFFICIENT_CREDIT" }])
      }
      const [row] = await tx.insert(loyaltyLedger).values({ userId: body.userId, kind: body.kind, amountMinor: body.amount.amountMinor, currency: body.amount.currency, reason: body.reason, actorUserId: actor.userId, invoiceId: body.invoiceId ?? null }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "loyalty.ledger_entry", entityType: "loyalty_ledger", entityId: row!.id, after: { userId: body.userId, kind: body.kind, amount: body.amount, invoiceId: body.invoiceId ?? null }, ip: actor.ip, requestId: ctx.requestId })
    })
    return this.ledger(body.userId, 100)
  }

  // ---- customer ----
  async customerView(userId: string): Promise<CustomerClubView> {
    if (!this.config.flag("loyalty.enabled")) return { enabled: false, member: null, benefits: [], creditBalance: [] }
    const { member, benefits } = await this.usableBenefitRows(this.db, userId)
    if (!member || member.status === "REMOVED") return { enabled: true, member: null, benefits: [], creditBalance: [] }
    const [tier] = await this.db.select().from(loyaltyTiers).where(eq(loyaltyTiers.id, member.tierId))
    const bal = (await this.balances([userId])).get(userId) ?? {}
    return {
      enabled: true,
      member: { tier: { code: tier!.code, nameEn: tier!.nameEn, nameFa: tier!.nameFa }, status: member.status, joinedAt: iso(member.joinedAt) },
      benefits: benefits.map((b) => ({ id: b.id, kind: b.kind, value: b.value, currency: b.currency, appliesTo: b.appliesTo, description: b.description, validFrom: iso(b.validFrom), validTo: iso(b.validTo) })),
      creditBalance: member.status === "ACTIVE" ? toMoney(bal) : [],
    }
  }
}
