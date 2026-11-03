import {
  type Conflict, EMPTY_FACTS, type Evidence, OFFICIAL_TIER_MAX, type RuleKey, type RulePurpose, SOURCE_TIER, type VerificationState, type VisaColour, type VisaFacts,
  type VisaStatus,
} from "@unitravel/contracts"

// ADR-0033 safety gate. Pure functions, no framework imports. The one rule that matters most: nothing becomes a confirmed
// answer unless an official source, quoted verbatim, speaks for the exact travel document. Everything else is UNCONFIRMED.

/** The only document type GOV.UK foreign travel advice speaks for (OBSERVED 2 Nov 2026 on every entry-requirements page). */
export const GOVUK_COVERS = "GB_CITIZEN_PASSPORT"

// ---------------- quotes ----------------

/** Lower case, unify quotes and dashes, collapse whitespace: page text and model quotes differ in these and nothing else. */
export function normaliseText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** A quote counts only if it appears in the fetched text. Very short quotes prove nothing and are rejected. */
export function quoteFound(quote: string, pageText: string): boolean {
  const q = normaliseText(quote).replace(/^[."'\s]+|[."'\s]+$/g, "")
  if (q.length < 12) return false
  return normaliseText(pageText).includes(q)
}

export interface RawEvidence extends Omit<Evidence, "quotes" | "covers"> {
  quotes: string[]
  /** Quote showing the text applies to this document (or its holders); required for the document to be covered. */
  coverageQuotes: string[]
  coversThisDocument: boolean
}

/**
 * Keeps evidence whose every quote is found in its own page text, and sets `covers` only when the coverage quote is found too.
 * Returns how many items were dropped so the run can record it.
 */
export function verifyEvidence(key: RuleKey, raw: RawEvidence[], pageTextByUrl: ReadonlyMap<string, string>): { kept: Evidence[]; dropped: number } {
  const kept: Evidence[] = []
  let dropped = 0
  for (const r of raw) {
    const text = pageTextByUrl.get(r.url)
    const quotes = r.quotes.filter((q) => q.trim().length > 0)
    if (!text || quotes.length === 0 || !quotes.every((q) => quoteFound(q, text))) { dropped++; continue }
    const coverageProven = r.coversThisDocument && r.coverageQuotes.length > 0 && r.coverageQuotes.every((q) => quoteFound(q, text))
    let covers = coverageProven ? [key.documentType] : []
    // GOV.UK speaks for full British citizen passports only, whatever the model says.
    if (r.kind === "GOVUK_FTA") covers = covers.filter((c) => c === GOVUK_COVERS)
    const tier = SOURCE_TIER[r.kind]
    const { coverageQuotes, coversThisDocument, ...rest } = r
    void coversThisDocument
    kept.push({ ...rest, tier, official: tier <= OFFICIAL_TIER_MAX, covers, quotes: [...new Set([...quotes, ...(coverageProven ? coverageQuotes : [])])].slice(0, 12) })
  }
  return { kept, dropped }
}

// ---------------- decision ----------------

/** Most restrictive first. Choosing the more restrictive of two compatible answers is the safe direction. */
export const RESTRICTIVENESS: readonly VisaStatus[] = [
  "NOT_ACCEPTED", "SPECIAL_PERMISSION", "VISA_REQUIRED", "TRANSIT_VISA", "EVISA", "VISA_ON_ARRIVAL", "ETA", "VISA_FREE", "UNCONFIRMED",
]
const rank = (s: VisaStatus) => RESTRICTIVENESS.indexOf(s)

/**
 * Pairs that are two descriptions of the same requirement rather than a contradiction: a visa that is applied for online,
 * an ETA on top of visa-free entry, an eVisa that is also issued on arrival.
 */
const COMPATIBLE: ReadonlyArray<readonly [VisaStatus, VisaStatus]> = [
  ["VISA_REQUIRED", "EVISA"], ["VISA_FREE", "ETA"], ["EVISA", "VISA_ON_ARRIVAL"],
]
const compatible = (a: VisaStatus, b: VisaStatus) => a === b || COMPATIBLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

/** Evidence allowed to decide the status of `key`: official, quoted, and explicitly about this document. */
export function decidingEvidence(key: RuleKey, evidence: readonly Evidence[]): Evidence[] {
  return evidence.filter((e) =>
    e.official && e.tier <= OFFICIAL_TIER_MAX && e.covers.includes(key.documentType) &&
    (e.kind !== "GOVUK_FTA" || key.documentType === GOVUK_COVERS) &&
    (statusClaim(e) ?? "UNCONFIRMED") !== "UNCONFIRMED")
}

/** A source that says the document is not accepted claims NOT_ACCEPTED whatever status it also states. */
function statusClaim(e: Evidence): VisaStatus | undefined {
  if (e.claims.documentAccepted === false) return "NOT_ACCEPTED"
  return e.claims.status
}

const FACT_FIELDS = ["maxStay", "entries", "passportValidity", "blankPages", "applyOnline", "embassyAppointment", "fee", "processingTime", "applicationUrl", "airsideTransitWithoutVisa"] as const

const same = (a: unknown, b: unknown) => (typeof a === "string" && typeof b === "string" ? normaliseText(a) === normaliseText(b) : a === b)
const newestFirst = (a: Evidence, b: Evidence) => a.tier - b.tier || (b.sourceUpdatedAt ?? b.fetchedAt).localeCompare(a.sourceUpdatedAt ?? a.fetchedAt)

export interface Decision { facts: VisaFacts; verification: VerificationState; conflicts: Conflict[] }

/**
 * Turns verified evidence into a rule. No deciding evidence → UNCONFIRMED. Deciding sources that contradict each other →
 * CONFLICT with status UNCONFIRMED until staff decide. Compatible answers → the most restrictive one. Detail fields come only
 * from official sources that cover the document, best tier and newest first; disagreements are listed, never averaged.
 */
export function decideVisa(key: RuleKey, evidence: readonly Evidence[]): Decision {
  const deciding = decidingEvidence(key, evidence).sort(newestFirst)
  if (deciding.length === 0) return { facts: { ...EMPTY_FACTS }, verification: "UNVERIFIED", conflicts: [] }

  const statuses = [...new Set(deciding.map((e) => statusClaim(e)!))]
  const contradictory = statuses.some((a) => statuses.some((b) => !compatible(a, b)))
  const conflicts: Conflict[] = []
  if (statuses.length > 1) conflicts.push({ field: "status", values: deciding.map((e) => ({ url: e.url, value: statusClaim(e) })) })
  if (contradictory) return { facts: { ...EMPTY_FACTS }, verification: "CONFLICT", conflicts }

  const status = statuses.sort((a, b) => rank(a) - rank(b))[0]!
  const facts: VisaFacts = { ...EMPTY_FACTS, status }
  facts.documentAccepted = status === "NOT_ACCEPTED" ? false : deciding.some((e) => e.claims.documentAccepted === true) ? true : null

  const covering = evidence.filter((e) => e.official && e.covers.includes(key.documentType) && (e.kind !== "GOVUK_FTA" || key.documentType === GOVUK_COVERS)).sort(newestFirst)
  for (const f of FACT_FIELDS) {
    const offered = covering.filter((e) => e.claims[f] !== undefined && e.claims[f] !== null)
    if (offered.length === 0) continue
    ;(facts as Record<string, unknown>)[f] = offered[0]!.claims[f]
    if (offered.some((e) => !same(e.claims[f], offered[0]!.claims[f]))) conflicts.push({ field: f, values: offered.map((e) => ({ url: e.url, value: e.claims[f] })) })
  }
  facts.conditions = [...new Set(covering.flatMap((e) => e.claims.conditions ?? []))].slice(0, 20)
  return { facts, verification: "VERIFIED", conflicts }
}

// ---------------- staff changes ----------------

export type OverrideCheck = { ok: true } | { ok: false; reason: "REASON_REQUIRED" | "OFFICIAL_URL_REQUIRED" | "STATUS_REQUIRED" }

/** A person may set any answer, but only with a reason and an official source to point to (both audited). */
export function checkOverride(input: { reason?: string | null; officialUrls?: readonly string[] | null; status?: VisaStatus | null }): OverrideCheck {
  if (!input.reason || input.reason.trim().length < 5) return { ok: false, reason: "REASON_REQUIRED" }
  if (!input.officialUrls || input.officialUrls.length === 0) return { ok: false, reason: "OFFICIAL_URL_REQUIRED" }
  if (!input.status) return { ok: false, reason: "STATUS_REQUIRED" }
  return { ok: true }
}

// ---------------- what the customer sees ----------------

export const COLOUR: Record<VisaStatus, VisaColour> = {
  VISA_FREE: "GREEN", EVISA: "BLUE", ETA: "BLUE", VISA_ON_ARRIVAL: "ORANGE", VISA_REQUIRED: "ORANGE", TRANSIT_VISA: "ORANGE",
  SPECIAL_PERMISSION: "ORANGE", NOT_ACCEPTED: "RED", UNCONFIRMED: "GREY",
}
const COLOUR_ORDER: readonly VisaColour[] = ["RED", "GREY", "ORANGE", "BLUE", "GREEN"]
/** The trip banner shows the worst leg. Grey outranks orange: an unknown is not better than a known requirement. */
export const worstColour = (cs: readonly VisaColour[]): VisaColour => [...cs].sort((a, b) => COLOUR_ORDER.indexOf(a) - COLOUR_ORDER.indexOf(b))[0] ?? "GREY"

/** Only VERIFIED and OVERRIDDEN rows show their facts. A stale row still shows them, labelled with its age. */
export function customerFacts(rule: { facts: VisaFacts; verification: VerificationState } | null): VisaFacts {
  if (!rule || (rule.verification !== "VERIFIED" && rule.verification !== "OVERRIDDEN")) return { ...EMPTY_FACTS }
  return rule.facts
}

export const isStale = (expiresAt: Date | null, now: Date) => !expiresAt || expiresAt.getTime() <= now.getTime()

// ---------------- keys ----------------

export interface CheckDocument { documentType: string; issuingCountry: string; category: string }

/** Rules are keyed by document type and issuer; residence and nationality never enter the key (ADR-0033 point 1). */
export function ruleKeyFor(doc: CheckDocument, country: string, purpose: RulePurpose): RuleKey {
  return { destination: country, documentType: doc.documentType, issuingCountry: doc.issuingCountry, purpose }
}

/** Airside transit uses the transit rule; leaving the transit zone or changing airports means entering the country. */
export const transitRulePurpose = (mode: "AIRSIDE" | "LEAVE_TRANSIT_ZONE" | "CHANGE_AIRPORT"): RulePurpose => (mode === "AIRSIDE" ? "TRANSIT" : "VISIT")

export const ruleKeyString = (k: RuleKey) => `${k.destination}:${k.documentType}:${k.issuingCountry}:${k.purpose}`
