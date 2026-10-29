import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import {
  CmsEntryBody, CmsEntryPage, CmsEntryPatch, CmsEntryView, CmsKind, CmsListQuery, CmsLocale, CmsRevisionView, CmsStaffEntry, CmsStaffListQuery, CmsStatus, CmsTransitionBody,
  GlossaryCategory, GlossaryQuery, GlossaryTermBody, GlossaryTermView,
} from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, Public, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { CmsService } from "./cms.service"

const Page = z.object({ items: CmsStaffEntry.array(), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() })
const Sitemap = z.object({ entries: z.array(z.object({ kind: CmsKind, locale: CmsLocale, slug: z.string(), updatedAt: z.string() })) })
const Redirect = z.object({ redirectTo: z.string() })
const LocaleQuery = z.object({ locale: CmsLocale.default("en") })
const TermStaffQuery = z.object({ q: z.string().trim().max(80).optional(), category: GlossaryCategory.optional(), status: CmsStatus.optional() })
const TermTransition = z.object({ to: CmsStatus })
const TermPatch = GlossaryTermBody.partial()
const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80)

/** Public content reads (ADR-0017): published and due only; a draft, archived or scheduled page answers 404. */
@ApiTags("content")
@Controller("v1/cms")
export class PublicCmsController {
  constructor(private readonly cms: CmsService) {}

  @Get("entries")
  @Public()
  @Header("Cache-Control", "public, max-age=60")
  @ApiZodResponse(200, CmsEntryPage)
  list(@Query(zbody(CmsListQuery)) q: z.infer<typeof CmsListQuery>) {
    return this.cms.list(q)
  }

  @Get("entries/:kind/:slug")
  @Public()
  @Header("Cache-Control", "public, max-age=60")
  @ApiZodResponse(200, CmsEntryView)
  get(@Param("kind", zbody(CmsKind)) kind: z.infer<typeof CmsKind>, @Param("slug", zbody(Slug)) slug: string, @Query(zbody(LocaleQuery)) q: z.infer<typeof LocaleQuery>) {
    return this.cms.get(kind, slug, q.locale)
  }

  @Get("resolve/:kind/:slug")
  @Public()
  @Header("Cache-Control", "public, max-age=60")
  @ApiZodResponse(200, Redirect)
  resolve(@Param("kind", zbody(CmsKind)) kind: z.infer<typeof CmsKind>, @Param("slug", zbody(Slug)) slug: string, @Query(zbody(LocaleQuery)) q: z.infer<typeof LocaleQuery>) {
    return this.cms.resolve(kind, slug, q.locale)
  }

  @Get("glossary")
  @Public()
  @Header("Cache-Control", "public, max-age=60")
  @ApiZodResponse(200, GlossaryTermView.array())
  glossary(@Query(zbody(GlossaryQuery)) q: z.infer<typeof GlossaryQuery>) {
    return this.cms.glossary(q)
  }

  @Get("sitemap")
  @Public()
  @Header("Cache-Control", "public, max-age=300")
  @ApiZodResponse(200, Sitemap)
  sitemap() {
    return this.cms.sitemap()
  }
}

/**
 * Admin Panel content (ADR-0017). Reading needs `cms.read`, editing `cms.write`. A status change is declared with both
 * `cms.write` and `cms.publish`; the service then requires `cms.publish` for PUBLISHED and ARCHIVED.
 */
@ApiTags("admin-content")
@Controller("v1/admin/cms")
@StaffOnly()
export class AdminCmsController {
  constructor(private readonly cms: CmsService) {}

  @Get("entries")
  @RequirePermission("cms.read")
  @ApiZodResponse(200, Page)
  list(@Query(zbody(CmsStaffListQuery)) q: z.infer<typeof CmsStaffListQuery>) {
    return this.cms.staffList(q)
  }

  @Get("entries/:id")
  @RequirePermission("cms.read")
  @ApiZodResponse(200, CmsStaffEntry)
  get(@Param("id", zbody(z.uuid())) id: string) {
    return this.cms.staffGet(id)
  }

  @Post("entries")
  @RequirePermission("cms.write")
  @ApiZodBody(CmsEntryBody)
  @ApiZodResponse(201, CmsStaffEntry)
  create(@Body(zbody(CmsEntryBody)) body: CmsEntryBody, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.cms.create(body, actor, { requestId: ctx.id })
  }

  @Patch("entries/:id")
  @RequirePermission("cms.write")
  @ApiZodBody(CmsEntryPatch)
  @ApiZodResponse(200, CmsStaffEntry)
  update(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(CmsEntryPatch)) body: z.infer<typeof CmsEntryPatch>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.cms.update(id, body, actor, { requestId: ctx.id })
  }

  @Post("entries/:id/transition")
  @HttpCode(200)
  @RequirePermission("cms.write", "cms.publish")
  @ApiZodBody(CmsTransitionBody)
  @ApiZodResponse(200, CmsStaffEntry)
  transition(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(CmsTransitionBody)) body: z.infer<typeof CmsTransitionBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.cms.transition(id, body.to, body.version, body.note, actor, { requestId: ctx.id })
  }

  @Get("entries/:id/revisions")
  @RequirePermission("cms.read")
  @ApiZodResponse(200, CmsRevisionView.array())
  revisions(@Param("id", zbody(z.uuid())) id: string) {
    return this.cms.revisions(id)
  }

  @Get("glossary")
  @RequirePermission("cms.read")
  @ApiZodResponse(200, GlossaryTermView.array())
  glossary(@Query(zbody(TermStaffQuery)) q: z.infer<typeof TermStaffQuery>) {
    return this.cms.staffGlossary(q)
  }

  @Post("glossary")
  @RequirePermission("cms.write")
  @ApiZodBody(GlossaryTermBody)
  @ApiZodResponse(201, GlossaryTermView)
  createTerm(@Body(zbody(GlossaryTermBody)) body: GlossaryTermBody, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.cms.createTerm(body, actor, { requestId: ctx.id })
  }

  @Patch("glossary/:slug")
  @RequirePermission("cms.write")
  @ApiZodBody(TermPatch)
  @ApiZodResponse(200, GlossaryTermView)
  updateTerm(@Param("slug", zbody(Slug)) slug: string, @Body(zbody(TermPatch)) body: z.infer<typeof TermPatch>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.cms.updateTerm(slug, body, actor, { requestId: ctx.id })
  }

  @Post("glossary/:slug/transition")
  @HttpCode(200)
  @RequirePermission("cms.write", "cms.publish")
  @ApiZodBody(TermTransition)
  @ApiZodResponse(200, GlossaryTermView)
  transitionTerm(@Param("slug", zbody(Slug)) slug: string, @Body(zbody(TermTransition)) body: z.infer<typeof TermTransition>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.cms.transitionTerm(slug, body.to, actor, { requestId: ctx.id })
  }
}
