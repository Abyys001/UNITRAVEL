import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import { CaseStatus, DecideBody, PolicyBody, PolicyRejectBody, ScreenAdHocBody } from "@unitravel/contracts"

import { AppError } from "../../core/errors"
import { type Actor, Ctx, CurrentActor, type RequestContext, RequirePermission, StaffOnly, StepUp } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { Queues } from "../../core/queues"
import { AccessService } from "../access/access.service"
import { ComplianceService } from "./compliance.service"

/** Admin Panel › Compliance (ch. 15.7, 24.4). */
@ApiTags("admin-compliance")
@Controller("v1/admin/compliance")
@StaffOnly()
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService, private readonly access: AccessService, private readonly queues: Queues) {}

  @Get("cases")
  @RequirePermission("compliance.case.read")
  cases(@Query(zbody(z.object({ status: CaseStatus.optional() }))) q: { status?: string }) {
    return this.compliance.listCases(q.status)
  }

  @Get("cases/:id")
  @RequirePermission("compliance.case.read")
  case(@Param("id", zbody(z.uuid())) id: string) {
    return this.compliance.getCase(id)
  }

  @Post("cases/:id/decide")
  @RequirePermission("compliance.case.decide")
  @HttpCode(200)
  async decide(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(DecideBody)) body: z.infer<typeof DecideBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const acc = await this.access.load(actor.userId)
    return this.compliance.decideCase(id, body, { userId: actor.userId, ip: actor.ip, requestId: ctx.id, isOwner: acc.roles.includes("owner") })
  }

  @Get("policies")
  @RequirePermission("compliance.case.read")
  policies() {
    return this.compliance.listPolicies()
  }

  @Post("policies")
  @RequirePermission("compliance.case.decide")
  propose(@Body(zbody(PolicyBody)) body: z.infer<typeof PolicyBody>, @CurrentActor() actor: Actor) {
    return this.compliance.proposePolicy(body, actor.userId)
  }

  /** Policy changes take effect only after an owner approves them (ch. 24.4 "owner approval for changes"). */
  @Post("policies/:id/approve")
  @RequirePermission("compliance.case.decide")
  @StepUp()
  @HttpCode(200)
  async approve(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    const acc = await this.access.load(actor.userId)
    if (!acc.roles.includes("owner")) throw new AppError("FORBIDDEN", "Policies are approved by an owner")
    return this.compliance.approvePolicy(id, actor.userId)
  }

  /** An owner declines a pending proposal; the reason is mandatory and the active policy is untouched (ADR-0008 W5). */
  @Post("policies/:id/reject")
  @RequirePermission("compliance.case.decide")
  @HttpCode(200)
  async rejectPolicy(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(PolicyRejectBody)) body: z.infer<typeof PolicyRejectBody>, @CurrentActor() actor: Actor) {
    const acc = await this.access.load(actor.userId)
    return this.compliance.closeProposal(id, "reject", { userId: actor.userId, permissions: actor.permissions, isOwner: acc.roles.includes("owner") }, body.reason)
  }

  /** The proposer takes their own pending proposal back. */
  @Post("policies/:id/withdraw")
  @RequirePermission("compliance.case.decide")
  @HttpCode(200)
  withdrawPolicy(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.compliance.closeProposal(id, "withdraw", { userId: actor.userId, permissions: actor.permissions, isOwner: false })
  }

  @Post("screen")
  @RequirePermission("compliance.case.decide")
  @HttpCode(200)
  async screen(@Body(zbody(ScreenAdHocBody)) body: z.infer<typeof ScreenAdHocBody>, @CurrentActor() actor: Actor) {
    const r = await this.compliance.screenAdHoc({ subjectType: "CUSTOMER", subjectRef: `adhoc:${actor.userId}`, name: body.name, nameFa: body.nameFa, dateOfBirth: body.dateOfBirth, nationality: body.nationality, contextRef: "AD-HOC" })
    return { ...r, tokens: this.compliance.explainTokens(body.name) }
  }

  @Get("lists")
  @RequirePermission("compliance.case.read")
  lists() {
    return this.compliance.listsStatus()
  }

  @Post("lists/sync")
  @RequirePermission("compliance.case.decide")
  @HttpCode(202)
  async sync() {
    await this.queues.get("compliance.lists-sync").add("sync-now", {}, { jobId: `manual-${Date.now()}` })
    return { queued: true }
  }
}
