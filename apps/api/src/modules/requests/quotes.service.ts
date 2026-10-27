import { Inject, Injectable } from "@nestjs/common"
import { and, asc, desc, eq, isNotNull, max } from "drizzle-orm"

import type { QuoteOptionInput } from "@unitravel/contracts"
import { type Db, offerSnapshots, quoteOptions, quotes } from "@unitravel/db"
import { formatMoney, priceBreakdownIssue } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"
import { AuditService } from "../audit/audit.service"
import { ComplianceService } from "../compliance/compliance.service"
import { ConfigService } from "../config/config.service"
import { optionUnknowns, RequestsService } from "./requests.service"

const EDITABLE = ["IN_REVIEW", "QUOTED", "ACCEPTED"]

/**
 * Quote builder (ch. 15.5): options from the snapshot, a staff search or manual entry; every UNKNOWN attribute listed
 * and blocking until filled from the fare rules; validity defaults from config and never exceeds the supplier's expiry.
 */
@Injectable()
export class QuotesService {
  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly requests: RequestsService, private readonly config: ConfigService, private readonly compliance: ComplianceService, private readonly audit: AuditService) {}

  private async validateOptions(options: QuoteOptionInput[], currency: string) {
    const wf = this.config.get("WORKFLOW")
    if (options.length > wf.quoteMaxOptions) throw new AppError("VALIDATION_FAILED", `At most ${wf.quoteMaxOptions} options`)
    const policy = await this.compliance.carrierPolicy()
    options.forEach((o, i) => {
      // The domain computes the total (fare + taxes + fee + extras - discount); a client total that differs is refused (ADR-0013 A5).
      const issue = priceBreakdownIssue(o.priceBreakdown, currency)
      if (issue) throw new AppError("VALIDATION_FAILED", issue.message, [{ path: `options[${i}].priceBreakdown.${issue.path}`, code: issue.code }])
      // Carrier policy also validates every quote option (ch. 27.1), including manually typed segments.
      const carriers = o.slices.flatMap((s) => s.segments.flatMap((g) => [g.marketing.carrier, g.operating.carrier]))
      const blocked = carriers.filter((c) => policy.blockedCarriers.has(c))
      if (blocked.length) throw new AppError("VALIDATION_FAILED", `Option ${i + 1} uses a blocked carrier (${[...new Set(blocked)].join(", ")})`, [{ path: `options[${i}].slices`, code: "CARRIER_BLOCKED" }])
    })
  }

  private validity(options: QuoteOptionInput[], requested?: string): Date {
    const wf = this.config.get("WORKFLOW")
    let v = requested ? new Date(requested) : new Date(Date.now() + wf.quoteDefaultValidityHours * 3600_000)
    for (const o of options) if (o.supplierExpiresAt && new Date(o.supplierExpiresAt) < v) v = new Date(o.supplierExpiresAt)
    return v
  }

  async createDraft(ref: string, body: { currency: string; validUntil?: string; options: QuoteOptionInput[] }, actor: Actor) {
    await this.validateOptions(body.options, body.currency)
    const id = await this.uow.run(async (tx) => {
      const r = await this.requests.byRef(ref, tx, true)
      if (!EDITABLE.includes(r.status)) throw new AppError("INVALID_TRANSITION", `Quotes cannot be drafted while ${r.status}`)
      const [{ v } = { v: 0 }] = await tx.select({ v: max(quotes.version) }).from(quotes).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id)))
      const [q] = await tx.insert(quotes).values({ requestType: "FLIGHT", requestId: r.id, version: (v ?? 0) + 1, status: "DRAFT", currency: body.currency, validUntil: this.validity(body.options, body.validUntil), createdBy: actor.userId }).returning()
      await this.insertOptions(tx, q!.id, body.options, actor.userId)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "quote.drafted", entityType: "quote", entityId: q!.id, contextRef: r.ref, after: { version: q!.version, options: body.options.length } })
      return q!.id
    })
    return this.view(id, actor)
  }

  async updateDraft(ref: string, quoteId: string, body: { currency: string; validUntil?: string; options: QuoteOptionInput[] }, actor: Actor, expectedRowVersion?: number) {
    await this.validateOptions(body.options, body.currency)
    await this.uow.run(async (tx) => {
      const r = await this.requests.byRef(ref, tx)
      const [q] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.requestId, r.id))).for("update")
      if (!q) throw notFound("Quote")
      if (q.status !== "DRAFT") throw new AppError("INVALID_TRANSITION", "Only drafts can be edited; create a new version")
      // Replacing options rewrites their cost fields; an editor who cannot see them must not silently erase them.
      if (!actor.permissions.has("pricing.read.internal") && (await tx.select({ id: quoteOptions.id }).from(quoteOptions).where(and(eq(quoteOptions.quoteId, q.id), isNotNull(quoteOptions.internalCostMinor)))).length) {
        throw new AppError("FORBIDDEN", "This draft holds internal cost data; editing it needs pricing.read.internal")
      }
      if (expectedRowVersion !== undefined && expectedRowVersion !== q.rowVersion) throw new AppError("VERSION_CONFLICT", "Quote changed; reload")
      await tx.delete(quoteOptions).where(eq(quoteOptions.quoteId, q.id))
      await this.insertOptions(tx, q.id, body.options, actor.userId)
      await tx.update(quotes).set({ currency: body.currency, validUntil: this.validity(body.options, body.validUntil), rowVersion: q.rowVersion + 1 }).where(eq(quotes.id, q.id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "quote.updated", entityType: "quote", entityId: q.id, contextRef: r.ref })
    })
    return this.view(quoteId, actor)
  }

  private async insertOptions(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], quoteId: string, options: QuoteOptionInput[], actorId: string) {
    if (!options.length) return
    await tx.insert(quoteOptions).values(options.map((o, i) => ({
      quoteId, position: i, label: o.label, source: o.source,
      // Manually typed segments carry the admin's identity as the attesting source (ch. 13.6).
      attestedBy: o.source === "MANUAL" ? actorId : null,
      itinerary: { slices: o.slices }, components: o.source === "MANUAL" ? [{ provider: "manual", rung: "MANUAL" }] : o.components, priceBreakdown: o.priceBreakdown,
      totalMinor: o.priceBreakdown.total.amountMinor, baggage: o.baggage, conditions: o.conditions, ticketingModel: o.ticketingModel,
      internalCostMinor: o.internalCostMinor ?? null, supplierPrice: o.supplierPrice ?? null, supplierFetchedAt: o.supplierFetchedAt ? new Date(o.supplierFetchedAt) : null, supplierExpiresAt: o.supplierExpiresAt ? new Date(o.supplierExpiresAt) : null,
    })))
  }

  /** Cost and supplier fields only for `pricing.read.internal` (ADR-0004); the customer-facing price breakdown is always shown. */
  async view(quoteId: string, actor: Actor) {
    const internal = actor.permissions.has("pricing.read.internal")
    const [q] = await this.db.select().from(quotes).where(eq(quotes.id, quoteId))
    if (!q) throw notFound("Quote")
    const opts = await this.db.select().from(quoteOptions).where(eq(quoteOptions.quoteId, q.id)).orderBy(asc(quoteOptions.position))
    return {
      id: q.id, version: q.version, status: q.status, currency: q.currency, validUntil: q.validUntil?.toISOString() ?? null, rowVersion: q.rowVersion,
      options: opts.map((o) => ({ id: o.id, label: o.label, source: o.source, slices: (o.itinerary as { slices: unknown[] }).slices, priceBreakdown: o.priceBreakdown, baggage: o.baggage, conditions: o.conditions, ticketingModel: o.ticketingModel, unknownFields: optionUnknowns(o), ...(internal ? { internalCostMinor: o.internalCostMinor, supplierPrice: o.supplierPrice, supplierFetchedAt: o.supplierFetchedAt?.toISOString() ?? null } : {}) })),
      sendBlockedBy: opts.length === 0 ? ["Add at least one option"] : opts.flatMap((o, i) => optionUnknowns(o).map((f) => `Option ${i + 1} needs confirmed ${f}`)),
    }
  }

  /** "Add from snapshot": the supplier's facts carried over; anything it did not return stays UNKNOWN for staff to fill. */
  async fromSnapshot(ref: string): Promise<QuoteOptionInput> {
    const r = await this.requests.byRef(ref)
    if (!r.offerSnapshotId) throw new AppError("VALIDATION_FAILED", "This request has no offer snapshot")
    const [s] = await this.db.select().from(offerSnapshots).where(eq(offerSnapshots.id, r.offerSnapshotId))
    const it = s!.itinerary
    const total = s!.priceRevalidatedMinor ?? s!.priceAtSubmitMinor
    const first = it.components[0]!
    const allKnown = (k: "change" | "refund") => it.components.every((c) => c.conditions[k].status === "KNOWN")
    return {
      label: `${it.construction === "SELF_TRANSFER" ? "Self-transfer" : it.construction === "GATEWAY" ? "From gateway" : "Through"} · from snapshot`,
      source: "SNAPSHOT",
      slices: it.components.length === 1 ? first.slices : [{ origin: it.components[0]!.slices[0]!.origin, destination: it.components.at(-1)!.slices.at(-1)!.destination, segments: it.components.flatMap((c) => c.slices.flatMap((x) => x.segments)), durationMin: it.durationMin }],
      components: it.components.map((c) => ({ provider: c.source.provider, offerId: c.source.providerOfferId, rung: c.source.rung, fetchedAt: c.source.fetchedAt })),
      priceBreakdown: { fare: { amountMinor: total, currency: s!.currency }, taxes: { amountMinor: 0, currency: s!.currency }, serviceFee: { amountMinor: 0, currency: s!.currency }, total: { amountMinor: total, currency: s!.currency } },
      baggage: it.baggage,
      conditions: { change: allKnown("change") && it.components.length === 1 ? first.conditions.change : { status: "UNKNOWN" }, refund: allKnown("refund") && it.components.length === 1 ? first.conditions.refund : { status: "UNKNOWN" } },
      ticketingModel: it.ticketing,
      supplierPrice: it.price.total,
      supplierFetchedAt: first.source.fetchedAt,
      supplierExpiresAt: it.components.map((c) => c.source.expiresAt).filter(Boolean).sort()[0],
    }
  }

  async latestSent(requestId: string) {
    const [q] = await this.db.select().from(quotes).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, requestId), eq(quotes.status, "SENT"))).orderBy(desc(quotes.version)).limit(1)
    return q
  }

  describe(o: { label: string; priceBreakdown: { total: { amountMinor: number; currency: string } } }) {
    return `${o.label}: ${formatMoney(o.priceBreakdown.total)}`
  }
}
