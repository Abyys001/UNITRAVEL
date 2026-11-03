import { Inject, Injectable } from "@nestjs/common"
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm"
import type { Redis } from "ioredis"
import { v4 as uuidv4 } from "uuid"

import {
  type Evidence, type ResearchRunView, type RuleKey, type StaffDocumentTypeView, type TravelDocumentTypeBody, type TravelDocumentTypePatch, type TravelDocumentTypeView,
  type TrustedSourceBody, type TrustedSourcePatch, type TrustedSourceView, type VisaCheckBody, type VisaCheckView, type VisaLegResult, type VisaOverview, type VisaRuleCreate,
  type VisaRulePatch, type VisaRuleQuery, type VisaRuleView, SOURCE_TIER, OFFICIAL_TIER_MAX, VisaFacts,
} from "@unitravel/contracts"
import { auditLog, type Db, travelDocumentTypes, visaResearchRuns, visaRules, visaTrustedSources } from "@unitravel/db"
import { checkOverride, COLOUR, customerFacts, isStale, ruleKeyFor, transitRulePurpose, worstColour } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, REDIS, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { VisaResearchService } from "./visa-research.service"

type RuleRow = typeof visaRules.$inferSelect
type DocRow = typeof travelDocumentTypes.$inferSelect
type SourceRow = typeof visaTrustedSources.$inferSelect

const CHECK_TTL_S = 3600
const FRESH_COOLDOWN_S = 600
const checkKey = (id: string) => `visa:check:${id}`
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null
/** Purposes that usually need their own visa whatever the short-visit rule says. */
const LONG_STAY = new Set(["STUDY", "MEDICAL", "OTHER"])

interface StoredCheck {
  id: string
  createdAt: string
  input: VisaCheckView["input"]
  freshLimited: boolean
  legs: Array<{ role: "DESTINATION" | "TRANSIT"; country: string; transitMode: VisaLegResult["transitMode"]; key: RuleKey; runId: string | null }>
}

export function docView(r: DocRow): TravelDocumentTypeView {
  return { code: r.code, name: r.name, description: r.description, category: r.category, issuingCountry: r.issuingCountry, active: r.active, sortOrder: r.sortOrder }
}

export function ruleView(r: RuleRow): VisaRuleView {
  return {
    id: r.id, destination: r.destination, documentType: r.documentType, issuingCountry: r.issuingCountry, purpose: r.purpose, facts: r.facts, verification: r.verification,
    origin: r.origin, evidence: r.evidence, conflicts: r.conflicts, verifiedAt: iso(r.verifiedAt), expiresAt: iso(r.expiresAt), overrideReason: r.overrideReason,
    updatedBy: r.updatedBy, version: r.version, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  }
}

function sourceView(s: SourceRow): TrustedSourceView {
  const tier = SOURCE_TIER[s.kind]
  return {
    id: s.id, country: s.country, url: s.url, title: s.title, kind: s.kind, tier, official: tier <= OFFICIAL_TIER_MAX, active: s.active, notes: s.notes,
    lastFetchedAt: iso(s.lastFetchedAt), lastStatus: s.lastStatus, version: s.version, updatedAt: s.updatedAt.toISOString(),
  }
}

function runView(r: typeof visaResearchRuns.$inferSelect): ResearchRunView {
  return {
    id: r.id, destination: r.destination, documentType: r.documentType, issuingCountry: r.issuingCountry, purpose: r.purpose, trigger: r.trigger, status: r.status, ruleId: r.ruleId,
    resultStatus: (r.resultStatus as ResearchRunView["resultStatus"]) ?? null, resultVerification: (r.resultVerification as ResearchRunView["resultVerification"]) ?? null,
    fetches: r.fetches, droppedClaims: r.droppedClaims, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, error: r.error, requestedBy: r.requestedBy,
    startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt), createdAt: r.createdAt.toISOString(),
  }
}

