import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"

import { ENTRIES, type RuleKey, type SourceKind, VISA_STATUSES } from "@unitravel/contracts"
import type { RawEvidence } from "@unitravel/domain"

// ADR-0029 points 4, 6 and 7. The model reads only the page texts we fetched and must quote them; the domain gate then
// throws away anything it cannot find in those texts. Nothing comes from the model's own memory.

export const VISA_MODEL = "claude-opus-5-5"

export interface ExtractionPage { url: string; title: string; kind: SourceKind; origin: RawEvidence["origin"]; text: string; updatedAt: string | null }
export interface ExtractionInput {
  key: RuleKey
  /** Plain description of the document, e.g. "UK refugee travel document (1951 Convention), issued by the United Kingdom". */
  documentDescription: string
  destinationName: string
  purposeDescription: string
  pages: ExtractionPage[]
}
export interface ExtractionResult { evidence: RawEvidence[]; inputTokens: number; outputTokens: number; model: string }

export interface VisaExtractor {
  extract(input: ExtractionInput, signal?: AbortSignal): Promise<ExtractionResult>
  /** Further pages on the given official domains, found by a domain-restricted web search. */
  discover(input: { destinationName: string; documentDescription: string; purposeDescription: string; domains: string[] }, signal?: AbortSignal): Promise<string[]>
}

const Claims = z.object({
  status: z.enum(VISA_STATUSES).nullable().describe("The entry requirement this page states for THIS document and purpose, or null if the page does not say."),
  documentAccepted: z.boolean().nullable().describe("false only if the page says this document is not accepted/recognised; true only if it says it is accepted; else null."),
  maxStay: z.string().nullable(),
  entries: z.enum(ENTRIES).nullable(),
  passportValidity: z.string().nullable(),
  blankPages: z.string().nullable(),
  applyOnline: z.boolean().nullable(),
  embassyAppointment: z.boolean().nullable(),
  fee: z.string().nullable().describe("Only an officially published fee, with currency, as written."),
  processingTime: z.string().nullable().describe("Only an officially published processing time."),
  applicationUrl: z.string().nullable().describe("An official application URL that appears in the page text, or null."),
  conditions: z.array(z.string()).describe("Other entry conditions the page states for this document (return ticket, funds, residence permit conditions, etc.)."),
  airsideTransitWithoutVisa: z.boolean().nullable().describe("For transit only: whether staying airside without a visa is allowed for this document, if the page says."),
})

const Output = z.object({
  sources: z.array(z.object({
    url: z.string().describe("Exactly one of the page URLs given to you."),
    claims: Claims,
    quotes: z.array(z.string()).describe("Exact, verbatim sentences copied from this page's text that support every non-null claim. Copy character for character; never paraphrase."),
    coversThisDocument: z.boolean().describe("true only if the page text explicitly applies to holders of this exact document type (named or unmistakably described). A rule for 'British citizens' or 'British passport holders' does not cover a refugee travel document, certificate of travel, stateless document or BN(O) passport."),
    coverageQuotes: z.array(z.string()).describe("Verbatim sentences from this page that show which documents or holders it applies to."),
  })),
  notes: z.string().describe("Short note on what the pages did not answer. Never state rules here."),
})

const SYSTEM = `You extract travel entry requirements from official web pages for a visa eligibility checker used by real travellers.

Rules you must follow:
- Use only the page texts supplied in this message. Do not use your own knowledge of visa rules, even if you are confident.
- Every claim needs verbatim quotes from the same page. Quotes are checked by exact substring match; anything paraphrased is discarded.
- Nationality, the document type, the document's issuing country and the traveller's country of residence are different things. A rule for citizens of a country does not apply to someone who only lives there or who holds a non-passport travel document issued by it.
- GOV.UK foreign travel advice speaks only for full British citizen passports. Never treat it as covering any other document.
- If a page does not clearly answer for this exact document and purpose, set status to null and coversThisDocument to false. Saying "not stated" is correct and useful; guessing is harmful.
- If a page says the document is not accepted or not recognised, set documentAccepted to false.
- Report each page separately, even when pages disagree. Do not reconcile disagreements.
- Status meanings: VISA_FREE (no visa or authorisation needed), ETA (electronic travel authorisation needed, not a visa), EVISA (visa obtained online), VISA_ON_ARRIVAL, VISA_REQUIRED (visa from an embassy/consulate or portal before travel), TRANSIT_VISA (a visa needed just to transit), SPECIAL_PERMISSION (another permit or prior approval), NOT_ACCEPTED (document not recognised for entry), UNCONFIRMED (page discusses it but is unclear).`

