# ADR-0017: content system (CMS, blog, guides, glossary, legal pages)

> Numbering note: `0017-hotel-page-content-and-request-preferences.md` was added in parallel and also carries 0017. Code comments saying "ADR-0017" mean this content system unless they are in the hotel page files.

Status: accepted (owner brief of 29 Oct 2026, UniTravel-Content.docx). Deviation from the booklet: it has no CMS; this adds one. No new infrastructure: same API, PostgreSQL, web and console.

## Decision
- **Tables** (migration 0012): `cms_entries` (kind ARTICLE | GUIDE | LEGAL | PAGE, locale en | fa, slug, markdown body, status DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED, SEO fields, related services, `claims_to_verify`), `cms_revisions` (insert-only snapshots), `cms_redirects` (old slugs keep working), `glossary_terms` (structured Persian/English terms).
- **One row per language.** The source document is Persian; no English text is invented. English rows exist only when written and reviewed.
- **Publishing gate.** A DB check refuses PUBLISHED while `claims_to_verify` is non-empty (booklet ch. 35.1 rule 7: UNKNOWN stays marked). Statements such as "24/7 support", "cheapest", "instant issue", instalments and online refund are seeded as claims, so they stay unpublished until the owner clears them.
- **Permissions.** `cms.read`, `cms.write` (admin, owner), `cms.publish` (owner only, privileged). Public reads return only PUBLISHED rows whose `publish_at` has passed. Drafts answer 404.
- **Not CMS content:** live availability, prices, bookings, shipments, loyalty balances, anything personal (they stay in their own modules). Markdown is rendered without raw HTML.
- **Public API:** `GET /v1/cms/entries`, `GET /v1/cms/entries/:kind/:slug`, `GET /v1/cms/glossary`, `GET /v1/cms/sitemap`. Staff API under `/v1/admin/cms/*`, each route declares a permission.
- **Web:** `/blog`, `/blog/[slug]`, `/guides/[slug]`, `/glossary`, `sitemap.xml`, `robots.txt`, Open Graph, canonical and hreflang, Article and Breadcrumb JSON-LD. FAQ JSON-LD only where the FAQ is visible.
- **Classification workflow:** documented in `docs/content/CLASSIFICATION.md` (manual, checklist driven; no AI dependency).
- Existing static pages (FAQ, travel rules, buying guide, terms, privacy) stay as they are until their text is moved to LEGAL/GUIDE entries after owner review.

## Consequences
Owner must review seeded entries before publishing. Legal text (terms, privacy, refund policy) needs counsel before any LEGAL entry is published (UNKNOWN).
