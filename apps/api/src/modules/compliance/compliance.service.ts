import { createHash } from "node:crypto"

import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm"

import { type CaseView, type Permission, type GoodsCategory, type OnlinePaymentPolicy, OnlinePaymentPolicyKey, type PolicyView, type ScreeningResult } from "@unitravel/contracts"
import {
  complianceCases, complianceDecisions, auditLog, compliancePolicies, type Db, type DbOrTx, sanctionEntries, sanctionLists, screeningHits, screenings, settings, type Tx, users,
} from "@unitravel/db"
import { decide, evaluate, POLICY_PROPOSAL_TRANSITIONS, normaliseLatin, scoreCandidate, searchTokens, tokens, phoneticKey } from "@unitravel/domain"
import type { CarrierPolicy } from "@unitravel/engine"

import { env, isLocal } from "../../core/env"
import { AppError } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { WorkerRegistry } from "../../core/workers"
import { AuditService } from "../audit/audit.service"
import type { DispatchedEvent } from "../platform/outbox.dispatcher"
import { OutboxService } from "../platform/outbox.service"
import { ReferenceService } from "../reference/reference.service"
import { neutralDeclineFor } from "./customer-messages"
import { type ParsedEntry, parseEu, parseOfac, parseUkList, TEST_LIST } from "./list-parsers"

type ListId = "UK" | "OFAC_SDN" | "OFAC_NON_SDN" | "EU" | "TEST"

export interface ComplianceSettings {
  matchThreshold: number
  reviewThreshold: number
  listsSyncHours: number
  sources: { UK: string; OFAC_SDN: string; OFAC_ALT: string; EU: string }
}
export const DEFAULT_COMPLIANCE: ComplianceSettings = {
  matchThreshold: 0.93, reviewThreshold: 0.85, listsSyncHours: 6,
  sources: {
    UK: "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv",
    OFAC_SDN: "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV",
    OFAC_ALT: "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV",
    EU: "https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw",
  },
}

/** Most entries read per screening; the rarest token is exempt. Scoring is in-process, so this bounds latency, not recall. */
const CANDIDATE_BUDGET = 20_000

export interface Subject {
  subjectType: "CUSTOMER" | "TRAVELLER" | "PAYER" | "SHIPPER" | "CONSIGNEE" | "PARTNER"
  subjectRef: string
  name: string
  nameFa?: string | null
  dateOfBirth?: string | null
  nationality?: string | null
  contextRef?: string | null
  entity?: boolean
}

export interface CaseOutcome { decision: "RELEASE" | "DECLINE"; reason: string; reasonCode?: string; customerMessage?: string; actorUserId: string; caseId: string }
type OutcomeHandler = (tx: Tx, requestId: string, outcome: CaseOutcome) => Promise<void>
type ScreenHandler = (requestId: string) => Promise<void>

/**
 * The compliance module (ch. 27): party screening against UK, OFAC and EU lists with a Persian-aware matcher;
 * carrier, airport, route, goods, keyword and lane policies as versioned data; cases with immutable decisions
 * and four-eyes overrides. It makes counsel's advice enforceable; it does not replace it.
 */
