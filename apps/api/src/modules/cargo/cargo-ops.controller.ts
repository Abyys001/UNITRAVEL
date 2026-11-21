import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res, StreamableFile } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request, Response } from "express"
import { z } from "zod"

import {
  AGENT_ACTIONS, AgentActionBodies, type AgentAction, AgentBody, AgentCodeSignInBody, AgentSignInCode, CalculateBody, ConsignmentBody, ConsignmentCancelBody, ConsignmentLabelBody, CustomerRateBody, CustomsReviewBody, ShippingDashboardQuery, ManifestQuery, RateCardBody, AgentPhotoBody, AgentUpdateBody, AssignAgentBody, CargoCustomerLookup, CargoDetailsPatch, CargoOpsQuery, GenerateLabelBody, StaffCreateCargoBody, StaffCreateFlightRequestBody, StaffProofBody, TrackingNumber, UnassignAgentBody,
} from "@unitravel/contracts"

import { AppError } from "../../core/errors"
import { type Actor, Ctx, CurrentActor, Idempotent, Public, RateLimit, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { consoleHost, setDeviceCookie, setSessionCookies } from "../identity/cookies"
import { SessionsService } from "../identity/sessions.service"
import { AgentSignInService } from "./agent-sign-in.service"
import { CargoService } from "./cargo.service"
import { PostageService } from "./postage.service"
import { ShippingService } from "./shipping.service"
import { CargoOpsService } from "./cargo-ops.service"
import { AgentsService } from "./agents.service"
import { StaffIntakeService } from "./staff-intake.service"

const ImageBody = z.object({ filename: z.string().trim().min(1).max(200), data: z.string().min(16).max(1_000_000), purpose: z.enum(["PHOTO", "SIGNATURE"]) })
const PageQuery = z.object({ q: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).max(1000).default(1), pageSize: z.coerce.number().int().min(5).max(100).default(25) })

/** ADR-0042 D4: public tracking by tracking number; no sign-in, rate-limited, no personal data. */
@ApiTags("cargo-tracking")
@Controller("v1/public/cargo-tracking")
export class PublicCargoTrackingController {
  constructor(private readonly ops: CargoOpsService) {}

  @Get(":number")
  @Public()
  @RateLimit({ name: "cargo-tracking", limit: 30, windowSeconds: 600, key: "ip" })
  track(@Param("number") number: string, @Query(zbody(z.object({ s: z.string().max(64).optional() }))) q: { s?: string }, @Ctx() ctx: RequestContext) {
    return this.ops.publicTracking(number, q.s, ctx.locale)
  }
}

@ApiTags("admin-cargo-ops")
@Controller("v1/admin/cargo")
@StaffOnly()
export class AdminCargoOpsController {
  constructor(private readonly ops: CargoOpsService, private readonly agents: AgentsService, private readonly intake: StaffIntakeService, private readonly signIn: AgentSignInService, private readonly postage: PostageService, private readonly cargo: CargoService, private readonly shipping: ShippingService) {}

  // ---------------- ADR-0047: manual-courier consignments, customs review, customer rates, dashboard ----------------

  @Get("dashboard")
  @RequirePermission("cargo_request.read.any")
  dashboard(@Query(zbody(ShippingDashboardQuery)) q: z.infer<typeof ShippingDashboardQuery>) {
    return this.shipping.dashboard(q.from, q.to)
  }

  @Get("requests/:ref/consignments")
  @RequirePermission("cargo_request.read.any")
  consignments(@Param("ref") ref: string) {
    return this.shipping.list(ref)
  }

  @Post("requests/:ref/consignments")
  @RequirePermission("cargo_request.transition")
  @HttpCode(201)
  createConsignment(@Param("ref") ref: string, @Body(zbody(ConsignmentBody)) body: ConsignmentBody, @CurrentActor() actor: Actor) {
    return this.shipping.create(ref, body, actor)
  }

  @Put("requests/:ref/consignments/:id")
  @RequirePermission("cargo_request.transition")
  updateConsignment(@Param("ref") ref: string, @Param("id", zbody(z.uuid())) id: string, @Body(zbody(ConsignmentBody.extend({ version: z.number().int().optional() }))) body: ConsignmentBody & { version?: number }, @CurrentActor() actor: Actor) {
    return this.shipping.update(ref, id, body, body.version, actor)
  }

  @Post("requests/:ref/consignments/:id/dispatch")
  @RequirePermission("cargo_request.transition")
  @HttpCode(200)
  dispatchConsignment(@Param("ref") ref: string, @Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.shipping.dispatch(ref, id, actor)
  }

