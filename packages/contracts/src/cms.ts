import { z } from "zod"

import { IsoDateTime, Uuid } from "./common"

// ADR-0017: content system. Static, non-personal content (articles, guides, glossary, legal and info pages) managed by
// staff. Live availability, prices, bookings and anything personal never live here (booklet ch. 35.1 rule 2/3).

export const CmsKind = z.enum(["ARTICLE", "GUIDE", "LEGAL", "PAGE"])
export type CmsKind = z.infer<typeof CmsKind>
export const CmsStatus = z.enum(["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"])
export type CmsStatus = z.infer<typeof CmsStatus>
export const CmsLocale = z.enum(["en", "fa"])
export const CmsSlug = z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
/** Services an entry links to (service page CTA and related-content block). Keys match the site menu. */
export const CmsService = z.enum(["flights", "hotels", "trains", "buses", "stays", "visa", "tours", "cip", "cargo", "insurance", "track", "support", "club"])

export const CmsEntryBody = z.object({
  kind: CmsKind,
  locale: CmsLocale,
  slug: CmsSlug,
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().max(400).default(""),
  /** Markdown subset: headings, paragraphs, lists, tables, bold/italic, links. Rendered without raw HTML. */
  bodyMd: z.string().max(120_000),
  category: z.string().trim().max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  featuredImage: z.string().max(300).optional(),
  imageAlt: z.string().max(200).optional(),
  seoTitle: z.string().trim().max(70).optional(),
  seoDescription: z.string().trim().max(170).optional(),
  relatedServices: z.array(CmsService).max(6).default([]),
  /** Statements in the text that need a business or legal check before publishing; publishing is refused while any remain. */
  claimsToVerify: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  publishAt: IsoDateTime.optional(),
})
export type CmsEntryBody = z.infer<typeof CmsEntryBody>

export const CmsEntryPatch = CmsEntryBody.partial().extend({ version: z.number().int().positive() })
export const CmsTransitionBody = z.object({ to: CmsStatus, version: z.number().int().positive(), note: z.string().trim().max(300).optional() })

export const CmsEntryCard = z.object({
  kind: CmsKind, locale: CmsLocale, slug: z.string(), title: z.string(), summary: z.string(), category: z.string().nullable(),
  tags: z.array(z.string()), featuredImage: z.string().nullable(), imageAlt: z.string().nullable(), publishedAt: IsoDateTime.nullable(), updatedAt: IsoDateTime,
})
export type CmsEntryCard = z.infer<typeof CmsEntryCard>
export const CmsEntryView = CmsEntryCard.extend({
  bodyMd: z.string(), seoTitle: z.string().nullable(), seoDescription: z.string().nullable(), relatedServices: z.array(CmsService),
  /** Same slug in the other locale, when published. */
  alternateLocale: CmsLocale.nullable(),
})
export type CmsEntryView = z.infer<typeof CmsEntryView>
export const CmsEntryPage = z.object({ items: z.array(CmsEntryCard), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() })
export type CmsEntryPage = z.infer<typeof CmsEntryPage>
export const CmsListQuery = z.object({
  kind: CmsKind.optional(), locale: CmsLocale.default("en"), category: z.string().max(40).optional(), tag: z.string().max(30).optional(),
  q: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(12),
})

/** Staff view: every status, claims, review trail. */
export const CmsStaffEntry = CmsEntryBody.extend({
  id: Uuid, status: CmsStatus, version: z.number().int(), authorName: z.string(), publishedAt: IsoDateTime.nullable(), updatedAt: IsoDateTime,
})
export type CmsStaffEntry = z.infer<typeof CmsStaffEntry>
export const CmsRevisionView = z.object({ id: Uuid, version: z.number().int(), status: CmsStatus, title: z.string(), changedBy: z.string(), note: z.string().nullable(), createdAt: IsoDateTime })
export const CmsStaffListQuery = z.object({
  kind: CmsKind.optional(), status: CmsStatus.optional(), locale: CmsLocale.optional(), q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

// Glossary: structured terms, Persian and English side by side (source: UniTravel-Content.docx sections 4, 5, 7-9).
export const GlossaryCategory = z.enum(["FLIGHT", "BAGGAGE", "CLASS", "HOTEL", "ROOM", "MEAL"])
export const GlossaryTermBody = z.object({
  termFa: z.string().trim().min(1).max(120),
  termEn: z.string().trim().min(1).max(120),
  explanationFa: z.string().trim().min(1).max(1500),
  explanationEn: z.string().trim().max(1500).default(""),
  category: GlossaryCategory,
  related: z.array(z.string().trim().max(120)).max(10).default([]),
  service: CmsService.optional(),
})
export type GlossaryTermBody = z.infer<typeof GlossaryTermBody>
export const GlossaryTermView = GlossaryTermBody.extend({ slug: z.string(), status: CmsStatus })
export type GlossaryTermView = z.infer<typeof GlossaryTermView>
export const GlossaryQuery = z.object({ q: z.string().trim().max(80).optional(), category: GlossaryCategory.optional() })
