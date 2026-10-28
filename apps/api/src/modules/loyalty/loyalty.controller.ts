import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import {
  AddMemberBody, BenefitListQuery, ClubCandidate, ClubCandidateQuery, CustomerClubView, LedgerEntryBody, LedgerQuery, LoyaltyBenefitBody, LoyaltyBenefitView, LoyaltyLedgerEntry,
  LoyaltyMemberView, LoyaltyTierBody, LoyaltyTierView, MemberListQuery, RevokeBenefitBody, UpdateMemberBody,
} from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { LoyaltyService } from "./loyalty.service"

/** Customer club page (ADR-0016): the customer's own membership only. Flag off answers FEATURE_DISABLED. */
@ApiTags("club")
@Controller("v1/me/club")
export class CustomerClubController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  @RequirePermission("loyalty.read.own")
  @ApiZodResponse(200, CustomerClubView)
  view(@CurrentActor() actor: Actor) {
    return this.loyalty.customerView(actor.userId)
  }
}

/**
 * Admin Panel club pages (ADR-0016). Reads need `loyalty.read`; changes need `loyalty.manage`; approving a benefit
 * needs `loyalty.benefit.approve` and a different person from its author. Available with the flag off so the club can
 * be prepared before launch; the console hides the pages until the flag is on.
 */
@ApiTags("admin-club")
@Controller("v1/admin/club")
@StaffOnly()
export class AdminClubController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get("tiers")
  @RequirePermission("loyalty.read")
  @ApiZodResponse(200, LoyaltyTierView.array())
  tiers() {
    return this.loyalty.tiers()
  }

  @Post("tiers")
  @RequirePermission("loyalty.manage")
  @ApiZodBody(LoyaltyTierBody)
  @ApiZodResponse(201, LoyaltyTierView)
  createTier(@Body(zbody(LoyaltyTierBody)) body: z.infer<typeof LoyaltyTierBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.loyalty.createTier(body, actor, { requestId: ctx.id })
  }

  @Patch("tiers/:id")
  @RequirePermission("loyalty.manage")
  @ApiZodBody(LoyaltyTierBody)
  @ApiZodResponse(200, LoyaltyTierView)
  updateTier(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(LoyaltyTierBody)) body: z.infer<typeof LoyaltyTierBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.loyalty.updateTier(id, body, actor, { requestId: ctx.id })
  }

  /** Customer search for enrolling: personal data, so it needs the privileged manage permission. */
  @Get("candidates")
  @RequirePermission("loyalty.manage")
  @ApiZodResponse(200, ClubCandidate.array())
  candidates(@Query(zbody(ClubCandidateQuery)) q: z.infer<typeof ClubCandidateQuery>) {
    return this.loyalty.candidates(q.q)
  }

  @Get("members")
  @RequirePermission("loyalty.read")
  @ApiZodResponse(200, LoyaltyMemberView.array())
  members(@Query(zbody(MemberListQuery)) q: z.infer<typeof MemberListQuery>) {
    return this.loyalty.members(q)
  }

  @Get("members/:userId")
  @RequirePermission("loyalty.read")
  @ApiZodResponse(200, LoyaltyMemberView)
  member(@Param("userId", zbody(z.uuid())) userId: string) {
    return this.loyalty.member(userId)
  }

  @Post("members")
  @RequirePermission("loyalty.manage")
  @ApiZodBody(AddMemberBody)
  @ApiZodResponse(201, LoyaltyMemberView)
  addMember(@Body(zbody(AddMemberBody)) body: z.infer<typeof AddMemberBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.loyalty.addMember(body, actor, { requestId: ctx.id })
  }

  @Patch("members/:userId")
  @RequirePermission("loyalty.manage")
  @ApiZodBody(UpdateMemberBody)
  @ApiZodResponse(200, LoyaltyMemberView)
  updateMember(@Param("userId", zbody(z.uuid())) userId: string, @Body(zbody(UpdateMemberBody)) body: z.infer<typeof UpdateMemberBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.loyalty.updateMember(userId, body, actor, { requestId: ctx.id })
  }

  @Get("benefits")
  @RequirePermission("loyalty.read")
  @ApiZodResponse(200, LoyaltyBenefitView.array())
  benefits(@Query(zbody(BenefitListQuery)) q: z.infer<typeof BenefitListQuery>) {
    return this.loyalty.benefits(q)
  }

  @Post("benefits")
  @RequirePermission("loyalty.manage")
  @ApiZodBody(LoyaltyBenefitBody)
  @ApiZodResponse(201, LoyaltyBenefitView)
  createBenefit(@Body(zbody(LoyaltyBenefitBody)) body: z.infer<typeof LoyaltyBenefitBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.loyalty.createBenefit(body, actor, { requestId: ctx.id })
  }

  @Post("benefits/:id/approve")
  @RequirePermission("loyalty.benefit.approve")
  @HttpCode(200)
  @ApiZodResponse(200, LoyaltyBenefitView)
  approve(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.loyalty.approveBenefit(id, actor, { requestId: ctx.id })
  }

  @Post("benefits/:id/revoke")
  @RequirePermission("loyalty.manage")
  @HttpCode(200)
  @ApiZodBody(RevokeBenefitBody)
  @ApiZodResponse(200, LoyaltyBenefitView)
  revoke(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(RevokeBenefitBody)) body: z.infer<typeof RevokeBenefitBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.loyalty.revokeBenefit(id, body.reason, actor, { requestId: ctx.id })
  }

  @Get("ledger")
  @RequirePermission("loyalty.read")
  @ApiZodResponse(200, LoyaltyLedgerEntry.array())
  ledger(@Query(zbody(LedgerQuery)) q: z.infer<typeof LedgerQuery>) {
    return this.loyalty.ledger(q.userId, q.limit)
  }

  @Post("ledger")
  @RequirePermission("loyalty.manage")
  @ApiZodBody(LedgerEntryBody)
  @ApiZodResponse(201, LoyaltyLedgerEntry.array())
  addLedger(@Body(zbody(LedgerEntryBody)) body: z.infer<typeof LedgerEntryBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.loyalty.addLedgerEntry(body, actor, { requestId: ctx.id })
  }
}