/** Real Anthropic API adapter. The key comes from the Developer Panel (write-only, encrypted). */
export class ClaudeVisaExtractor implements VisaExtractor {
  private readonly client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 240_000, maxRetries: 2 })
  }

  async extract(input: ExtractionInput, signal?: AbortSignal): Promise<ExtractionResult> {
    const pages = input.pages.map((p, i) =>
      `<page index="${i + 1}" url="${p.url}" source_type="${p.kind}" title="${p.title.replace(/"/g, "'")}"${p.updatedAt ? ` page_updated="${p.updatedAt}"` : ""}>\n${p.text}\n</page>`).join("\n\n")
    const task = `Traveller's document: ${input.documentDescription}.
Destination being checked: ${input.destinationName} (${input.key.destination}).
Purpose being checked: ${input.purposeDescription}.

For each page below, report what it states for THIS document and purpose, with verbatim quotes.

${pages}`
    const response = await this.client.beta.messages.parse({
      model: VISA_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "high", format: betaZodOutputFormat(Output) },
      messages: [{ role: "user", content: task }],
    }, { signal })
    if (response.stop_reason === "refusal") throw new Error(`MODEL_REFUSED: ${response.stop_details?.category ?? "unknown"}`)
    if (response.stop_reason === "max_tokens") throw new Error("MODEL_OUTPUT_TRUNCATED")
    const parsed = response.parsed_output
    if (!parsed) throw new Error("MODEL_OUTPUT_UNPARSEABLE")
    const byUrl = new Map(input.pages.map((p) => [p.url, p]))
    const evidence: RawEvidence[] = []
    for (const s of parsed.sources) {
      const page = byUrl.get(s.url)
      if (!page) continue // a URL we did not supply is ignored
      const claims = Object.fromEntries(Object.entries(s.claims).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0)))
      if (Object.keys(claims).length === 0) continue
      evidence.push({
        url: page.url, title: page.title.slice(0, 300), kind: page.kind, tier: 0, official: false, origin: page.origin,
        fetchedAt: new Date().toISOString(), sourceUpdatedAt: page.updatedAt, claims, quotes: s.quotes, coversThisDocument: s.coversThisDocument, coverageQuotes: s.coverageQuotes,
      })
    }
    return { evidence, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, model: response.model }
  }

  async discover(input: { destinationName: string; documentDescription: string; purposeDescription: string; domains: string[] }, signal?: AbortSignal): Promise<string[]> {
    if (input.domains.length === 0) return []
    const response = await this.client.messages.create({
      model: VISA_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_domains: input.domains.slice(0, 20) }],
      messages: [{
        role: "user",
        content: `Find official pages on these government sites that state entry or visa requirements for ${input.destinationName} for a traveller holding: ${input.documentDescription}, purpose: ${input.purposeDescription}. Search, then reply with nothing but the most relevant page URLs, one per line (at most 4).`,
      }],
    }, { signal })
    const urls = new Set<string>()
    for (const block of response.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) for (const r of block.content) if (r.type === "web_search_result") urls.add(r.url)
      if (block.type === "text") for (const m of block.text.matchAll(/https:\/\/[^\s)>"']+/g)) urls.add(m[0])
    }
    const allowed = (u: string) => { try { const h = new URL(u).hostname; return input.domains.some((d) => h === d || h.endsWith(`.${d}`)) } catch { return false } }
    return [...urls].filter(allowed).slice(0, 4)
  }
}

/**
 * Local and test only (ADR-0014): answers from the supplied texts with a fixed pattern so e2e tests can exercise the whole
 * pipeline without a key. It never runs where `sandboxAllowed()` is false.
 */
export class SandboxVisaExtractor implements VisaExtractor {
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const evidence: RawEvidence[] = []
    for (const p of input.pages) {
      const m = /SANDBOX-RULE (\S+) STATUS (\S+)/.exec(p.text)
      if (!m || m[1] !== input.key.documentType) continue
      const line = p.text.split("\n").find((l) => l.includes("SANDBOX-RULE")) ?? ""
      evidence.push({
        url: p.url, title: p.title, kind: p.kind, tier: 0, official: false, origin: p.origin, fetchedAt: new Date().toISOString(), sourceUpdatedAt: p.updatedAt,
        claims: { status: m[2] as (typeof VISA_STATUSES)[number] }, quotes: [line], coversThisDocument: true, coverageQuotes: [line],
      })
    }
    return { evidence, inputTokens: 0, outputTokens: 0, model: "sandbox" }
  }
  async discover(): Promise<string[]> { return [] }
}
