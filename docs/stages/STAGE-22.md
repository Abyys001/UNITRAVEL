# Stage 22 record: visa and travel document checker (2 Nov 2026)

Source: owner brief of 2 Nov 2026 ("Smart Visa & Travel Document Eligibility Checker"), ADR-0029. Not part of the booklet. Extends ADR-0015; the VISA service request is unchanged and still sits on `/visa`.

## Audit of what existed (OBSERVED)
- `/visa` was only a VISA service request form: destination, purpose, date, travellers, linked flight reference. No document type, no issuing country, no rules, no sources.
- Travellers' documents store nationality and issuing country separately (`customers.nationality`, `traveller_documents.issuing_country`, type PASSPORT / NATIONAL_ID). Not changed.
- GOV.UK foreign travel advice content API (`/api/content/foreign-travel-advice/<slug>`) works without a key; every entry-requirements page states it covers full British citizen passports only.
- No LLM or search provider existed in the stack.

## What changed (DOCUMENTED)
- **Contract** `packages/contracts/src/visa.ts`: document types, statuses, colours, facts (every field nullable = UNKNOWN), evidence with verbatim quotes, check request and view, staff views. Permissions `visa.read` (admin, owner, compliance officer) and `visa.write` (admin, owner). Settings `visa.ruleTtlDays` (14), `visa.searchOfficialDomains` (on).
- **Domain gate** `packages/domain/src/visa.ts`: quote verification, "official + quoted + names this document" rule, GOV.UK only for `GB_CITIZEN_PASSPORT`, conflicts → unconfirmed, compatible answers → most restrictive, overrides need reason + official URL, colour mapping, transit purpose (airside vs entering).
- **Database** migration 0020: `travel_document_types` (11 seeded, en/fa), `visa_trusted_sources`, `visa_rules` (CHECK: only VERIFIED/OVERRIDDEN rows can hold a confirming status), `visa_research_runs`, `visa_research_credentials`; permission grants. Clear Valkey `perm:*` after deploy.
- **API** `apps/api/src/modules/visa`: public `GET /v1/visa/document-types`, `POST /v1/visa/checks`, `GET /v1/visa/checks/:id`; admin `/v1/admin/visa/{overview,rules,research,runs,sources,document-types,audit}`; Developer Panel `/v1/dev/visa-research` (write-only Anthropic key, step-up). New queue `visa.research`. Research: GOV.UK content API, trusted sources, official links on the GOV.UK page, optional Claude web search limited to known official domains; robots.txt honoured, 15 s timeout, 2 MB cap, at most 8 pages; one `claude-opus-5-5` structured-output extraction per run; server-side refusal fallback enabled (`fallbacks: "default"`). New dependency `@anthropic-ai/sdk` 1.3.0 (ADR-0029 approved addition).
- **Web** `/visa`: checker (document, issuer, citizenship, residence, permit, destination, up to 4 transits with airside/leave zone/change airport, dates, purpose), polled results with colour per leg, every fact or "Not confirmed", sources with official/supporting labels and quotes, official links, notices, disclaimer, the exact embassy sentence on grey legs, fresh check (sign-in, 10-minute limit with a message), then the original service request form prefilled. en + fa.
- **Console** Admin › Visa checker (overview, requirements, rule detail with override/verify/withdraw/expiry/re-run, conflicts, research runs with fetch logs, trusted sources, document types, audit trail); Developer Panel › Providers card for the Anthropic key. en + fa.
- Audit masking no longer hides `passportValidity` (a rule field, not personal data); every other `passport*` key is still masked.
- DPIA risk R21 added; runbook `docs/runbooks/visa-checker.md`; OpenAPI regenerated.

## Verified (OBSERVED, local stack)
- Domain `visa.spec.ts` 23/23: the brief's ten scenarios (British citizen visa-free and visa-required, refugee travel document, certificate of travel, BN(O), non-British passport holder living in the UK, eVisa, several transits, document not accepted, conflicting official sources) plus three property tests. Domain suite 138/139, the one failure being the known `name-matcher` property (ADR-0013 record).
- API unit 124/124 (adds `page-fetcher.spec.ts`: HTML to text, robots.txt, government hosts, GOV.UK slugs). One earlier run showed one failure that did not repeat on three reruns.
- API e2e `visa.e2e.ts` 12/12 (validation, residence vs citizenship notices, transit purpose, permissions, override rules, research never overwriting an override, withdraw, audit, https-only sources). `matrix.e2e.ts` 23/23 with the new routes.
- Real research run, sandbox extractor (no key locally): UK refugee travel document to Türkiye with an airside UAE transit read GOV.UK and the UAE government pages GOV.UK links to (mofa.gov.ae, gdrfad.gov.ae); `www.mfa.gov.tr` and `london-emb.mfa.gov.tr` answered HTTP 418 to the identified reader and were recorded, not worked around. Both legs: grey, "not confirmed".
- Typecheck clean: contracts, domain, db, api, web, console. i18n 22/22.
- Browser (Playwright against `next dev`): `/en/visa` and `/fa/visa` at 390 px and 1280 px, form and results, no console errors, no horizontal overflow, RTL correct.

## Not verified
- UNKNOWN: real extraction quality. No Anthropic key is set, so no confirmed (green/blue/orange/red) answer has come from research yet; the gate is covered by unit tests and confirmed answers by staff overrides in e2e.
- Not run: console pages in a browser, `next build` for web and console, Playwright suites, visual baselines (the `/visa` page changed; `site-menu.spec.ts` selectors were updated by reading, not by running).
- IATA Timatic: BLOCKED (paid contract). Only listable as a source type.
- Counsel on O6 still owed.
- Not committed.

## Deployed to staging (OBSERVED, 2 Nov 2026 16:54-17:05)
- Backup `/root/backups/unitravel-staging-2026-11-02-1654.dump`; images built one at a time (production `next build` of web and console succeeded with the new routes); migration 0020 applied (11 document types, 5 grants); api, worker, web, console restarted; Valkey `perm:*` cleared.
- `scripts/vps-deploy.sh status` all 200/302; `/en/visa`, `/fa/visa` and admin `/visa` 200; API check via `mobile.unitravels.co.uk/v1/visa/checks` completes with `NOT_CONFIGURED` (no key), runs recorded; Playwright on the live `/en/visa` (BN(O) passport) shows the result and the embassy sentence, no console errors.
- The build stage includes stages 19-21 code, so that work is now on staging too.

## Owner actions
1. Enter an Anthropic API key: Developer Panel › Providers › Visa research (Anthropic).
2. Add official sources for the destinations customers ask about most (Admin › Visa checker › Trusted sources).
3. Review conflicts and unconfirmed rows; override only with an official source.