  @Post("requests/:ref/consignments/:id/cancel")
  @RequirePermission("cargo_request.transition")
  @HttpCode(200)
  cancelConsignment(@Param("ref") ref: string, @Param("id", zbody(z.uuid())) id: string, @Body(zbody(ConsignmentCancelBody)) body: z.infer<typeof ConsignmentCancelBody>, @CurrentActor() actor: Actor) {
    return this.shipping.cancel(ref, id, body.reason, actor)
  }

  @Post("requests/:ref/consignments/:id/label")
  @RequirePermission("cargo_request.transition")
  @RateLimit({ name: "consignment-label", limit: 60, windowSeconds: 3600, key: "user" })
  uploadConsignmentLabel(@Param("ref") ref: string, @Param("id", zbody(z.uuid())) id: string, @Body(zbody(ConsignmentLabelBody)) body: z.infer<typeof ConsignmentLabelBody>, @CurrentActor() actor: Actor) {
    return this.shipping.uploadLabel(ref, id, body, actor)
  }

  @Put("requests/:ref/customs-review")
  @RequirePermission("cargo_request.transition")
  saveCustomsReview(@Param("ref") ref: string, @Body(zbody(CustomsReviewBody)) body: CustomsReviewBody, @CurrentActor() actor: Actor) {
    return this.shipping.saveCustoms(ref, body, actor)
  }

  @Get("requests/:ref/invoice/:kind")
  @RequirePermission("cargo_request.read.any")
  async customsInvoice(@Param("ref") ref: string, @Param("kind", zbody(z.enum(["commercial.pdf", "proforma.pdf"]))) kind: "commercial.pdf" | "proforma.pdf", @CurrentActor() actor: Actor) {
    const r = await this.shipping.invoicePdf(ref, kind === "commercial.pdf" ? "commercial" : "proforma", actor)
    return new StreamableFile(r.pdf, { type: "application/pdf", disposition: `inline; filename="${r.filename}"`, length: r.pdf.length })
  }

  @Get("customer-rates")
  @RequirePermission("cargo_request.read.any", "pricing.read.internal")
  customerRates(@Query(zbody(z.object({ customerUserId: z.uuid().optional() }))) q: { customerUserId?: string }) {
    return this.shipping.customerRates(q.customerUserId)
  }

  @Post("customer-rates")
  @RequirePermission("pricing.write")
  @HttpCode(201)
  saveCustomerRate(@Body(zbody(CustomerRateBody)) body: CustomerRateBody, @CurrentActor() actor: Actor) {
    return this.shipping.saveCustomerRate(body, actor)
  }

  @Delete("customer-rates/:id")
  @RequirePermission("pricing.write")
  deleteCustomerRate(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.shipping.deleteCustomerRate(id, actor)
  }

  // ---------------- ADR-0046: postage tools ----------------

  /** Bulk scan: a scanned tracking number → ref, version and the bulk commands the state machine allows now. */
  @Get("scan/:trackingNumber")
  @RequirePermission("cargo_request.transition")
  scan(@Param("trackingNumber", zbody(TrackingNumber)) tn: string, @CurrentActor() actor: Actor) {
    return this.cargo.scanView(tn, actor)
  }

  @Get("agents/:id/manifest")
  @RequirePermission("cargo_agent.manage", "cargo_request.read.any")
  agentManifest(@Param("id", zbody(z.uuid())) id: string, @Query(zbody(ManifestQuery)) q: z.infer<typeof ManifestQuery>) {
    return this.postage.manifestFor(id, q.date)
  }

  @Get("agents/:id/manifest.pdf")
  @RequirePermission("cargo_agent.manage", "cargo_request.read.any")
  async agentManifestPdf(@Param("id", zbody(z.uuid())) id: string, @Query(zbody(ManifestQuery)) q: z.infer<typeof ManifestQuery>) {
    const m = await this.postage.manifestFor(id, q.date)
    const pdf = await this.postage.manifestPdf(m)
    return new StreamableFile(pdf, { type: "application/pdf", disposition: `inline; filename="run-sheet-${m.agent.agentCode}-${m.date}.pdf"`, length: pdf.length })
  }

  @Get("rates")
  @RequirePermission("cargo_request.read.any", "pricing.read.internal")
  rates() {
    return this.postage.lanesWithRates()
  }

  @Put("rates")
  @RequirePermission("pricing.write")
  saveRate(@Body(zbody(RateCardBody)) body: RateCardBody, @CurrentActor() actor: Actor) {
    return this.postage.saveRateCard(body, actor)
  }

