import { Inject, Injectable } from "@nestjs/common"
import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm"

import type { CmsEntryBody, CmsEntryCard, CmsEntryPage, CmsEntryView, CmsStaffEntry, CmsStatus, GlossaryTermBody, GlossaryTermView } from "@unitravel/contracts"
import { cmsEntries, cmsRedirects, cmsRevisions, type Db, glossaryTerms, users } from "@unitravel/db"

import { AppError, notFound } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"
import { AuditService } from "../audit/audit.service"

type Entry = typeof cmsEntries.$inferSelect
type Term = typeof glossaryTerms.$inferSelect
type Ctx = { requestId: string }
type Kind = Entry["kind"]
type Locale = "en" | "fa"

const iso = (d: Date) => d.toISOString()
/** Markdown is stored raw and rendered without raw HTML; anything that opens a tag is refused so a stored page cannot carry script. */
const RAW_HTML = /<\s*[a-zA-Z!/?]/
const escapeLike = (s: string) => `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`

/** Allowed moves. DRAFT and IN_REVIEW belong to writers; PUBLISHED and ARCHIVED need `cms.publish`. */
const MOVES: Record<CmsStatus, CmsStatus[]> = {
  DRAFT: ["IN_REVIEW", "ARCHIVED"],
  IN_REVIEW: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
}
const needsPublish = (to: CmsStatus) => to === "PUBLISHED" || to === "ARCHIVED"

const card = (e: Entry): CmsEntryCard => ({
  kind: e.kind, locale: e.locale as Locale, slug: e.slug, title: e.title, summary: e.summary, category: e.category, tags: e.tags,
  featuredImage: e.featuredImage, imageAlt: e.imageAlt, publishedAt: e.publishedAt ? iso(e.publishedAt) : null, updatedAt: iso(e.updatedAt),
})
const termView = (t: Term): GlossaryTermView => ({
  slug: t.slug, termFa: t.termFa, termEn: t.termEn, explanationFa: t.explanationFa, explanationEn: t.explanationEn, category: t.category,
  related: t.related, service: (t.service ?? undefined) as GlossaryTermView["service"], status: t.status,
})

function assertNoHtml(...texts: (string | undefined)[]) {
  texts.forEach((t) => {
    if (t && RAW_HTML.test(t)) throw new AppError("VALIDATION_FAILED", "Raw HTML is not allowed; use Markdown", [{ path: "bodyMd", code: "RAW_HTML" }])
  })
}

/**
 * Content system (ADR-0017). Public reads see only PUBLISHED rows whose publish time has passed; everything else answers 404.
 * Staff edits are optimistic-locked, snapshotted in `cms_revisions` and audited; publishing needs `cms.publish` and an empty
 * `claimsToVerify` list (the database enforces the second rule too).
 */
