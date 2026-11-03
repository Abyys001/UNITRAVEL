import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, eq, inArray, isNull, or } from "drizzle-orm"
import type { Job } from "bullmq"

import { EMPTY_FACTS, type RuleKey, type SourceKind } from "@unitravel/contracts"
import { type Db, travelDocumentTypes, visaResearchCredentials, visaResearchRuns, visaRules, visaTrustedSources } from "@unitravel/db"
import { decideVisa, verifyEvidence, ruleKeyString } from "@unitravel/domain"

import { decryptField, encryptField } from "../../core/crypto"
import { sandboxAllowed } from "../../core/env"
import { DB } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { WorkerRegistry } from "../../core/workers"
import { ConfigService } from "../config/config.service"
import { ClaudeVisaExtractor, type ExtractionPage, SandboxVisaExtractor, type VisaExtractor } from "./claude-extractor"
import { type FetchLog, type FetchedPage, isGovernmentHost, PageFetcher } from "./page-fetcher"

/** Pages read per run, so one run's cost and time stay bounded. */
export const MAX_PAGES = 8
const CREDENTIAL_ID = "anthropic"
export type RunTrigger = "CHECK" | "FRESH" | "STALE" | "STAFF"

const regionNames = new Intl.DisplayNames(["en"], { type: "region" })
export const countryName = (code: string) => { try { return regionNames.of(code) ?? code } catch { return code } }

/** GOV.UK slugs that differ from the English region name ICU gives. */
const GOVUK_ALIASES: Record<string, string> = {
  US: "usa", TR: "turkey", MM: "myanmar", CZ: "czechia", KR: "south-korea", KP: "north-korea", CD: "democratic-republic-of-the-congo", CG: "congo",
  PS: "palestine", MO: "macao", HK: "hong-kong", CI: "cote-d-ivoire", FM: "federated-states-of-micronesia", VA: "italy", BQ: "bonaire-st-eustatius-saba",
  SX: "st-maarten", MF: "st-martin-and-st-barthelemy", BL: "st-martin-and-st-barthelemy", PM: "st-pierre-and-miquelon", KN: "st-kitts-and-nevis",
  LC: "st-lucia", VC: "st-vincent-and-the-grenadines", SH: "st-helena-ascension-and-tristan-da-cunha", PN: "pitcairn-island", TL: "timor-leste",
  CV: "cape-verde", SZ: "eswatini", GM: "the-gambia", RU: "russia", LA: "laos", VN: "vietnam", SY: "syria", IR: "iran", BN: "brunei", MK: "north-macedonia",
}
export const slugify = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export function documentDescription(doc: { name: { en: string }; category: string }, issuingCountry: string): string {
  const issuer = countryName(issuingCountry)
  if (doc.category === "NATIONAL_PASSPORT") return `a national passport issued by ${issuer} (the holder is a citizen of ${issuer})`
  return `${doc.name.en}, issued by ${issuer}. This is a distinct document type; do not apply rules written for other documents from the same issuer`
}
export const purposeDescription = (k: RuleKey) => (k.purpose === "TRANSIT"
  ? "airport transit only: changing flights and staying in the international transit area without passing through immigration"
  : "a short visit (tourism, business meetings or visiting family), entering the country")

/**
 * ADR-0033 research engine. One run per rule key at a time (BullMQ job id), recorded in visa_research_runs. The rule row is
 * written only by this service (research) and by staff through VisaService (audited).
 */
