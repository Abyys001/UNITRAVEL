import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import {
  CountryCode, DocumentTypeCode, ResearchRequestBody, ResearchRunPage, ResearchRunQuery, StaffDocumentTypeView, TravelDocumentTypeBody, TravelDocumentTypePatch,
  TravelDocumentTypeView, TrustedSourceBody, TrustedSourcePatch, TrustedSourceView, VisaAuditPage, VisaCheckBody, VisaCheckView, VisaOverview, VisaRuleCreate,
  VisaRulePage, VisaRulePatch, VisaRuleQuery, VisaRuleView,
} from "@unitravel/contracts"

import { AppError } from "../../core/errors"
import { type Actor, Ctx, CurrentActor, DevSurface, OptionalActor, Public, RateLimit, type RequestContext, RequirePermission, StaffOnly, StepUp } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { ConfigService } from "../config/config.service"
import { VisaService } from "./visa.service"

const AuditQuery = z.object({ cursor: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
const SourceQuery = z.object({ country: CountryCode.optional() })
const CredentialBody = z.object({ apiKey: z.string().trim().min(20).max(400).regex(/^sk-ant-/, "An Anthropic API key starts with sk-ant-") })

/**
 * Public checker (ADR-0029). Information only, never a guarantee of entry. Behind the same flag as the visa service. A fresh
 * verification needs sign-in (checked in the service) and is rate-limited per user and rule key.
 */
@ApiTags("visa")
@Controller("v1/visa")
export class PublicVisaController {
  constructor(private readonly visa: VisaService, private readonly config: ConfigService) {}

  private gate() {
    if (!this.config.flag("services.visa.enabled")) throw new AppError("FEATURE_DISABLED")
  }

  @Get("document-types")
  @Public()
  @RateLimit({ name: "visa-read", limit: 240, windowSeconds: 60, key: "ip" })
  @ApiZodResponse(200, TravelDocumentTypeView.array())
  documentTypes() {
    this.gate()
    return this.visa.documentTypes()
  }

  @Post("checks")
  @Public()
  @HttpCode(201)
  @RateLimit({ name: "visa-check", limit: 20, windowSeconds: 600, key: "user_or_ip" })
  @ApiZodBody(VisaCheckBody)
  @ApiZodResponse(201, VisaCheckView)
  check(@Body(zbody(VisaCheckBody)) body: VisaCheckBody, @OptionalActor() actor: Actor | undefined) {
    this.gate()
    return this.visa.createCheck(body, actor)
  }

  /** Polled by the page while research runs. The id is a random UUID held for an hour; nothing personal is stored. */
  @Get("checks/:id")
  @Public()
  @RateLimit({ name: "visa-read", limit: 240, windowSeconds: 60, key: "ip" })
  @ApiZodResponse(200, VisaCheckView)
  getCheck(@Param("id", zbody(z.uuid())) id: string) {
    this.gate()
    return this.visa.getCheck(id)
  }
}

@ApiTags("admin-visa")
@Controller("v1/admin/visa")
@StaffOnly()
export class AdminVisaController {
  constructor(private readonly visa: VisaService) {}

  @Get("overview")
  @RequirePermission("visa.read")
  @ApiZodResponse(200, VisaOverview)
  overview() {
    return this.visa.overview()
  }

  @Get("rules")
  @RequirePermission("visa.read")
  @ApiZodResponse(200, VisaRulePage)
  rules(@Query(zbody(VisaRuleQuery)) q: VisaRuleQuery) {
    return this.visa.listRules(q)
  }

  @Get("rules/:id")
  @RequirePermission("visa.read")
  @ApiZodResponse(200, VisaRuleView)
  rule(@Param("id", zbody(z.uuid())) id: string) {
    return this.visa.getRule(id)
  }

  @Post("rules")
  @RequirePermission("visa.write")
  @HttpCode(201)
  @ApiZodBody(VisaRuleCreate)
  @ApiZodResponse(201, VisaRuleView)
  createRule(@Body(zbody(VisaRuleCreate)) body: VisaRuleCreate, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.visa.createRule(body, actor, ctx.id)
  }

  /** Verify, override (reason + official URL), withdraw, or change the expiry. Optimistic `version`; every change audited. */
  @Patch("rules/:id")
  @RequirePermission("visa.write")
  @ApiZodBody(VisaRulePatch)
  @ApiZodResponse(200, VisaRuleView)
  patchRule(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(VisaRulePatch)) body: VisaRulePatch, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.visa.patchRule(id, body, actor, ctx.id)
  }

  @Post("research")
  @RequirePermission("visa.write")
  @HttpCode(202)
  @RateLimit({ name: "visa-staff-research", limit: 60, windowSeconds: 600, key: "user" })
  @ApiZodBody(ResearchRequestBody)
  research(@Body(zbody(ResearchRequestBody)) body: z.infer<typeof ResearchRequestBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.visa.requestResearch(body, actor, ctx.id)
  }

  @Get("runs")
  @RequirePermission("visa.read")
  @ApiZodResponse(200, ResearchRunPage)
  runs(@Query(zbody(ResearchRunQuery)) q: z.infer<typeof ResearchRunQuery>) {
    return this.visa.listRuns(q)
  }

  @Get("sources")
  @RequirePermission("visa.read")
  @ApiZodResponse(200, TrustedSourceView.array())
  sources(@Query(zbody(SourceQuery)) q: z.infer<typeof SourceQuery>) {
    return this.visa.listSources(q.country)
  }

  @Post("sources")
  @RequirePermission("visa.write")
  @HttpCode(201)
  @ApiZodBody(TrustedSourceBody)
  @ApiZodResponse(201, TrustedSourceView)
  createSource(@Body(zbody(TrustedSourceBody)) body: TrustedSourceBody, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.visa.createSource(body, actor, ctx.id)
  }

  @Patch("sources/:id")
  @RequirePermission("visa.write")
  @ApiZodBody(TrustedSourcePatch)
  @ApiZodResponse(200, TrustedSourceView)
  patchSource(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(TrustedSourcePatch)) body: TrustedSourcePatch, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.visa.patchSource(id, body, actor, ctx.id)
  }

  @Get("document-types")
  @RequirePermission("visa.read")
  @ApiZodResponse(200, StaffDocumentTypeView.array())
  documentTypes() {
    return this.visa.staffDocumentTypes()
  }

  @Post("document-types")
  @RequirePermission("visa.write")
  @HttpCode(201)
  @ApiZodBody(TravelDocumentTypeBody)
  @ApiZodResponse(201, StaffDocumentTypeView)
  createDocumentType(@Body(zbody(TravelDocumentTypeBody)) body: TravelDocumentTypeBody, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.visa.createDocumentType(body, actor, ctx.id)
  }

  @Patch("document-types/:code")
  @RequirePermission("visa.write")
  @ApiZodBody(TravelDocumentTypePatch)
  @ApiZodResponse(200, StaffDocumentTypeView)
  patchDocumentType(@Param("code", zbody(DocumentTypeCode)) code: string, @Body(zbody(TravelDocumentTypePatch)) body: TravelDocumentTypePatch, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.visa.patchDocumentType(code, body, actor, ctx.id)
  }

  @Get("audit")
  @RequirePermission("visa.read")
  @ApiZodResponse(200, VisaAuditPage)
  audit(@Query(zbody(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    return this.visa.auditTrail(q)
  }
}

/** Developer Panel: the research step's Anthropic key, write-only (rule 6), like flight-provider credentials. */
@ApiTags("dev")
@Controller("v1/dev/visa-research")
@DevSurface()
@StaffOnly()
export class DevVisaResearchController {
  constructor(private readonly visa: VisaService) {}

  @Get()
  @RequirePermission("provider.config.read")
  status() {
    return this.visa.credentialStatus()
  }

  @Put("credentials")
  @RequirePermission("provider.config.write")
  @StepUp()
  credentials(@Body(zbody(CredentialBody)) body: z.infer<typeof CredentialBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.visa.setCredential(body.apiKey, actor, ctx.id)
  }

  @Delete("credentials")
  @RequirePermission("provider.config.write")
  @StepUp()
  remove(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.visa.clearCredential(actor, ctx.id)
  }
}