  @Delete("rates/:id")
  @RequirePermission("pricing.write")
  deleteRate(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.postage.deleteRateCard(id, actor)
  }

  @Post("calculate")
  @RequirePermission("cargo_request.read.any", "pricing.read.internal")
  @HttpCode(200)
  calculate(@Body(zbody(CalculateBody)) body: CalculateBody) {
    return this.postage.calculate(body)
  }

  @Get("requests/:ref/customs")
  @RequirePermission("cargo_request.read.any")
  customsCheck(@Param("ref") ref: string) {
    return this.postage.customsCheck(ref)
  }

  @Get("requests/:ref/customs.pdf")
  @RequirePermission("cargo_request.read.any")
  async customsPdf(@Param("ref") ref: string, @CurrentActor() actor: Actor) {
    const r = await this.postage.customsPdf(ref, actor)
    return new StreamableFile(r.pdf, { type: "application/pdf", disposition: `inline; filename="${r.filename}"`, length: r.pdf.length })
  }

  /** ADR-0042 D13: exact lookup (email, phone or UT-C reference) of the customer a request is created for. */
  @Get("customers")
  @RequirePermission("cargo_request.create.any")
  @RateLimit({ name: "cargo-customer-lookup", limit: 120, windowSeconds: 3600, key: "user" })
  lookup(@Query(zbody(CargoCustomerLookup)) q: z.infer<typeof CargoCustomerLookup>, @CurrentActor() actor: Actor) {
    return this.intake.lookup(q.q, actor)
  }

  @Post("requests")
  @RequirePermission("cargo_request.create.any")
  @Idempotent()
  @RateLimit({ name: "cargo-staff-create", limit: 120, windowSeconds: 3600, key: "user" })
  create(@Body(zbody(StaffCreateCargoBody)) body: z.infer<typeof StaffCreateCargoBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.intake.create(body, actor, { requestId: ctx.id, locale: ctx.locale })
  }

  @Get("ops/requests")
  @RequirePermission("cargo_request.read.any")
  list(@Query(zbody(CargoOpsQuery)) q: z.infer<typeof CargoOpsQuery>) {
    return this.ops.list(q)
  }

  @Get("ops/stats")
  @RequirePermission("cargo_request.read.any")
  stats() {
    return this.ops.stats()
  }

  @Get("ops/notifications")
  @RequirePermission("cargo_request.read.any")
  notifications(@Query(zbody(PageQuery)) q: z.infer<typeof PageQuery>) {
    return this.ops.notificationHistory(q)
  }

  @Get("requests/:ref/operations")
  @RequirePermission("cargo_request.read.any")
  operations(@Param("ref") ref: string) {
    return this.ops.operations(ref)
  }

  @Post("requests/:ref/tracking-number")
  @RequirePermission("cargo_request.transition")
  @HttpCode(200)
  issue(@Param("ref") ref: string, @CurrentActor() actor: Actor) {
    return this.ops.issueTrackingNumber(ref, actor)
  }

  @Post("requests/:ref/labels")
  @RequirePermission("cargo_request.transition")
  @RateLimit({ name: "cargo-labels", limit: 60, windowSeconds: 600, key: "user" })
  label(@Param("ref") ref: string, @Body(zbody(GenerateLabelBody)) body: z.infer<typeof GenerateLabelBody>, @CurrentActor() actor: Actor) {
    return this.ops.generateLabel(ref, body.format, actor)
  }

  @Patch("requests/:ref/details")
  @RequirePermission("cargo_request.transition")
  details(@Param("ref") ref: string, @Body(zbody(CargoDetailsPatch)) body: z.infer<typeof CargoDetailsPatch>, @CurrentActor() actor: Actor) {
    return this.ops.patchDetails(ref, body, actor)
  }

  @Post("requests/:ref/proofs")
  @RequirePermission("cargo_request.transition")
  proof(@Param("ref") ref: string, @Body(zbody(StaffProofBody)) body: z.infer<typeof StaffProofBody>, @CurrentActor() actor: Actor) {
    return this.ops.addProof(ref, body, actor)
  }

  @Post("requests/:ref/images")
  @RequirePermission("cargo_request.transition")
  @RateLimit({ name: "cargo-images", limit: 120, windowSeconds: 3600, key: "user" })
  image(@Param("ref") ref: string, @Body(zbody(ImageBody)) body: z.infer<typeof ImageBody>, @CurrentActor() actor: Actor) {
    return this.ops.staffImage(ref, body, actor)
  }