const keyWhere = (k: RuleKey) => and(eq(visaRules.destination, k.destination), eq(visaRules.documentType, k.documentType), eq(visaRules.issuingCountry, k.issuingCountry), eq(visaRules.purpose, k.purpose))
const offsetCursor = (c?: string) => { const n = Number(c ?? 0); return Number.isInteger(n) && n >= 0 ? n : 0 }

/** ADR-0029: customer checks (held in Valkey for an hour, never stored against the customer) and the staff database. */
@Injectable()
export class VisaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly research: VisaResearchService,
  ) {}

  // ---------------- public ----------------

  async documentTypes(): Promise<TravelDocumentTypeView[]> {
    const rows = await this.db.select().from(travelDocumentTypes).where(eq(travelDocumentTypes.active, true)).orderBy(asc(travelDocumentTypes.sortOrder))
    return rows.map(docView)
  }

  async createCheck(body: VisaCheckBody, actor: Actor | undefined): Promise<VisaCheckView> {
    const [doc] = await this.db.select().from(travelDocumentTypes).where(and(eq(travelDocumentTypes.code, body.documentType), eq(travelDocumentTypes.active, true)))
    if (!doc) throw new AppError("VALIDATION_FAILED", "Unknown travel document type", [{ path: "documentType", code: "UNKNOWN", message: "Unknown travel document type" }])
    if (doc.issuingCountry && doc.issuingCountry !== body.issuingCountry) {
      throw new AppError("VALIDATION_FAILED", "This document is issued by one country only", [{ path: "issuingCountry", code: "FIXED_ISSUER", message: `This document is issued by ${doc.issuingCountry}` }])
    }
    if (doc.category === "NATIONAL_PASSPORT" && body.issuingCountry === "GB") {
      throw new AppError("VALIDATION_FAILED", "Choose the British passport type instead", [{ path: "documentType", code: "CHOOSE_BRITISH_TYPE", message: "For a UK passport choose its exact type (British citizen, BN(O), BOTC, ...)" }])
    }
    if (body.fresh && !actor) throw new AppError("UNAUTHENTICATED", "Sign in to ask for a fresh verification")

    const document = { documentType: doc.code, issuingCountry: body.issuingCountry, category: doc.category }
    const legs: StoredCheck["legs"] = [
      { role: "DESTINATION", country: body.destination, transitMode: null, key: ruleKeyFor(document, body.destination, "VISIT"), runId: null },
      ...body.transits.map((t) => ({ role: "TRANSIT" as const, country: t.country, transitMode: t.mode, key: ruleKeyFor(document, t.country, transitRulePurpose(t.mode)), runId: null })),
    ]
    const now = new Date()
    let freshLimited = false
    for (const leg of legs) {
      const [rule] = await this.db.select().from(visaRules).where(keyWhere(leg.key))
      let trigger: "CHECK" | "STALE" | "FRESH" | null = !rule ? "CHECK" : isStale(rule.expiresAt, now) && rule.verification !== "OVERRIDDEN" ? "STALE" : null
      if (body.fresh && actor) {
        const k = `visa:fresh:${actor.userId}:${leg.key.destination}:${leg.key.documentType}:${leg.key.issuingCountry}:${leg.key.purpose}`
        if ((await this.redis.set(k, "1", "EX", FRESH_COOLDOWN_S, "NX")) === "OK") trigger = "FRESH"
        else freshLimited = true
      }
      if (trigger) leg.runId = await this.research.request(leg.key, trigger, actor?.userId ?? null)
      else leg.runId = await this.research.activeRun(leg.key)
    }
    const stored: StoredCheck = {
      id: uuidv4(), createdAt: now.toISOString(), legs, freshLimited,
      input: {
        documentType: doc.code, documentName: doc.name, issuingCountry: body.issuingCountry, nationality: body.nationality, residenceCountry: body.residenceCountry,
        residencePermit: body.residencePermit, destination: body.destination, departureDate: body.departureDate, returnDate: body.returnDate, purpose: body.purpose,
      },
    }
    await this.redis.set(checkKey(stored.id), JSON.stringify(stored), "EX", CHECK_TTL_S)
    return this.view(stored)
  }

  async getCheck(id: string): Promise<VisaCheckView> {
    const raw = await this.redis.get(checkKey(id))
    if (!raw) throw notFound()
    return this.view(JSON.parse(raw) as StoredCheck)
  }

  private async view(c: StoredCheck): Promise<VisaCheckView> {
    const now = new Date()
    const configured = await this.research.configured()
    const legs: VisaLegResult[] = []
    for (const leg of c.legs) {
      const [rule] = await this.db.select().from(visaRules).where(keyWhere(leg.key))
      const run = leg.runId ? (await this.db.select().from(visaResearchRuns).where(eq(visaResearchRuns.id, leg.runId)))[0] : undefined
      const running = run && (run.status === "QUEUED" || run.status === "RUNNING")
      const facts = customerFacts(rule ? { facts: rule.facts, verification: rule.verification } : null)
      const stale = !!rule && isStale(rule.expiresAt, now) && rule.verification !== "OVERRIDDEN"
      const notices = new Set<VisaLegResult["notices"][number]>()
      if (c.input.documentType !== "GB_CITIZEN_PASSPORT") notices.add("GOVUK_BRITISH_CITIZEN_ONLY")
      if (c.input.residenceCountry && c.input.residenceCountry !== c.input.nationality) notices.add("RESIDENCE_NOT_CITIZENSHIP")
      if (leg.role === "TRANSIT" && leg.transitMode !== "AIRSIDE") notices.add("TRANSIT_LEAVES_AIRSIDE")
      if (leg.role === "DESTINATION" && LONG_STAY.has(c.input.purpose)) notices.add("LONG_STAY_PURPOSE")
      if (leg.country === c.input.issuingCountry) notices.add("SAME_COUNTRY")
      if (rule?.verification === "CONFLICT") notices.add("CONFLICTING_SOURCES")
      if (stale) notices.add("STALE")
      if (!configured && facts.status === "UNCONFIRMED") notices.add("NOT_CONFIGURED")
      if (run?.status === "FAILED" && !running) notices.add("RESEARCH_FAILED")
      const evidence: Evidence[] = rule?.evidence ?? []
      if (facts.status === "UNCONFIRMED" && evidence.length > 0 && evidence.every((e) => !e.official)) notices.add("THIRD_PARTY_ONLY")

      const officialLinks = await this.officialLinks(leg.country, facts.applicationUrl)
      legs.push({
        role: leg.role, country: leg.country, transitMode: leg.transitMode,
        state: running && (!rule || rule.verification === "UNVERIFIED") ? "RESEARCHING" : !rule && run?.status === "FAILED" ? "FAILED" : "READY",
        facts, colour: COLOUR[facts.status], verification: rule?.verification ?? null, verifiedAt: iso(rule?.verifiedAt), stale,
        // Official sources first. Unofficial ones are shown labelled "supporting, not official".
        sources: [...evidence].sort((a, b) => a.tier - b.tier).map((e) => ({ url: e.url, title: e.title, kind: e.kind, official: e.official, origin: e.origin, fetchedAt: e.fetchedAt, sourceUpdatedAt: e.sourceUpdatedAt, quotes: e.quotes.slice(0, 3) })),
        officialLinks, notices: [...notices],
      })
    }
    return { id: c.id, createdAt: c.createdAt, input: { ...c.input, residencePermit: c.input.residencePermit ?? null }, freshLimited: c.freshLimited ?? false, complete: legs.every((l) => l.state !== "RESEARCHING"), legs, overall: worstColour(legs.map((l) => l.colour)) }
  }

  private async officialLinks(country: string, applicationUrl: string | null) {
    const links: VisaLegResult["officialLinks"] = []
    const slug = await this.research.govukSlug(country)
    if (slug) links.push({ url: `https://www.gov.uk/foreign-travel-advice/${slug}/entry-requirements`, title: "GOV.UK foreign travel advice: entry requirements", kind: "GOVUK" })
    const trusted = await this.db.select().from(visaTrustedSources).where(and(eq(visaTrustedSources.country, country), eq(visaTrustedSources.active, true)))
    for (const s of trusted) if (SOURCE_TIER[s.kind] <= OFFICIAL_TIER_MAX) links.push({ url: s.url, title: s.title, kind: "TRUSTED" })
    if (applicationUrl && !links.some((l) => l.url === applicationUrl)) links.push({ url: applicationUrl, title: "Official application", kind: "APPLICATION" })
    return links.slice(0, 8)
  }

  // ---------------- staff: overview ----------------

  async overview(): Promise<VisaOverview> {
    const now = new Date()
    const byV = await this.db.select({ v: visaRules.verification, n: count() }).from(visaRules).groupBy(visaRules.verification)
    const total = byV.reduce((a, r) => a + Number(r.n), 0)
    const staleWhere = and(or(isNull(visaRules.expiresAt), lte(visaRules.expiresAt, now)), sql`${visaRules.verification} <> 'OVERRIDDEN'`)
    const [stale] = await this.db.select({ n: count() }).from(visaRules).where(staleWhere)
    const since = new Date(now.getTime() - 86400_000)
    const runs = await this.db.select({ s: visaResearchRuns.status, n: count() }).from(visaResearchRuns).where(gte(visaResearchRuns.createdAt, since)).groupBy(visaResearchRuns.status)
    const staleDest = await this.db.select({ destination: visaRules.destination, rules: count(), oldest: sql<Date | null>`min(${visaRules.verifiedAt})` })
      .from(visaRules).where(staleWhere).groupBy(visaRules.destination).orderBy(desc(count())).limit(20)
    const byVerification = { VERIFIED: 0, UNVERIFIED: 0, CONFLICT: 0, OVERRIDDEN: 0 }
    for (const r of byV) byVerification[r.v] = Number(r.n)
    return {
      rules: total, byVerification, stale: Number(stale?.n ?? 0), conflicts: byVerification.CONFLICT,
      failedRuns24h: runs.filter((r) => r.s === "FAILED" || r.s === "NOT_CONFIGURED").reduce((a, r) => a + Number(r.n), 0),
      runs24h: runs.reduce((a, r) => a + Number(r.n), 0), researchConfigured: await this.research.configured(),
      staleDestinations: staleDest.map((d) => ({ destination: d.destination, rules: Number(d.rules), oldestVerifiedAt: d.oldest ? new Date(d.oldest).toISOString() : null })),
    }
  }

  // ---------------- staff: rules ----------------

  async listRules(q: VisaRuleQuery) {
    const now = new Date()
    const conds = [
      q.destination ? eq(visaRules.destination, q.destination) : undefined,
      q.documentType ? eq(visaRules.documentType, q.documentType) : undefined,
      q.verification ? eq(visaRules.verification, q.verification) : undefined,
      q.status ? eq(visaRules.status, q.status) : undefined,
      q.stale === true ? or(isNull(visaRules.expiresAt), lte(visaRules.expiresAt, now)) : q.stale === false ? gte(visaRules.expiresAt, now) : undefined,
    ].filter(Boolean)
    const offset = offsetCursor(q.cursor)
    const rows = await this.db.select().from(visaRules).where(conds.length ? and(...conds) : undefined).orderBy(desc(visaRules.updatedAt), asc(visaRules.id)).limit(q.limit + 1).offset(offset)
    return { items: rows.slice(0, q.limit).map(ruleView), nextCursor: rows.length > q.limit ? String(offset + q.limit) : null }
  }

  async getRule(id: string) {
    const [r] = await this.db.select().from(visaRules).where(eq(visaRules.id, id))
    if (!r) throw notFound()
    return ruleView(r)
  }

  private staffEvidence(urls: readonly string[], reason: string): Evidence[] {
    const at = new Date().toISOString()
    return urls.map((url) => ({
      url, title: "Confirmed by staff", kind: "OTHER_GOVERNMENT" as const, tier: SOURCE_TIER.OTHER_GOVERNMENT, official: true, origin: "STAFF" as const, fetchedAt: at,
      sourceUpdatedAt: null, covers: [], claims: {}, quotes: [reason.slice(0, 1200)],
    }))
  }

  /** Staff create a row by hand (for example from an embassy reply). It counts as an override: reason and official URL required. */
  async createRule(body: VisaRuleCreate, actor: Actor, requestId: string) {
    const ok = checkOverride({ reason: body.reason, officialUrls: body.officialUrls, status: body.facts.status })
    if (!ok.ok) throw new AppError("VALIDATION_FAILED", ok.reason)
    await this.assertDocType(body.documentType)
    const [existing] = await this.db.select({ id: visaRules.id }).from(visaRules).where(keyWhere(body))
    if (existing) throw new AppError("VERSION_CONFLICT", "A rule for this key exists; edit it instead")
    const facts = VisaFacts.parse(body.facts)
    const id = await this.uow.run(async (tx) => {
      const [row] = await tx.insert(visaRules).values({
        destination: body.destination, documentType: body.documentType, issuingCountry: body.issuingCountry, purpose: body.purpose, status: facts.status, facts,
        verification: "OVERRIDDEN", origin: "MANUAL", evidence: this.staffEvidence(body.officialUrls, body.reason), conflicts: [], verifiedAt: new Date(),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, overrideReason: body.reason, updatedBy: actor.userId,
      }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "visa_rule.created", entityType: "visa_rule", entityId: row!.id, after: ruleView(row!), ip: actor.ip, requestId })
      return row!.id
    })
    return this.getRule(id)
  }

  async patchRule(id: string, body: VisaRulePatch, actor: Actor, requestId: string) {
    const [before] = await this.db.select().from(visaRules).where(eq(visaRules.id, id))
    if (!before) throw notFound()
    if (before.version !== body.version) throw new AppError("VERSION_CONFLICT")
    let facts: VisaFacts = VisaFacts.parse({ ...before.facts, ...(body.facts ?? {}) })
    let verification = before.verification
    let overrideReason = before.overrideReason
    let evidence = before.evidence
    let verifiedAt = before.verifiedAt
    let action = "visa_rule.updated"

    const factsChanged = !!body.facts && Object.keys(body.facts).length > 0
    if (body.verification === "OVERRIDDEN" || (factsChanged && body.verification !== "UNVERIFIED")) {
      // Any change to the facts is an override: a person now stands behind the answer.
      const ok = checkOverride({ reason: body.reason, officialUrls: body.officialUrls, status: facts.status })
      if (!ok.ok) throw new AppError("VALIDATION_FAILED", ok.reason)
      verification = "OVERRIDDEN"; overrideReason = body.reason!; verifiedAt = new Date(); action = "visa_rule.overridden"
      evidence = [...before.evidence.filter((e) => e.origin !== "STAFF"), ...this.staffEvidence(body.officialUrls!, body.reason!)]
    } else if (body.verification === "VERIFIED") {
      // Confirms the researched answer; only possible when the gate produced one.
      if (before.status === "UNCONFIRMED") throw new AppError("VALIDATION_FAILED", "Nothing to verify: set the answer as an override with a reason and an official source")
      if (!body.reason) throw new AppError("VALIDATION_FAILED", "REASON_REQUIRED")
      verification = "VERIFIED"; verifiedAt = new Date(); action = "visa_rule.verified"
    } else if (body.verification === "UNVERIFIED") {
      if (!body.reason) throw new AppError("VALIDATION_FAILED", "REASON_REQUIRED")
      // Withdrawing an answer: the customer sees "unconfirmed" until research or staff confirm again.
      facts = { ...facts, status: "UNCONFIRMED" }; verification = "UNVERIFIED"; overrideReason = null; action = "visa_rule.withdrawn"
    }
    const expiresAt = body.expiresAt === undefined ? before.expiresAt : body.expiresAt === null ? null : new Date(body.expiresAt)
    await this.uow.run(async (tx) => {
      const [after] = await tx.update(visaRules).set({
        facts, status: facts.status, verification, overrideReason, evidence, verifiedAt, expiresAt, updatedBy: actor.userId, version: before.version + 1,
        // A withdrawn row goes back to research; otherwise a hand-made row would never be researched again.
        origin: action === "visa_rule.withdrawn" ? "RESEARCH" : before.origin,
      }).where(and(eq(visaRules.id, id), eq(visaRules.version, body.version))).returning()
      if (!after) throw new AppError("VERSION_CONFLICT")
      await this.audit.record(tx, {
        actorUserId: actor.userId, actorKind: "STAFF", action, entityType: "visa_rule", entityId: id, before: ruleView(before), after: { ...ruleView(after), reason: body.reason ?? null },
        ip: actor.ip, requestId,
      })
    })
    return this.getRule(id)
  }

  async requestResearch(key: RuleKey, actor: Actor, requestId: string) {
    await this.assertDocType(key.documentType)
    const runId = await this.research.request(key, "STAFF", actor.userId)
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "visa_rule.research_requested", entityType: "visa_research_run", entityId: runId, after: key, ip: actor.ip, requestId }))
    return { runId }
  }

  async listRuns(q: { status?: ResearchRunView["status"]; destination?: string; cursor?: string; limit: number }) {
    const conds = [q.status ? eq(visaResearchRuns.status, q.status) : undefined, q.destination ? eq(visaResearchRuns.destination, q.destination) : undefined].filter(Boolean)
    const offset = offsetCursor(q.cursor)
    const rows = await this.db.select().from(visaResearchRuns).where(conds.length ? and(...conds) : undefined).orderBy(desc(visaResearchRuns.createdAt)).limit(q.limit + 1).offset(offset)
    return { items: rows.slice(0, q.limit).map(runView), nextCursor: rows.length > q.limit ? String(offset + q.limit) : null }
  }

  // ---------------- staff: sources ----------------

  async listSources(country?: string) {
    const rows = await this.db.select().from(visaTrustedSources).where(country ? or(eq(visaTrustedSources.country, country), isNull(visaTrustedSources.country)) : undefined).orderBy(asc(visaTrustedSources.country), asc(visaTrustedSources.title))
    return rows.map(sourceView)
  }

  async createSource(body: TrustedSourceBody, actor: Actor, requestId: string) {
    const row = await this.uow.run(async (tx) => {
      const [r] = await tx.insert(visaTrustedSources).values({ ...body, createdBy: actor.userId, updatedBy: actor.userId }).onConflictDoNothing().returning()
      if (!r) throw new AppError("VERSION_CONFLICT", "This source is already listed for that country")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "visa_source.created", entityType: "visa_source", entityId: r.id, after: sourceView(r), ip: actor.ip, requestId })
      return r
    })
    return sourceView(row)
  }

  async patchSource(id: string, body: TrustedSourcePatch, actor: Actor, requestId: string) {
    const [before] = await this.db.select().from(visaTrustedSources).where(eq(visaTrustedSources.id, id))
    if (!before) throw notFound()
    const { version, ...changes } = body
    const row = await this.uow.run(async (tx) => {
      const [r] = await tx.update(visaTrustedSources).set({ ...changes, updatedBy: actor.userId, version: before.version + 1 }).where(and(eq(visaTrustedSources.id, id), eq(visaTrustedSources.version, version))).returning()
      if (!r) throw new AppError("VERSION_CONFLICT")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "visa_source.updated", entityType: "visa_source", entityId: id, before: sourceView(before), after: sourceView(r), ip: actor.ip, requestId })
      return r
    })
    return sourceView(row)
  }

  // ---------------- staff: document types ----------------

  private async assertDocType(code: string) {
    const [d] = await this.db.select({ code: travelDocumentTypes.code }).from(travelDocumentTypes).where(eq(travelDocumentTypes.code, code))
    if (!d) throw new AppError("VALIDATION_FAILED", "Unknown travel document type")
  }

  async staffDocumentTypes(): Promise<StaffDocumentTypeView[]> {
    const rows = await this.db.select().from(travelDocumentTypes).orderBy(asc(travelDocumentTypes.sortOrder))
    return rows.map((r) => ({ ...docView(r), version: r.version }))
  }

  async createDocumentType(body: TravelDocumentTypeBody, actor: Actor, requestId: string) {
    const row = await this.uow.run(async (tx) => {
      const [r] = await tx.insert(travelDocumentTypes).values(body).onConflictDoNothing().returning()
      if (!r) throw new AppError("VERSION_CONFLICT", "This code exists")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "travel_document_type.created", entityType: "travel_document_type", entityId: r.code, after: docView(r), ip: actor.ip, requestId })
      return r
    })
    return { ...docView(row), version: row.version }
  }

  async patchDocumentType(code: string, body: TravelDocumentTypePatch, actor: Actor, requestId: string) {
    const [before] = await this.db.select().from(travelDocumentTypes).where(eq(travelDocumentTypes.code, code))
    if (!before) throw notFound()
    const { version, ...changes } = body
    const row = await this.uow.run(async (tx) => {
      const [r] = await tx.update(travelDocumentTypes).set({ ...changes, version: before.version + 1 }).where(and(eq(travelDocumentTypes.code, code), eq(travelDocumentTypes.version, version))).returning()
      if (!r) throw new AppError("VERSION_CONFLICT")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "travel_document_type.updated", entityType: "travel_document_type", entityId: code, before: docView(before), after: docView(r), ip: actor.ip, requestId })
      return r
    })
    return { ...docView(row), version: row.version }
  }

  // ---------------- staff: audit trail ----------------

  async auditTrail(q: { cursor?: string; limit: number }) {
    const conds = [inArray(auditLog.entityType, ["visa_rule", "visa_source", "travel_document_type", "visa_research_run", "visa_research"])]
    if (q.cursor && /^\d+$/.test(q.cursor)) conds.push(lt(auditLog.id, Number(q.cursor)))
    const rows = await this.db.select().from(auditLog).where(and(...conds)).orderBy(desc(auditLog.id)).limit(q.limit + 1)
    const items = rows.slice(0, q.limit).map((r) => ({
      id: String(r.id), occurredAt: r.occurredAt.toISOString(), action: r.action, entityType: r.entityType, entityId: r.entityId, actorUserId: r.actorUserId, before: r.before, after: r.after,
    }))
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null }
  }

  // ---------------- dev: credential ----------------

  async setCredential(apiKey: string, actor: Actor, requestId: string) {
    await this.research.setCredential(apiKey, actor.userId)
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "visa_research.credential_rotated", entityType: "visa_research", entityId: "anthropic", ip: actor.ip, requestId }))
    return this.credentialStatus()
  }

  async clearCredential(actor: Actor, requestId: string) {
    await this.research.clearCredential()
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "visa_research.credential_removed", entityType: "visa_research", entityId: "anthropic", ip: actor.ip, requestId }))
    return this.credentialStatus()
  }

  async credentialStatus() {
    const meta = await this.research.credentialMeta()
    return { set: !!meta, rotatedAt: iso(meta?.rotatedAt), rotatedBy: meta?.rotatedBy ?? null, model: "claude-opus-5-5", ttlDays: this.config.settings().visa.ruleTtlDays }
  }
}