@Injectable()
export class ComplianceService implements OnModuleInit {
  private readonly log = new Logger("Compliance")
  private readonly outcomeHandlers = new Map<string, OutcomeHandler>()
  private readonly screenHandlers = new Map<string, ScreenHandler>()
  private policyCache?: { at: number; rows: (typeof compliancePolicies.$inferSelect)[] }

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly reference: ReferenceService,
    private readonly workers: WorkerRegistry,
    private readonly queues: Queues,
  ) {}

  async onModuleInit() {
    this.workers.register("compliance.screen", (job) => this.onEvent(job.data as DispatchedEvent), 5)
    this.workers.register("compliance.lists-sync", () => this.syncAll(), 1)
    // Every 6 hours plus on demand (ch. 26.2); repeatable jobs are idempotent by key.
    await this.queues.get("compliance.lists-sync").upsertJobScheduler("lists-every-6h", { every: DEFAULT_COMPLIANCE.listsSyncHours * 3600_000 }, { name: "sync" }).catch(() => undefined)
  }

  onOutcome(requestType: "FLIGHT" | "CARGO", h: OutcomeHandler) {
    this.outcomeHandlers.set(requestType, h)
  }

  onScreenRequest(event: string, h: ScreenHandler) {
    this.screenHandlers.set(event, h)
  }

  async config(): Promise<ComplianceSettings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, "compliance"))
    return { ...DEFAULT_COMPLIANCE, ...((row?.value as Partial<ComplianceSettings>) ?? {}) }
  }

  private async onEvent(e: DispatchedEvent) {
    const handler = this.screenHandlers.get(e.type)
    if (handler) return handler(String((e.payload as { requestId?: string }).requestId ?? e.aggregateId))
    if (e.type === "identity.verified" || e.type === "user.registered") return this.screenCustomer(String((e.payload as { userId: string }).userId))
  }

  async screenCustomer(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId))
    if (!u || u.displayName === "Customer") return
    await this.screen(this.db, { subjectType: "CUSTOMER", subjectRef: userId, name: u.displayName })
  }

  // ---------------- lists ----------------

  async syncAll() {
    const out: Record<string, unknown> = {}
    for (const id of ["UK", "OFAC_SDN", "EU", ...(isLocal() ? ["TEST"] : [])] as ListId[]) {
      try {
        out[id] = await this.syncList(id)
      } catch (err) {
        // A failed download alerts developers; screening continues on the last good version (ch. 27.2).
        this.log.error({ list: id, err: String(err) }, "list sync failed")
        await this.db.insert(sanctionLists).values({ listId: id === "TEST" ? "UK" : id, sourceUrl: "sync", versionHash: "failed", entryCount: 0, status: "FAILED", error: String(err).slice(0, 500) })
        await this.outbox.add(this.db, { aggregateType: "provider", aggregateId: `sanctions-${id}`, eventType: "provider.health_changed", payload: { provider: `sanctions list ${id}`, circuit: "FAILED", detail: String(err).slice(0, 200) } })
        out[id] = { error: String(err) }
      }
    }
    return out
  }

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000), headers: { "user-agent": "UniTravel-Compliance/1.0" } })
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
    return res.text()
  }

  async syncList(id: ListId): Promise<{ entries: number; changed: boolean; version: string }> {
    const cfg = await this.config()
    let entries: ParsedEntry[]
    let source: string
    if (id === "TEST") { entries = TEST_LIST; source = "fixture://unitravel-fictional-test-list" }
    else if (id === "UK") { source = cfg.sources.UK; entries = parseUkList(await this.fetchText(source)) }
    else if (id === "OFAC_SDN") { source = cfg.sources.OFAC_SDN; entries = parseOfac(await this.fetchText(source), await this.fetchText(cfg.sources.OFAC_ALT)) }
    else { source = cfg.sources.EU; entries = parseEu(await this.fetchText(source)) }
    if (entries.length === 0) throw new Error("Parsed zero entries — schema drift?")
    const listId = id === "TEST" ? "OFAC_NON_SDN" : id
    const hash = createHash("sha256").update(JSON.stringify(entries)).digest("hex")
    const [active] = await this.db.select().from(sanctionLists).where(and(eq(sanctionLists.listId, listId), eq(sanctionLists.status, "ACTIVE"), eq(sanctionLists.sourceUrl, source)))
    if (active?.versionHash === hash) return { entries: entries.length, changed: false, version: hash.slice(0, 12) }
    const prevTokens = active ? new Set((await this.db.select({ t: sanctionEntries.searchTokens }).from(sanctionEntries).where(eq(sanctionEntries.listVersionId, active.id))).flatMap((r) => r.t)) : new Set<string>()
    const changedTokens = new Set<string>()
    await this.db.transaction(async (tx) => {
      const [v] = await tx.insert(sanctionLists).values({ listId, sourceUrl: source, versionHash: hash, entryCount: entries.length, status: "ACTIVE" }).returning()
      for (let i = 0; i < entries.length; i += 500) {
        await tx.insert(sanctionEntries).values(entries.slice(i, i + 500).map((e) => {
          const st = searchTokens([e.primary, ...e.aliases])
          for (const t of st) if (!prevTokens.has(t)) changedTokens.add(t)
          return { listVersionId: v!.id, listId, externalId: e.externalId, type: e.type, names: { primary: e.primary, aliases: e.aliases, nonLatin: e.nonLatin }, dob: e.dob, nationalities: e.nationalities, identifiers: e.identifiers, programmes: e.programmes, searchTokens: st, searchText: normaliseLatin([e.primary, ...e.aliases].join(" ")).slice(0, 2000) }
        }))
      }
      // List versions are retained for replay (ch. 27.7); the old version stops being used for new screenings.
      if (active) await tx.update(sanctionLists).set({ status: "SUPERSEDED" }).where(and(eq(sanctionLists.listId, listId), ne(sanctionLists.id, v!.id), eq(sanctionLists.status, "ACTIVE")))
    })
    // Re-screen every recent subject whose name tokens intersect the changed entries.
    if (active && changedTokens.size) await this.rescreen([...changedTokens])
    this.log.log({ list: id, entries: entries.length }, "sanctions list ingested")
    return { entries: entries.length, changed: true, version: hash.slice(0, 12) }
  }

  private async rescreen(changed: string[]) {
    const recent = await this.db.select().from(screenings).where(sql`created_at > now() - interval '365 days'`).orderBy(desc(screenings.createdAt)).limit(5000)
    const seen = new Set<string>()
    for (const s of recent) {
      const key = `${s.subjectType}:${s.subjectRef}`
      if (seen.has(key)) continue
      seen.add(key)
      const ts = searchTokens([s.subjectName])
      if (ts.some((t) => changed.includes(t))) await this.screen(this.db, { subjectType: s.subjectType as Subject["subjectType"], subjectRef: s.subjectRef, name: s.subjectName, contextRef: s.contextRef })
    }
  }

  async listsStatus() {
    return this.db.select({ id: sanctionLists.id, listId: sanctionLists.listId, sourceUrl: sanctionLists.sourceUrl, version: sanctionLists.versionHash, fetchedAt: sanctionLists.fetchedAt, entryCount: sanctionLists.entryCount, status: sanctionLists.status, error: sanctionLists.error })
      .from(sanctionLists).orderBy(desc(sanctionLists.fetchedAt)).limit(40)
  }

  // ---------------- screening ----------------

  /** Screens one party; stores the list versions used, every candidate considered and their scores (ch. 27.3). */
  async screen(tx: DbOrTx, s: Subject): Promise<{ screeningId: string; result: ScreeningResult; hits: { entryId: string; score: number; matchedName: string; reasons: string[]; listId: string; externalId: string; programmes: string[] }[] }> {
    const cfg = await this.config()
    const qTokens = searchTokens([s.name])
    const active = await tx.select().from(sanctionLists).where(eq(sanctionLists.status, "ACTIVE"))
    const versions = Object.fromEntries(active.map((l) => [`${l.listId}${l.sourceUrl.startsWith("fixture") ? ":TEST" : ""}`, l.versionHash.slice(0, 12)]))
    const candidates = qTokens.length && active.length ? await this.candidates(tx, qTokens, active.map((a) => a.id)) : []
    // Parties are screened as person and as entity alike: a company name typed into a name field, or a person's name in a company
    // field, must still reach the list (ch. 27.3). Travellers are always people.
    const types = s.subjectType === "TRAVELLER" ? ["PERSON"] : ["PERSON", "ENTITY"]
    const hits = candidates.filter((c) => types.includes(c.type)).map((c) => {
      const r = scoreCandidate({ name: s.name, nameFa: s.nameFa, dateOfBirth: s.dateOfBirth, nationality: s.nationality }, { primary: c.names.primary, aliases: c.names.aliases, nonLatin: c.names.nonLatin, dob: c.dob, nationalities: c.nationalities })
      return { entryId: c.id, score: r.score, matchedName: r.matchedName, reasons: r.reasons, listId: c.listId, externalId: c.externalId, programmes: c.programmes }
    }).filter((h) => h.score >= cfg.reviewThreshold - 0.1).sort((a, b) => b.score - a.score).slice(0, 10)
    const result = decide(hits[0]?.score ?? 0, { match: cfg.matchThreshold, review: cfg.reviewThreshold })
    const [row] = await tx.insert(screenings).values({ subjectType: s.subjectType, subjectRef: s.subjectRef, subjectName: s.name.slice(0, 240), contextRef: s.contextRef ?? null, listsVersion: versions, result, candidatesConsidered: candidates.length, thresholds: { match: cfg.matchThreshold, review: cfg.reviewThreshold } }).returning()
    if (hits.length) await tx.insert(screeningHits).values(hits.map((h) => ({ screeningId: row!.id, entryId: h.entryId, score: Math.round(h.score * 10000) / 10000, matchedName: h.matchedName.slice(0, 240), reasons: h.reasons })))
    return { screeningId: row!.id, result, hits: result === "CLEAR" ? [] : hits.filter((h) => h.score >= cfg.reviewThreshold) }
  }

  /**
   * Entries sharing at least one name token with the subject. Tokens are taken rarest first and every entry for a token is read,
   * until a budget is reached, so a common token ("ltd", "mohammad") can never crowd out the entry that shares the rare one.
   * The previous unordered LIMIT 500 before scoring dropped true matches.
   */
  private async candidates(tx: DbOrTx, qTokens: string[], versionIds: string[]) {
    const where = (ts: string[]) => and(inArray(sanctionEntries.listVersionId, versionIds), sql`${sanctionEntries.searchTokens} && ${sql.raw(`ARRAY[${ts.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")}]::text[]`)}`)
    const counts = await Promise.all(qTokens.map(async (t) => {
      const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(sanctionEntries).where(where([t]))
      return { t, n: row?.n ?? 0 }
    }))
    const picked: string[] = []
    let total = 0
    for (const { t, n } of counts.filter((c) => c.n > 0).sort((a, b) => a.n - b.n)) {
      // The rarest token is always read in full; later (more common) tokens only while the budget allows.
      if (picked.length && total + n > CANDIDATE_BUDGET) break
      picked.push(t)
      total += n
    }
    if (!picked.length) return []
    if (picked.length < counts.filter((c) => c.n > 0).length) this.log.warn({ skipped: counts.filter((c) => !picked.includes(c.t) && c.n > 0).map((c) => c.t) }, "common name tokens skipped in candidate lookup")
    return tx.select().from(sanctionEntries).where(where(picked))
  }

  screenAdHoc(s: Subject) {
    return this.screen(this.db, s)
  }

  // ---------------- policies ----------------

  private async activePolicies() {
    if (this.policyCache && Date.now() - this.policyCache.at < 15_000) return this.policyCache.rows
    const rows = await this.db.select().from(compliancePolicies).where(eq(compliancePolicies.status, "ACTIVE"))
    this.policyCache = { at: Date.now(), rows }
    return rows
  }

  /** The carrier and airport policy the engine applies to supplier output (ch. 21.1, 27.4). "country:XX" expands to every carrier registered there. */
  async carrierPolicy(): Promise<CarrierPolicy> {
    const rows = await this.activePolicies()
    const expand = (key: string) => (key.startsWith("country:") ? this.reference.airlinesInCountry(key.slice(8)) : [key])
    const set = (type: string, action: string) => new Set(rows.filter((r) => r.type === type && r.action === action).flatMap((r) => (type === "CARRIER" ? expand(r.key) : [r.key])))
    return { blockedCarriers: set("CARRIER", "BLOCK"), reviewCarriers: set("CARRIER", "REVIEW"), blockedAirports: set("AIRPORT", "BLOCK"), reviewAirports: set("AIRPORT", "REVIEW") }
  }

  /** Eligibility for online card payment is policy data (ADR-0007 P11): ALLOW and BLOCK rows of type ONLINE_PAYMENT. */
  async onlinePaymentPolicies(): Promise<OnlinePaymentPolicy[]> {
    const rows = await this.activePolicies()
    return rows.filter((r) => r.type === "ONLINE_PAYMENT" && r.action !== "REVIEW" && OnlinePaymentPolicyKey.safeParse(r.key).success).map((r) => ({ key: r.key, action: r.action as "ALLOW" | "BLOCK" }))
  }

  async routeReview(countries: string[]): Promise<string[]> {
    const rows = await this.activePolicies()
    return rows.filter((r) => r.type === "COUNTRY_ROUTE" && r.action !== "ALLOW" && countries.includes(r.key)).map((r) => r.key)
  }

  /** Goods screening (ch. 14.4): controlled category, EN/FA description keywords, HS-code chapters for freight. */
  async screenGoods(items: { description: string; category: GoodsCategory; hsCode?: string | null; unitValueMinor: number; quantity: number }[], highValueThresholdMinor: number) {
    const rows = await this.activePolicies()
    const cat = new Map(rows.filter((r) => r.type === "GOODS_CATEGORY").map((r) => [r.key, r]))
    const keywords = rows.filter((r) => r.type === "KEYWORD")
    const rank = { ALLOWED: 0, REVIEW: 1, PROHIBITED: 2 } as const
    const out = items.map((it) => {
      let outcome: "ALLOWED" | "REVIEW" | "PROHIBITED" = "ALLOWED"
      let rule: string | null = null
      const bump = (o: "REVIEW" | "PROHIBITED", r: string) => { if (rank[o] > rank[outcome]) { outcome = o; rule = r } }
      const p = cat.get(it.category)
      if (p?.action === "BLOCK") bump("PROHIBITED", `category ${it.category}`)
      else if (p?.action === "REVIEW") bump("REVIEW", `category ${it.category}`)
      const d = ` ${it.description.toLowerCase()} `
      for (const k of keywords) if (d.includes(k.key.toLowerCase())) bump(k.action === "BLOCK" ? "PROHIBITED" : "REVIEW", `keyword "${k.key}"`)
      // HS chapters 93 (arms), 36 (explosives), 88 (aircraft parts), 85/84 (electronics, machinery) need review.
      const ch = it.hsCode?.slice(0, 2)
      if (ch === "93" || ch === "36") bump("PROHIBITED", `HS chapter ${ch}`)
      else if (ch && ["84", "85", "88", "90", "30"].includes(ch)) bump("REVIEW", `HS chapter ${ch}`)
      if (it.unitValueMinor * it.quantity > highValueThresholdMinor) bump("REVIEW", "high value")
      return { outcome: outcome as "ALLOWED" | "REVIEW" | "PROHIBITED", matchedRule: rule as string | null }
    })
    return out
  }

  async lanePolicy(origin: string, destination: string) {
    const rows = await this.activePolicies()
    return rows.filter((r) => r.type === "LANE" && (r.key === `${origin}:*` || r.key === `*:${destination}` || r.key === `${origin}:${destination}` || r.key === `${destination}:*`))
  }

  async listPolicies(): Promise<PolicyView[]> {
    const rows = await this.db.select().from(compliancePolicies).orderBy(compliancePolicies.type, compliancePolicies.key)
    const closed = rows.filter((r) => r.status === "REJECTED" || r.status === "WITHDRAWN").map((r) => r.id)
    const why = new Map<string, string>()
    if (closed.length) for (const a of await this.db.select({ id: auditLog.entityId, after: auditLog.after }).from(auditLog).where(and(eq(auditLog.entityType, "compliance_policy"), inArray(auditLog.entityId, closed), inArray(auditLog.action, ["compliance.policy_rejected", "compliance.policy_withdrawn"]))).orderBy(auditLog.id)) {
      const reason = (a.after as { reason?: string | null } | null)?.reason
      if (a.id && reason) why.set(a.id, reason)
    }
    return rows.map((r) => ({ decisionReason: why.get(r.id), id: r.id, type: r.type, key: r.key, action: r.action, reason: r.reason, counselReference: r.counselReference ?? undefined, effectiveFrom: r.effectiveFrom.toISOString(), version: r.version, approvedBy: r.approvedBy, approvedAt: r.approvedAt?.toISOString() ?? null, status: r.status, createdBy: r.createdBy }))
  }

  /** Compliance officers edit; an owner approves before a policy takes effect (ch. 27.4). */
  async proposePolicy(body: { type: PolicyView["type"]; key: string; action: PolicyView["action"]; reason: string; counselReference?: string }, actorId: string) {
    if (body.type === "ONLINE_PAYMENT" && (body.action === "REVIEW" || !OnlinePaymentPolicyKey.safeParse(body.key).success)) throw new AppError("VALIDATION_FAILED", "An online payment policy is ALLOW or BLOCK on product:, currency:, max_minor: or customer: keys")
    return this.uow.run(async (tx) => {
      const prev = await tx.select().from(compliancePolicies).where(and(eq(compliancePolicies.type, body.type), eq(compliancePolicies.key, body.key))).orderBy(desc(compliancePolicies.version)).limit(1)
      const [row] = await tx.insert(compliancePolicies).values({ ...body, version: (prev[0]?.version ?? 0) + 1, status: "PENDING_APPROVAL", createdBy: actorId }).returning()
      await this.audit.record(tx, { actorUserId: actorId, actorKind: "STAFF", action: "compliance.policy_proposed", entityType: "compliance_policy", entityId: row!.id, after: body })
      return row
    })
  }

  async approvePolicy(id: string, actorId: string) {
    return this.uow.run(async (tx) => {
      const [p] = await tx.select().from(compliancePolicies).where(eq(compliancePolicies.id, id))
      if (!p || p.status !== "PENDING_APPROVAL") throw new AppError("INVALID_TRANSITION", "Only pending policies can be approved")
      if (p.createdBy === actorId) throw new AppError("FOUR_EYES_REQUIRED", "A policy must be approved by someone other than its author")
      await tx.update(compliancePolicies).set({ status: "RETIRED" }).where(and(eq(compliancePolicies.type, p.type), eq(compliancePolicies.key, p.key), eq(compliancePolicies.status, "ACTIVE")))
      await tx.update(compliancePolicies).set({ status: "ACTIVE", approvedBy: actorId, approvedAt: new Date(), effectiveFrom: new Date() }).where(eq(compliancePolicies.id, id))
      await this.audit.record(tx, { actorUserId: actorId, actorKind: "STAFF", action: "compliance.policy_approved", entityType: "compliance_policy", entityId: id, after: { type: p.type, key: p.key, action: p.action } })
      this.policyCache = undefined
      return { ok: true }
    })
  }

  /** Reject (owner, with reason) or withdraw (proposer): ends a proposal without touching the active policy (ADR-0008 W5). */
  async closeProposal(id: string, command: "reject" | "withdraw", actor: { userId: string; permissions: ReadonlySet<Permission>; isOwner: boolean }, reason?: string) {
    return this.uow.run(async (tx) => {
      const [p] = await tx.select().from(compliancePolicies).where(eq(compliancePolicies.id, id)).for("update")
      if (!p) throw new AppError("NOT_FOUND")
      const ev = evaluate(POLICY_PROPOSAL_TRANSITIONS, command, { status: p.status, createdBy: p.createdBy, actorId: actor.userId, actorIsOwner: actor.isOwner, reason }, { kind: "STAFF", userId: actor.userId, permissions: actor.permissions })
      if (!ev.ok) throw new AppError(ev.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_TRANSITION", ev.reason)
      await tx.update(compliancePolicies).set({ status: ev.to }).where(eq(compliancePolicies.id, id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: `compliance.policy_${command === "reject" ? "rejected" : "withdrawn"}`, entityType: "compliance_policy", entityId: id, before: { status: p.status }, after: { type: p.type, key: p.key, action: p.action, reason: reason ?? null } })
      return { ok: true, status: ev.to }
    })
  }

  // ---------------- cases ----------------

  async openCase(tx: Tx, c: { requestType: "FLIGHT" | "CARGO"; requestId: string; requestRef: string; trigger: "SCREENING" | "POLICY" | "LANE" | "GOODS"; summary: string; evidence: { kind: string; label: string; detail: string; score?: number }[]; screeningIds?: string[]; requiresFourEyes?: boolean }) {
    const [row] = await tx.insert(complianceCases).values({ ...c, screeningIds: c.screeningIds ?? [], requiresFourEyes: !!c.requiresFourEyes }).returning()
    await this.audit.record(tx, { actorKind: "SYSTEM", action: "compliance.case_opened", entityType: "compliance_case", entityId: row!.id, contextRef: c.requestRef, after: { trigger: c.trigger, summary: c.summary } })
    await this.outbox.add(tx, { aggregateType: "compliance_case", aggregateId: row!.id, eventType: "compliance.case_opened", payload: { caseId: row!.id, ref: c.requestRef, trigger: c.trigger, requestId: c.requestId } })
    return row!
  }

  async listCases(status?: string): Promise<CaseView[]> {
    const rows = await this.db.select().from(complianceCases).where(status ? eq(complianceCases.status, status as "OPEN") : undefined).orderBy(desc(complianceCases.openedAt)).limit(200)
    return Promise.all(rows.map((r) => this.caseView(r)))
  }

  async getCase(id: string) {
    const [r] = await this.db.select().from(complianceCases).where(eq(complianceCases.id, id))
    if (!r) throw new AppError("NOT_FOUND")
    return this.caseView(r)
  }

  async casesForRequest(requestType: "FLIGHT" | "CARGO", requestId: string) {
    const rows = await this.db.select().from(complianceCases).where(and(eq(complianceCases.requestType, requestType), eq(complianceCases.requestId, requestId))).orderBy(desc(complianceCases.openedAt))
    return Promise.all(rows.map((r) => this.caseView(r)))
  }

  private async caseView(r: typeof complianceCases.$inferSelect): Promise<CaseView> {
    const decisions = await this.db.select().from(complianceDecisions).where(eq(complianceDecisions.caseId, r.id)).orderBy(complianceDecisions.createdAt)
    const scr = r.screeningIds.length ? await this.db.select().from(screenings).where(inArray(screenings.id, r.screeningIds)) : []
    const hits = scr.length ? await this.db.select({ h: screeningHits, e: sanctionEntries }).from(screeningHits).innerJoin(sanctionEntries, eq(sanctionEntries.id, screeningHits.entryId)).where(inArray(screeningHits.screeningId, scr.map((s) => s.id))) : []
    const names = new Map<string, string>()
    for (const id of new Set(decisions.flatMap((d) => [d.decidedBy, d.secondApprover].filter(Boolean) as string[]))) {
      const [u] = await this.db.select({ n: users.displayName }).from(users).where(eq(users.id, id))
      names.set(id, u?.n ?? id)
    }
    const overrides = decisions.filter((d) => d.decision === "OVERRIDE" && !d.secondApprover && !decisions.some((x) => x.supersedes === d.id))
    return {
      id: r.id, requestType: r.requestType as "FLIGHT" | "CARGO", requestRef: r.requestRef, trigger: r.trigger, status: r.status, summary: r.summary, evidence: r.evidence,
      screenings: scr.map((s) => ({ id: s.id, subjectType: s.subjectType, subjectName: s.subjectName, result: s.result, listsVersion: s.listsVersion, createdAt: s.createdAt.toISOString(), hits: hits.filter((h) => h.h.screeningId === s.id).map((h) => ({ entryId: h.e.id, listId: h.e.listId, externalId: h.e.externalId, matchedName: h.h.matchedName, score: h.h.score, reasons: h.h.reasons, programmes: h.e.programmes })) })),
      decisions: decisions.map((d) => ({ id: d.id, decision: d.decision, reason: d.reason, decidedBy: names.get(d.decidedBy) ?? d.decidedBy, secondApprover: d.secondApprover ? names.get(d.secondApprover) ?? d.secondApprover : null, counselReference: d.counselReference, createdAt: d.createdAt.toISOString(), supersedes: d.supersedes })),
      openedAt: r.openedAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, assignedTo: r.assignedTo, requiresFourEyes: r.requiresFourEyes,
      pendingOverride: overrides[0] ? { decisionId: overrides[0].id, requestedBy: names.get(overrides[0].decidedBy) ?? overrides[0].decidedBy, requestedById: overrides[0].decidedBy } : null,
    }
  }

  /**
   * Release / Decline / Escalate (ch. 27.5). Overriding a BLOCK needs a second compliance officer or owner; decisions
   * are immutable, corrections are new decisions referencing the earlier one.
   */
  async decideCase(caseId: string, body: { decision: "RELEASE" | "DECLINE" | "ESCALATE" | "OVERRIDE"; reason: string; reasonCode?: string; customerMessage?: string; counselReference?: string; approveOverrideOf?: string }, actor: { userId: string; ip: string; requestId: string; isOwner: boolean }) {
    return this.uow.run(async (tx) => {
      const [c] = await tx.select().from(complianceCases).where(eq(complianceCases.id, caseId)).for("update")
      if (!c) throw new AppError("NOT_FOUND")
      if (c.status !== "OPEN" && c.status !== "ESCALATED") throw new AppError("INVALID_TRANSITION", `Case is ${c.status}`)
      if (c.status === "ESCALATED" && !actor.isOwner) throw new AppError("FORBIDDEN", "Escalated cases are decided by an owner")
      const prior = await tx.select().from(complianceDecisions).where(eq(complianceDecisions.caseId, caseId))
      if (body.decision === "DECLINE" && !body.reasonCode) throw new AppError("VALIDATION_FAILED", "Reason code is mandatory", [{ path: "reasonCode", code: "REQUIRED" }])
      let finalDecision: "RELEASE" | "DECLINE" | null = null
      let secondApprover: string | null = null
      if (body.decision === "OVERRIDE" || (body.decision === "RELEASE" && c.requiresFourEyes)) {
        if (body.approveOverrideOf) {
          const pending = prior.find((p) => p.id === body.approveOverrideOf && p.decision === "OVERRIDE")
          if (!pending) throw new AppError("NOT_FOUND", "Override request not found")
          if (pending.decidedBy === actor.userId) throw new AppError("FOUR_EYES_REQUIRED", "A second compliance officer or owner must approve")
          secondApprover = actor.userId
          finalDecision = "RELEASE"
        }
      } else if (body.decision === "RELEASE") finalDecision = "RELEASE"
      else if (body.decision === "DECLINE") finalDecision = "DECLINE"
      const [d] = await tx.insert(complianceDecisions).values({
        caseId, decision: finalDecision === "RELEASE" && secondApprover ? "OVERRIDE" : body.decision === "RELEASE" && c.requiresFourEyes ? "OVERRIDE" : body.decision, reason: body.reason, reasonCode: body.reasonCode,
        counselReference: body.counselReference, decidedBy: actor.userId, secondApprover, supersedes: body.approveOverrideOf ?? null,
      }).returning()
      const status = finalDecision === "RELEASE" ? "RELEASED" : finalDecision === "DECLINE" ? "DECLINED" : body.decision === "ESCALATE" ? "ESCALATED" : "OPEN"
      await tx.update(complianceCases).set({ status, decidedAt: finalDecision ? new Date() : null, assignedTo: body.decision === "ESCALATE" ? null : actor.userId }).where(eq(complianceCases.id, caseId))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: `compliance.case_${body.decision.toLowerCase()}`, entityType: "compliance_case", entityId: caseId, contextRef: c.requestRef, after: { decision: body.decision, reason: body.reason, reasonCode: body.reasonCode, secondApprover }, ip: actor.ip, requestId: actor.requestId })
      if (finalDecision) {
        // Release only when no other open case remains on the request.
        const others = await tx.select().from(complianceCases).where(and(eq(complianceCases.requestType, c.requestType), eq(complianceCases.requestId, c.requestId), ne(complianceCases.id, caseId), inArray(complianceCases.status, ["OPEN", "ESCALATED"])))
        if (finalDecision === "DECLINE" || others.length === 0) {
          await this.outcomeHandlers.get(c.requestType)?.(tx, c.requestId, { decision: finalDecision, reason: body.reason, reasonCode: body.reasonCode, customerMessage: body.customerMessage || (finalDecision === "DECLINE" ? await neutralDeclineFor(tx, c.requestType, c.requestId) : undefined), actorUserId: actor.userId, caseId })
        }
        await this.outbox.add(tx, { aggregateType: "compliance_case", aggregateId: caseId, eventType: "compliance.case_decided", payload: { caseId, ref: c.requestRef, decision: finalDecision, requestId: c.requestId } })
      }
      return { decisionId: d!.id, status }
    })
  }

  /** Persian tokens for UI evidence (debugging the matcher in the console). */
  explainTokens(name: string) {
    return tokens(name).map((t) => ({ token: t, phonetic: phoneticKey(t) }))
  }

  isLocal() {
    return env().APP_ENV === "local"
  }
}