  @Post("requests/:ref/assignments")
  @RequirePermission("cargo_request.transition")
  assign(@Param("ref") ref: string, @Body(zbody(AssignAgentBody)) body: z.infer<typeof AssignAgentBody>, @CurrentActor() actor: Actor) {
    return this.agents.assign(ref, body, actor)
  }

  @Post("requests/:ref/assignments/:id/cancel")
  @RequirePermission("cargo_request.transition")
  @HttpCode(200)
  unassign(@Param("ref") ref: string, @Param("id", zbody(z.uuid())) id: string, @Body(zbody(UnassignAgentBody)) body: z.infer<typeof UnassignAgentBody>, @CurrentActor() actor: Actor) {
    return this.agents.unassign(ref, id, body.reason, actor)
  }

  // ---------------- ADR-0043: Agent Management ----------------

  @Get("agents")
  @RequirePermission("cargo_request.read.any", "cargo_agent.manage")
  listAgents() {
    return this.agents.list()
  }

  @Post("agents")
  @RequirePermission("cargo_agent.manage")
  createAgent(@Body(zbody(AgentBody)) body: z.infer<typeof AgentBody>, @CurrentActor() actor: Actor) {
    return this.agents.create(body, actor)
  }

  @Get("agents/:id")
  @RequirePermission("cargo_request.read.any", "cargo_agent.manage")
  agentProfile(@Param("id", zbody(z.uuid())) id: string) {
    return this.agents.profile(id)
  }

  @Patch("agents/:id")
  @RequirePermission("cargo_agent.manage")
  updateAgent(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(AgentUpdateBody)) body: z.infer<typeof AgentUpdateBody>, @CurrentActor() actor: Actor) {
    return this.agents.update(id, body, actor)
  }

  /** ADR-0045: a single-use, 10-minute sign-in QR code for the agent's phone. */
  @Post("agents/:id/sign-in-code")
  @RequirePermission("cargo_agent.manage")
  @RateLimit({ name: "agent-sign-in-code", limit: 60, windowSeconds: 3600, key: "user" })
  @HttpCode(200)
  @ApiZodResponse(200, AgentSignInCode)
  agentSignInCode(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.signIn.issue(id, actor, { requestId: ctx.id })
  }

  @Post("agents/:id/photo")
  @RequirePermission("cargo_agent.manage")
  @RateLimit({ name: "agent-photo", limit: 60, windowSeconds: 3600, key: "user" })
  setAgentPhoto(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(AgentPhotoBody)) body: z.infer<typeof AgentPhotoBody>, @CurrentActor() actor: Actor) {
    return this.agents.setPhoto(id, body, actor)
  }

  @Get("agents/:id/photo")
  @RequirePermission("cargo_request.read.any", "cargo_agent.manage")
  async agentPhoto(@Param("id", zbody(z.uuid())) id: string) {
    const p = await this.agents.photo(id)
    return new StreamableFile(p.body, { type: p.mime, disposition: "inline", length: p.body.length })
  }
}

/** ADR-0043: the Agent Dashboard. Only the agent's own profile and assignments; 404 for anything else. */
@ApiTags("agent")
@Controller("v1/agent")
@StaffOnly()
export class AgentJobsController {
  constructor(private readonly agents: AgentsService, private readonly signIn: AgentSignInService, private readonly postage: PostageService) {}

  /** ADR-0046 D3: the agent's run sheet for a day. */
  @Get("manifest")
  @RequirePermission("cargo_job.agent")
  manifest(@Query(zbody(ManifestQuery)) q: z.infer<typeof ManifestQuery>, @CurrentActor() actor: Actor) {
    return this.postage.myManifest(actor, q.date)
  }

  @Get("manifest.pdf")
  @RequirePermission("cargo_job.agent")
  async manifestPdf(@Query(zbody(ManifestQuery)) q: z.infer<typeof ManifestQuery>, @CurrentActor() actor: Actor) {
    const m = await this.postage.myManifest(actor, q.date)
    const pdf = await this.postage.manifestPdf(m)
    return new StreamableFile(pdf, { type: "application/pdf", disposition: `inline; filename="run-sheet-${m.date}.pdf"`, length: pdf.length })
  }

  /** ADR-0045: a scanned label → the agent's own open job(s) for that shipment. */
  @Get("jobs/by-tracking/:trackingNumber")
  @RequirePermission("cargo_job.agent")
  byTracking(@Param("trackingNumber", zbody(TrackingNumber)) tn: string, @CurrentActor() actor: Actor) {
    return this.signIn.jobsByTracking(actor, tn)
  }