@Injectable()
export class VisaResearchService implements OnModuleInit {
  private readonly log = new Logger("VisaResearch")
  private govukIndex: { at: number; slugs: Set<string> } | null = null

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly queues: Queues,
    private readonly workers: WorkerRegistry,
    private readonly fetcher: PageFetcher,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.workers.register("visa.research", (job: Job) => this.run(job.data as { runId: string }), 2)
  }

  // ---------------- credential ----------------

  async configured(): Promise<boolean> {
    const [c] = await this.db.select({ id: visaResearchCredentials.id }).from(visaResearchCredentials).where(eq(visaResearchCredentials.id, CREDENTIAL_ID))
    return !!c
  }

  async credentialMeta() {
    const [c] = await this.db.select({ rotatedAt: visaResearchCredentials.rotatedAt, rotatedBy: visaResearchCredentials.rotatedBy }).from(visaResearchCredentials).where(eq(visaResearchCredentials.id, CREDENTIAL_ID))
    return c ?? null
  }

  async setCredential(apiKey: string, actorId: string) {
    const enc = encryptField(apiKey)
    await this.db.insert(visaResearchCredentials).values({ id: CREDENTIAL_ID, ciphertext: enc.ciphertext, keyId: enc.keyId, rotatedBy: actorId, rotatedAt: new Date() })
      .onConflictDoUpdate({ target: visaResearchCredentials.id, set: { ciphertext: enc.ciphertext, keyId: enc.keyId, rotatedBy: actorId, rotatedAt: new Date() } })
  }

  async clearCredential() {
    await this.db.delete(visaResearchCredentials).where(eq(visaResearchCredentials.id, CREDENTIAL_ID))
  }

  private async extractor(): Promise<VisaExtractor | null> {
    const [c] = await this.db.select().from(visaResearchCredentials).where(eq(visaResearchCredentials.id, CREDENTIAL_ID))
    if (c) return new ClaudeVisaExtractor(decryptField(c.ciphertext))
    return sandboxAllowed() ? new SandboxVisaExtractor() : null
  }

  // ---------------- queueing ----------------

  /** Queues a run unless one for the same key is already queued or running; returns that run's id either way. */
  async request(key: RuleKey, trigger: RunTrigger, requestedBy: string | null): Promise<string> {
    const active = await this.activeRun(key)
    if (active) return active
    const [run] = await this.db.insert(visaResearchRuns).values({ ...key, trigger, requestedBy }).returning({ id: visaResearchRuns.id })
    const jobId = `visa-${ruleKeyString(key).replace(/:/g, "-")}-${run!.id}`
    await this.queues.get("visa.research").add("visa.research", { runId: run!.id }, { jobId })
    return run!.id
  }

  async activeRun(key: RuleKey): Promise<string | null> {
    const [r] = await this.db.select({ id: visaResearchRuns.id }).from(visaResearchRuns).where(and(
      eq(visaResearchRuns.destination, key.destination), eq(visaResearchRuns.documentType, key.documentType),
      eq(visaResearchRuns.issuingCountry, key.issuingCountry), eq(visaResearchRuns.purpose, key.purpose), inArray(visaResearchRuns.status, ["QUEUED", "RUNNING"]),
    )).limit(1)
    return r?.id ?? null
  }

  // ---------------- sources ----------------

  async govukSlug(country: string): Promise<string | null> {
    if (!this.govukIndex || Date.now() - this.govukIndex.at > 24 * 3600_000) {
      try {
        const res = await fetch("https://www.gov.uk/api/content/foreign-travel-advice", { headers: { "user-agent": this.fetcher.userAgent() }, signal: AbortSignal.timeout(15_000) })
        const body = (await res.json()) as { links?: { children?: Array<{ details?: { country?: { slug?: string } } }> } }
        const slugs = new Set((body.links?.children ?? []).flatMap((c) => (c.details?.country?.slug ? [c.details.country.slug] : [])))
        if (slugs.size > 50) this.govukIndex = { at: Date.now(), slugs }
      } catch (err) {
        this.log.warn({ err: String(err) }, "GOV.UK index fetch failed")
      }
    }
    const candidates = [GOVUK_ALIASES[country], slugify(countryName(country))].filter((s): s is string => !!s)
    if (!this.govukIndex) return candidates[0] ?? null
    return candidates.find((s) => this.govukIndex!.slugs.has(s)) ?? null
  }

  private async trustedFor(country: string) {
    return this.db.select().from(visaTrustedSources).where(and(eq(visaTrustedSources.active, true), or(eq(visaTrustedSources.country, country), isNull(visaTrustedSources.country))))
  }

  // ---------------- the run ----------------

  async run({ runId }: { runId: string }): Promise<void> {
    const [run] = await this.db.select().from(visaResearchRuns).where(eq(visaResearchRuns.id, runId))
    if (!run || (run.status !== "QUEUED" && run.status !== "RUNNING")) return
    const key: RuleKey = { destination: run.destination, documentType: run.documentType, issuingCountry: run.issuingCountry, purpose: run.purpose }
    await this.db.update(visaResearchRuns).set({ status: "RUNNING", startedAt: new Date() }).where(eq(visaResearchRuns.id, runId))
    const fetches: FetchLog[] = []
    try {
      const [doc] = await this.db.select().from(travelDocumentTypes).where(eq(travelDocumentTypes.code, key.documentType))
      if (!doc) throw new Error(`Unknown document type ${key.documentType}`)
      const extractor = await this.extractor()

      // 1. Sources: GOV.UK, staff-trusted, official links on the GOV.UK page, then (optionally) a domain-restricted search.
      const pages: ExtractionPage[] = []
      const add = (p: FetchedPage, kind: SourceKind, origin: ExtractionPage["origin"]) => {
        if (pages.length < MAX_PAGES && !pages.some((x) => x.url === p.url)) pages.push({ url: p.url, title: p.title, kind, origin, text: p.text, updatedAt: p.updatedAt })
      }
      const slug = await this.govukSlug(key.destination)
      const govuk = slug ? await this.fetcher.govuk(slug, fetches) : null
      if (govuk) add(govuk, "GOVUK_FTA", "TRUSTED")

      const trusted = await this.trustedFor(key.destination)
      const ordered = [...trusted].sort((a, b) => (a.country ? 0 : 1) - (b.country ? 0 : 1))
      for (const s of ordered) {
        if (pages.length >= MAX_PAGES) break
        const before = fetches.length
        const p = await this.fetcher.page(s.url, fetches)
        await this.db.update(visaTrustedSources).set({ lastFetchedAt: new Date(), lastStatus: fetches[before]?.status ?? "ERROR" }).where(eq(visaTrustedSources.id, s.id))
        if (p) add(p, s.kind, "TRUSTED")
      }
      const trustedHosts = new Map(trusted.map((s) => [new URL(s.url).hostname, s.kind] as const))
      const govLinks = (govuk?.links ?? []).filter((u) => { const h = new URL(u).hostname; return isGovernmentHost(h) || trustedHosts.has(h) }).slice(0, 4)
      for (const u of govLinks) {
        if (pages.length >= MAX_PAGES) break
        const p = await this.fetcher.page(u, fetches)
        if (p) add(p, trustedHosts.get(new URL(u).hostname) ?? "OTHER_GOVERNMENT", "GOVUK_LINK")
      }

      const docText = documentDescription(doc, key.issuingCountry)
      const destName = countryName(key.destination)
      if (extractor && this.config.settings().visa.searchOfficialDomains && pages.length < MAX_PAGES) {
        const officialHosts = new Set<string>([...trusted.filter((s) => s.kind !== "THIRD_PARTY" && s.kind !== "IATA").map((s) => new URL(s.url).hostname), ...govLinks.map((u) => new URL(u).hostname)])
        try {
          const found = await extractor.discover({ destinationName: destName, documentDescription: docText, purposeDescription: purposeDescription(key), domains: [...officialHosts] })
          for (const u of found) {
            if (pages.length >= MAX_PAGES) break
            const p = await this.fetcher.page(u, fetches)
            if (p) add(p, trustedHosts.get(new URL(u).hostname) ?? "OTHER_GOVERNMENT", "SEARCH")
          }
        } catch (err) {
          fetches.push({ url: "web_search", status: "SEARCH_FAILED", ms: 0, chars: null })
          this.log.warn({ err: String(err) }, "domain search failed")
        }
      }

      if (!extractor) {
        await this.writeRule(key, null, 0)
        await this.finish(runId, { status: "NOT_CONFIGURED", fetches, error: "No Anthropic API key in the Developer Panel; results stay unconfirmed" })
        return
      }
      if (pages.length === 0) {
        // Recorded as an unconfirmed rule so the gap shows in the staff database, where a source or an override can be added.
        const ruleId = await this.writeRule(key, null, 0, true)
        await this.finish(runId, { status: "FAILED", fetches, ruleId, error: "No source could be read" })
        return
      }

      // 2. Extraction, 3. quote verification and the gate.
      const out = await extractor.extract({ key, documentDescription: docText, destinationName: destName, purposeDescription: purposeDescription(key), pages })
      const { kept, dropped } = verifyEvidence(key, out.evidence, new Map(pages.map((p) => [p.url, p.text])))
      const decision = decideVisa(key, kept)
      const someFetchFailed = fetches.some((f) => f.status !== "OK" && f.url !== "web_search")
      const ruleId = await this.writeRule(key, { ...decision, evidence: kept }, dropped, someFetchFailed)
      const [rule] = await this.db.select().from(visaRules).where(eq(visaRules.id, ruleId))
      await this.finish(runId, {
        status: "DONE", fetches, ruleId, resultStatus: rule?.status ?? null, resultVerification: rule?.verification ?? null,
        droppedClaims: dropped, model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log.warn({ runId, err: message }, "visa research failed")
      await this.finish(runId, { status: "FAILED", fetches, error: message.slice(0, 1000) })
    }
  }

  private async finish(runId: string, v: Partial<typeof visaResearchRuns.$inferInsert>) {
    await this.db.update(visaResearchRuns).set({ ...v, finishedAt: new Date() }).where(eq(visaResearchRuns.id, runId))
  }

  /**
   * Writes the researched answer. A staff override or a manual row is never overwritten by research. A verified answer is not
   * downgraded by a run in which a source could not be read (it stays, and its expiry keeps it flagged stale).
   */
  private async writeRule(key: RuleKey, result: (ReturnType<typeof decideVisa> & { evidence: ReturnType<typeof verifyEvidence>["kept"] }) | null, _dropped: number, someFetchFailed = false): Promise<string> {
    const where = and(eq(visaRules.destination, key.destination), eq(visaRules.documentType, key.documentType), eq(visaRules.issuingCountry, key.issuingCountry), eq(visaRules.purpose, key.purpose))
    const [existing] = await this.db.select().from(visaRules).where(where)
    const now = new Date()
    const ttlDays = this.config.settings().visa.ruleTtlDays
    const decision = result ?? { facts: { ...EMPTY_FACTS }, verification: "UNVERIFIED" as const, conflicts: [], evidence: [] }
    const confirmed = decision.verification === "VERIFIED"
    const expiresAt = new Date(now.getTime() + (confirmed ? ttlDays : Math.min(ttlDays, 3)) * 86400_000)
    if (existing) {
      if (existing.verification === "OVERRIDDEN" || existing.origin === "MANUAL") return existing.id
      if (existing.verification === "VERIFIED" && !confirmed && someFetchFailed) return existing.id
      await this.db.update(visaRules).set({
        status: decision.facts.status, facts: decision.facts, verification: decision.verification, evidence: decision.evidence, conflicts: decision.conflicts,
        verifiedAt: confirmed ? now : existing.verifiedAt, expiresAt, updatedBy: null, version: existing.version + 1,
      }).where(eq(visaRules.id, existing.id))
      return existing.id
    }
    const [row] = await this.db.insert(visaRules).values({
      ...key, status: decision.facts.status, facts: decision.facts, verification: decision.verification, origin: "RESEARCH", evidence: decision.evidence,
      conflicts: decision.conflicts, verifiedAt: confirmed ? now : null, expiresAt,
    }).returning({ id: visaRules.id })
    return row!.id
  }
}