@Injectable()
export class CmsService {
  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly audit: AuditService) {}

  private live(): SQL {
    return and(eq(cmsEntries.status, "PUBLISHED"), or(isNull(cmsEntries.publishAt), lte(cmsEntries.publishAt, new Date())))!
  }

  // ---- public ----
  async list(q: { kind?: Kind; locale: Locale; category?: string; tag?: string; q?: string; page: number; pageSize: number }): Promise<CmsEntryPage> {
    const where = and(
      this.live(), eq(cmsEntries.locale, q.locale),
      q.kind ? eq(cmsEntries.kind, q.kind) : undefined,
      q.category ? eq(cmsEntries.category, q.category) : undefined,
      q.tag ? sql`${cmsEntries.tags} @> ${JSON.stringify([q.tag])}::jsonb` : undefined,
      q.q ? or(ilike(cmsEntries.title, escapeLike(q.q)), ilike(cmsEntries.summary, escapeLike(q.q))) : undefined,
    )
    const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(cmsEntries).where(where)
    const rows = await this.db.select().from(cmsEntries).where(where).orderBy(desc(cmsEntries.publishedAt), desc(cmsEntries.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize)
    return { items: rows.map(card), total: n, page: q.page, pageSize: q.pageSize }
  }

  async get(kind: Kind, slug: string, locale: Locale): Promise<CmsEntryView> {
    const [e] = await this.db.select().from(cmsEntries).where(and(this.live(), eq(cmsEntries.kind, kind), eq(cmsEntries.locale, locale), eq(cmsEntries.slug, slug)))
    if (!e) throw notFound("Page")
    const other: Locale = locale === "en" ? "fa" : "en"
    const [alt] = await this.db.select({ id: cmsEntries.id }).from(cmsEntries).where(and(this.live(), eq(cmsEntries.kind, kind), eq(cmsEntries.locale, other), eq(cmsEntries.slug, slug)))
    return { ...card(e), bodyMd: e.bodyMd, seoTitle: e.seoTitle, seoDescription: e.seoDescription, relatedServices: e.relatedServices as CmsEntryView["relatedServices"], alternateLocale: alt ? other : null }
  }

  async resolve(kind: Kind, slug: string, locale: Locale): Promise<{ redirectTo: string }> {
    const [r] = await this.db.select().from(cmsRedirects).where(and(eq(cmsRedirects.kind, kind), eq(cmsRedirects.locale, locale), eq(cmsRedirects.fromSlug, slug)))
    if (!r) throw notFound("Page")
    // Follow to the live target only; a redirect to something unpublished is as good as a 404.
    const [t] = await this.db.select({ id: cmsEntries.id }).from(cmsEntries).where(and(this.live(), eq(cmsEntries.kind, kind), eq(cmsEntries.locale, locale), eq(cmsEntries.slug, r.toSlug)))
    if (!t) throw notFound("Page")
    return { redirectTo: r.toSlug }
  }

  async sitemap(): Promise<{ entries: { kind: Kind; locale: Locale; slug: string; updatedAt: string }[] }> {
    const rows = await this.db.select({ kind: cmsEntries.kind, locale: cmsEntries.locale, slug: cmsEntries.slug, updatedAt: cmsEntries.updatedAt }).from(cmsEntries).where(this.live()).orderBy(asc(cmsEntries.kind), asc(cmsEntries.slug)).limit(5000)
    return { entries: rows.map((r) => ({ kind: r.kind, locale: r.locale as Locale, slug: r.slug, updatedAt: iso(r.updatedAt) })) }
  }

  async glossary(q: { q?: string; category?: GlossaryTermBody["category"] }): Promise<GlossaryTermView[]> {
    const where = and(
      eq(glossaryTerms.status, "PUBLISHED"), q.category ? eq(glossaryTerms.category, q.category) : undefined,
      q.q ? or(ilike(glossaryTerms.termFa, escapeLike(q.q)), ilike(glossaryTerms.termEn, escapeLike(q.q)), ilike(glossaryTerms.explanationFa, escapeLike(q.q)), ilike(glossaryTerms.explanationEn, escapeLike(q.q))) : undefined,
    )
    return (await this.db.select().from(glossaryTerms).where(where).orderBy(asc(glossaryTerms.termEn)).limit(500)).map(termView)
  }

  // ---- staff: entries ----
  private async staffView(rows: Entry[]): Promise<CmsStaffEntry[]> {
    const ids = [...new Set(rows.map((r) => r.authorId))]
    const names = ids.length ? new Map((await this.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name])) : new Map<string, string>()
    return rows.map((e) => ({
      id: e.id, kind: e.kind, locale: e.locale as Locale, slug: e.slug, title: e.title, summary: e.summary, bodyMd: e.bodyMd, category: e.category ?? undefined, tags: e.tags,
      featuredImage: e.featuredImage ?? undefined, imageAlt: e.imageAlt ?? undefined, seoTitle: e.seoTitle ?? undefined, seoDescription: e.seoDescription ?? undefined,
      relatedServices: e.relatedServices as CmsStaffEntry["relatedServices"], claimsToVerify: e.claimsToVerify, publishAt: e.publishAt ? iso(e.publishAt) : undefined,
      status: e.status, version: e.version, authorName: names.get(e.authorId) ?? "", publishedAt: e.publishedAt ? iso(e.publishedAt) : null, updatedAt: iso(e.updatedAt),
    }))
  }

  async staffList(q: { kind?: Kind; status?: CmsStatus; locale?: Locale; q?: string; page: number; pageSize: number }) {
    const where = and(q.kind ? eq(cmsEntries.kind, q.kind) : undefined, q.status ? eq(cmsEntries.status, q.status) : undefined, q.locale ? eq(cmsEntries.locale, q.locale) : undefined,
      q.q ? or(ilike(cmsEntries.title, escapeLike(q.q)), ilike(cmsEntries.slug, escapeLike(q.q))) : undefined)
    const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(cmsEntries).where(where)
    const rows = await this.db.select().from(cmsEntries).where(where).orderBy(desc(cmsEntries.updatedAt), desc(cmsEntries.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize)
    return { items: await this.staffView(rows), total: n, page: q.page, pageSize: q.pageSize }
  }

  async staffGet(id: string): Promise<CmsStaffEntry> {
    const [e] = await this.db.select().from(cmsEntries).where(eq(cmsEntries.id, id))
    if (!e) throw notFound("Entry")
    return (await this.staffView([e]))[0]!
  }

  private async snapshot(tx: Parameters<Parameters<UnitOfWork["run"]>[0]>[0], e: Entry, actor: Actor, note?: string) {
    await tx.insert(cmsRevisions).values({ entryId: e.id, version: e.version, status: e.status, title: e.title, snapshot: e, changedBy: actor.userId, note: note ?? null }).onConflictDoNothing()
  }

  async create(body: CmsEntryBody, actor: Actor, ctx: Ctx): Promise<CmsStaffEntry> {
    assertNoHtml(body.bodyMd, body.summary)
    const id = await this.uow.run(async (tx) => {
      const [dup] = await tx.select({ id: cmsEntries.id }).from(cmsEntries).where(and(eq(cmsEntries.kind, body.kind), eq(cmsEntries.locale, body.locale), eq(cmsEntries.slug, body.slug)))
      if (dup) throw new AppError("VALIDATION_FAILED", "This address is already used", [{ path: "slug", code: "DUPLICATE" }])
      const [e] = await tx.insert(cmsEntries).values({ ...body, publishAt: body.publishAt ? new Date(body.publishAt) : null, status: "DRAFT", authorId: actor.userId }).returning()
      await this.snapshot(tx, e!, actor, "created")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cms.entry_created", entityType: "cms_entry", entityId: e!.id, after: { kind: body.kind, locale: body.locale, slug: body.slug }, ip: actor.ip, requestId: ctx.requestId })
      return e!.id
    })
    return this.staffGet(id)
  }

  async update(id: string, patch: Partial<CmsEntryBody> & { version: number }, actor: Actor, ctx: Ctx): Promise<CmsStaffEntry> {
    assertNoHtml(patch.bodyMd, patch.summary)
    await this.uow.run(async (tx) => {
      const [before] = await tx.select().from(cmsEntries).where(eq(cmsEntries.id, id)).for("update")
      if (!before) throw notFound("Entry")
      if (before.version !== patch.version) throw new AppError("VERSION_CONFLICT", "Someone else changed this entry; reload and retry")
      const { version: _v, publishAt, kind, locale, ...rest } = patch
      if ((kind && kind !== before.kind) || (locale && locale !== before.locale)) throw new AppError("VALIDATION_FAILED", "Kind and language cannot change", [{ path: kind ? "kind" : "locale", code: "IMMUTABLE" }])
      const next = rest.slug ?? before.slug
      if (next !== before.slug) {
        const [dup] = await tx.select({ id: cmsEntries.id }).from(cmsEntries).where(and(eq(cmsEntries.kind, before.kind), eq(cmsEntries.locale, before.locale), eq(cmsEntries.slug, next)))
        if (dup) throw new AppError("VALIDATION_FAILED", "This address is already used", [{ path: "slug", code: "DUPLICATE" }])
      }
      // Editing text that was already published sends it back to review, so a live page never changes without a second look.
      const back = before.status === "PUBLISHED" || before.status === "IN_REVIEW"
      const [e] = await tx.update(cmsEntries).set({
        ...rest, ...(publishAt !== undefined ? { publishAt: new Date(publishAt) } : {}), version: before.version + 1, ...(back ? { status: "DRAFT" as const } : {}),
      }).where(eq(cmsEntries.id, id)).returning()
      if (next !== before.slug) {
        // Old address keeps working; a redirect pointing at the new slug from an older one is repointed so chains stay one hop.
        await tx.update(cmsRedirects).set({ toSlug: next }).where(and(eq(cmsRedirects.kind, before.kind), eq(cmsRedirects.locale, before.locale), eq(cmsRedirects.toSlug, before.slug)))
        await tx.delete(cmsRedirects).where(and(eq(cmsRedirects.kind, before.kind), eq(cmsRedirects.locale, before.locale), eq(cmsRedirects.fromSlug, next)))
        await tx.insert(cmsRedirects).values({ kind: before.kind, locale: before.locale, fromSlug: before.slug, toSlug: next }).onConflictDoNothing()
      }
      await this.snapshot(tx, e!, actor)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cms.entry_updated", entityType: "cms_entry", entityId: id, before: { slug: before.slug, title: before.title, status: before.status, version: before.version }, after: { slug: e!.slug, title: e!.title, status: e!.status, version: e!.version }, ip: actor.ip, requestId: ctx.requestId })
    })
    return this.staffGet(id)
  }

  async transition(id: string, to: CmsStatus, version: number, note: string | undefined, actor: Actor, ctx: Ctx): Promise<CmsStaffEntry> {
    const can = actor.permissions.has(needsPublish(to) ? "cms.publish" : "cms.write") || actor.permissions.has("cms.publish")
    if (!can) throw new AppError("FORBIDDEN", needsPublish(to) ? "Publishing and archiving need the publish permission" : "You do not have permission to do this")
    await this.uow.run(async (tx) => {
      const [before] = await tx.select().from(cmsEntries).where(eq(cmsEntries.id, id)).for("update")
      if (!before) throw notFound("Entry")
      if (before.version !== version) throw new AppError("VERSION_CONFLICT", "Someone else changed this entry; reload and retry")
      if (!MOVES[before.status].includes(to)) throw new AppError("INVALID_TRANSITION", `Cannot move from ${before.status} to ${to}`)
      if (to === "PUBLISHED" && before.claimsToVerify.length) {
        throw new AppError("INVALID_TRANSITION", "Statements still need verification before this can be published", before.claimsToVerify.map((c, i) => ({ path: `claimsToVerify.${i}`, code: "UNVERIFIED_CLAIM", message: c })))
      }
      const [e] = await tx.update(cmsEntries).set({
        status: to, version: before.version + 1,
        ...(to === "PUBLISHED" ? { publishedAt: before.publishAt ?? new Date() } : {}),
      }).where(eq(cmsEntries.id, id)).returning()
      await this.snapshot(tx, e!, actor, note)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: `cms.entry_${to.toLowerCase()}`, entityType: "cms_entry", entityId: id, before: { status: before.status }, after: { status: to, note }, ip: actor.ip, requestId: ctx.requestId })
    })
    return this.staffGet(id)
  }

  async revisions(id: string) {
    const [e] = await this.db.select({ id: cmsEntries.id }).from(cmsEntries).where(eq(cmsEntries.id, id))
    if (!e) throw notFound("Entry")
    const rows = await this.db.select().from(cmsRevisions).where(eq(cmsRevisions.entryId, id)).orderBy(desc(cmsRevisions.version), desc(cmsRevisions.createdAt)).limit(200)
    const names = rows.length ? new Map((await this.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.changedBy))]))).map((u) => [u.id, u.name])) : new Map<string, string>()
    return rows.map((r) => ({ id: r.id, version: r.version, status: r.status as CmsStatus, title: r.title, changedBy: names.get(r.changedBy) ?? "", note: r.note, createdAt: iso(r.createdAt) }))
  }

  // ---- staff: glossary ----
  private slugOf(termEn: string) {
    return termEn.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "term"
  }

  async staffGlossary(q: { q?: string; category?: GlossaryTermBody["category"]; status?: CmsStatus }): Promise<GlossaryTermView[]> {
    const where = and(q.category ? eq(glossaryTerms.category, q.category) : undefined, q.status ? eq(glossaryTerms.status, q.status) : undefined,
      q.q ? or(ilike(glossaryTerms.termFa, escapeLike(q.q)), ilike(glossaryTerms.termEn, escapeLike(q.q))) : undefined)
    return (await this.db.select().from(glossaryTerms).where(where).orderBy(asc(glossaryTerms.termEn)).limit(500)).map(termView)
  }

  async createTerm(body: GlossaryTermBody, actor: Actor, ctx: Ctx): Promise<GlossaryTermView> {
    assertNoHtml(body.explanationFa, body.explanationEn)
    return this.uow.run(async (tx) => {
      const base = this.slugOf(body.termEn)
      const taken = new Set((await tx.select({ s: glossaryTerms.slug }).from(glossaryTerms).where(ilike(glossaryTerms.slug, `${base}%`))).map((r) => r.s))
      let slug = base
      for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
      const [t] = await tx.insert(glossaryTerms).values({ ...body, slug, status: "DRAFT" }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cms.term_created", entityType: "glossary_term", entityId: t!.id, after: { slug }, ip: actor.ip, requestId: ctx.requestId })
      return termView(t!)
    })
  }

  private async termBySlug(tx: Pick<Db, "select">, slug: string): Promise<Term> {
    const [t] = await tx.select().from(glossaryTerms).where(eq(glossaryTerms.slug, slug)).for("update")
    if (!t) throw notFound("Term")
    return t
  }

  async updateTerm(slug: string, patch: Partial<GlossaryTermBody>, actor: Actor, ctx: Ctx): Promise<GlossaryTermView> {
    assertNoHtml(patch.explanationFa, patch.explanationEn)
    return this.uow.run(async (tx) => {
      const before = await this.termBySlug(tx, slug)
      // Published text that changes goes back to draft, like entries.
      const [t] = await tx.update(glossaryTerms).set({ ...patch, ...(before.status === "PUBLISHED" || before.status === "IN_REVIEW" ? { status: "DRAFT" as const } : {}) }).where(eq(glossaryTerms.id, before.id)).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cms.term_updated", entityType: "glossary_term", entityId: before.id, before: termView(before), after: patch, ip: actor.ip, requestId: ctx.requestId })
      return termView(t!)
    })
  }

  async transitionTerm(slug: string, to: CmsStatus, actor: Actor, ctx: Ctx): Promise<GlossaryTermView> {
    if (!(actor.permissions.has(needsPublish(to) ? "cms.publish" : "cms.write") || actor.permissions.has("cms.publish"))) throw new AppError("FORBIDDEN", needsPublish(to) ? "Publishing and archiving need the publish permission" : "You do not have permission to do this")
    return this.uow.run(async (tx) => {
      const before = await this.termBySlug(tx, slug)
      if (!MOVES[before.status].includes(to)) throw new AppError("INVALID_TRANSITION", `Cannot move from ${before.status} to ${to}`)
      const [t] = await tx.update(glossaryTerms).set({ status: to }).where(eq(glossaryTerms.id, before.id)).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: `cms.term_${to.toLowerCase()}`, entityType: "glossary_term", entityId: before.id, before: { status: before.status }, after: { status: to }, ip: actor.ip, requestId: ctx.requestId })
      return termView(t!)
    })
  }
}