  @Get("me")
  @RequirePermission("cargo_job.agent")
  me(@CurrentActor() actor: Actor) {
    return this.agents.myProfile(actor)
  }

  @Get("me/photo")
  @RequirePermission("cargo_job.agent")
  async myPhoto(@CurrentActor() actor: Actor) {
    const p = await this.agents.myPhoto(actor)
    return new StreamableFile(p.body, { type: p.mime, disposition: "inline", length: p.body.length })
  }

  @Get("jobs")
  @RequirePermission("cargo_job.agent")
  jobs(@Query(zbody(z.object({ scope: z.enum(["open", "done"]).default("open") }))) q: { scope: "open" | "done" }, @CurrentActor() actor: Actor) {
    return this.agents.myJobs(actor, q.scope)
  }

  @Get("jobs/:id")
  @RequirePermission("cargo_job.agent")
  job(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.agents.job(actor, id)
  }

  @Post("jobs/:id/actions/:action")
  @RequirePermission("cargo_job.agent")
  @RateLimit({ name: "agent-actions", limit: 240, windowSeconds: 3600, key: "user" })
  @HttpCode(200)
  act(@Param("id", zbody(z.uuid())) id: string, @Param("action") action: string, @Body() raw: unknown, @CurrentActor() actor: Actor) {
    if (!(AGENT_ACTIONS as readonly string[]).includes(action)) throw new AppError("NOT_FOUND", "Unknown action")
    const parsed = AgentActionBodies[action as AgentAction].safeParse(raw ?? {})
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues.map((i) => ({ path: i.path.join("."), code: "INVALID", message: i.message })))
    return this.agents.act(actor, id, action as AgentAction, parsed.data as Record<string, unknown>)
  }

  @Post("jobs/:id/files")
  @RequirePermission("cargo_job.agent")
  @RateLimit({ name: "agent-files", limit: 120, windowSeconds: 3600, key: "user" })
  upload(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(ImageBody)) body: z.infer<typeof ImageBody>, @CurrentActor() actor: Actor) {
    return this.agents.upload(actor, id, body)
  }
}

/** ADR-0044: staff intake across products (customer lookup, flight requests); cargo intake stays under /v1/admin/cargo. */
@ApiTags("admin-intake")
@Controller("v1/admin/intake")
@StaffOnly()
export class StaffIntakeController {
  constructor(private readonly intake: StaffIntakeService) {}

  @Get("customers")
  @RequirePermission("flight_request.create.any", "cargo_request.create.any")
  @RateLimit({ name: "intake-customer-lookup", limit: 120, windowSeconds: 3600, key: "user" })
  lookup(@Query(zbody(CargoCustomerLookup)) q: z.infer<typeof CargoCustomerLookup>, @CurrentActor() actor: Actor) {
    return this.intake.lookup(q.q, actor)
  }

  @Post("flight-requests")
  @RequirePermission("flight_request.create.any")
  @Idempotent()
  @RateLimit({ name: "flight-staff-create", limit: 120, windowSeconds: 3600, key: "user" })
  createFlight(@Body(zbody(StaffCreateFlightRequestBody)) body: z.infer<typeof StaffCreateFlightRequestBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.intake.createFlight(body, actor, { requestId: ctx.id, locale: ctx.locale })
  }
}

/** ADR-0045: the agent's phone redeems the sign-in QR code shown on their profile. */
@ApiTags("auth")
@Controller("v1/auth")
export class AgentSignInController {
  constructor(private readonly signIn: AgentSignInService, private readonly sessions: SessionsService) {}

  @Post("agent-code")
  @Public()
  @HttpCode(200)
  @RateLimit({ name: "agent-code", limit: 30, windowSeconds: 600, key: "ip" })
  @ApiZodBody(AgentCodeSignInBody)
  async redeem(@Body(zbody(AgentCodeSignInBody)) body: AgentCodeSignInBody, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Ctx() ctx: RequestContext) {
    const tokens = await this.signIn.redeem(body.code, { deviceId: body.deviceId, ip: req.ip, userAgent: req.header("user-agent"), requestId: ctx.id })
    setSessionCookies(res, tokens, "CONSOLE")
    // Remember the phone like any console sign-in (ADR-0022), so the agent is not asked again tomorrow.
    const host = consoleHost(req)
    if (host) {
      const d = await this.sessions.trustDevice(tokens.sessionId, host, { ip: req.ip, userAgent: req.header("user-agent"), requestId: ctx.id })
      if (d) setDeviceCookie(res, d.token, d.expiresAt)
    }
    return { ok: true }
  }
}
