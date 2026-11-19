import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common"
import { ApiOperation, ApiTags } from "@nestjs/swagger"
import type { Response } from "express"
import { z } from "zod"

import {
  BrandLogoUploadBody, CreateTicketDocumentBody, CustomerTicketDocumentQuery, IssueTicketDocumentBody, ReissueTicketDocumentBody, ReplaceTicketDocumentBody, ResendTicketDocumentBody,
  RevokeTicketDocumentBody, TicketDocumentSearchQuery, TicketFileWhich, TicketOriginalUploadBody,
} from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, DevSurface, Idempotent, RateLimit, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { TicketDocumentsService } from "./ticket-documents.service"

const Id = zbody(z.uuid())
const Which = zbody(TicketFileWhich)
const Disposition = zbody(z.object({ disposition: z.enum(["attachment", "inline"]).default("attachment") }))
const Index = zbody(z.coerce.number().int().min(0).max(255))

/** ADR-0038 staff surface: upload on behalf, draft, preview, issue, resend, replace, reissue, revoke, search (D8 permissions). */
@ApiTags("ticket-documents")
@Controller("v1/admin")
@StaffOnly()
export class AdminTicketDocumentsController {
  constructor(private readonly svc: TicketDocumentsService) {}

  @Post("ticket-documents/uploads")
  @RequirePermission("ticket.document.issue")
  @ApiOperation({ summary: "Upload session for the provider's PDF (PDF only, 10 MB, write-once). PUT with the returned headers, then complete." })
  @RateLimit({ name: "uploads", limit: 120, windowSeconds: 3600, key: "user" })
  upload(@Body(zbody(TicketOriginalUploadBody)) body: z.infer<typeof TicketOriginalUploadBody>, @CurrentActor() actor: Actor) {
    return this.svc.createOriginalUpload(body, actor)
  }

  @Post("ticket-documents/uploads/:id/complete")
  @RequirePermission("ticket.document.issue")
  @HttpCode(200)
  complete(@Param("id", Id) id: string, @CurrentActor() actor: Actor) {
    return this.svc.completeUpload(id, actor)
  }

  @Get("ticket-documents/uploads/:id")
  @RequirePermission("ticket.document.issue")
  uploadStatus(@Param("id", Id) id: string, @CurrentActor() actor: Actor) {
    return this.svc.uploadStatus(id, actor)
  }

  @Post("ticket-documents")
  @RequirePermission("ticket.document.issue")
  @Idempotent()
  @ApiOperation({ summary: "Create a DRAFT from a CLEAN upload: builds the branded PDF and runs the code-integrity and text checks." })
  create(@Body(zbody(CreateTicketDocumentBody)) body: z.infer<typeof CreateTicketDocumentBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.svc.createDraft(body, actor, ctx.id)
  }

  @Get("ticket-documents")
  @RequirePermission("ticket.record")
  search(@Query(zbody(TicketDocumentSearchQuery)) q: z.infer<typeof TicketDocumentSearchQuery>) {
    return this.svc.search(q)
  }

  @Get("flight-requests/:ref/ticket-documents")
  @RequirePermission("ticket.record")
  forRequest(@Param("ref") ref: string) {
    return this.svc.forRequest(ref)
  }

  @Get("ticket-documents/:id")
  @RequirePermission("ticket.record")
  detail(@Param("id", Id) id: string, @CurrentActor() actor: Actor) {
    return this.svc.detail(id, actor)
  }

  @Get("ticket-documents/:id/preview")
  @RequirePermission("ticket.document.issue")
  @ApiOperation({ summary: "Signed URLs for the original and the branded file (sha256 re-checked, audited)." })
  preview(@Param("id", Id) id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.svc.preview(id, actor, ctx.id)
  }

  @Get("ticket-documents/:id/files/:which")
  @RequirePermission("ticket.record")
  file(@Param("id", Id) id: string, @Param("which", Which) which: z.infer<typeof TicketFileWhich>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.svc.staffFile(id, which, actor, ctx.id)
  }

  @Post("ticket-documents/:id/issue")
  @RequirePermission("ticket.document.issue")
  @Idempotent()
  @HttpCode(200)
  @ApiOperation({ summary: "Issue a DRAFT: runs missing records first (D5), 409 CODE_INTEGRITY_FAILED unless every code matched, emails both files." })
  issue(@Param("id", Id) id: string, @Body(zbody(IssueTicketDocumentBody)) body: z.infer<typeof IssueTicketDocumentBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.svc.issue(id, body, actor, ctx.id)
  }

  @Post("ticket-documents/:id/resend")
  @RequirePermission("ticket.document.resend")
  @Idempotent()
  @HttpCode(200)
  resend(@Param("id", Id) id: string, @Body(zbody(ResendTicketDocumentBody)) body: z.infer<typeof ResendTicketDocumentBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.svc.resend(id, body, actor, ctx.id)
  }

  @Post("ticket-documents/:id/replace")
  @RequirePermission("ticket.document.issue")
  @Idempotent()
  @ApiOperation({ summary: "New provider file for an ISSUED version: creates the next version as a DRAFT; issuing it supersedes this one." })
  replace(@Param("id", Id) id: string, @Body(zbody(ReplaceTicketDocumentBody)) body: z.infer<typeof ReplaceTicketDocumentBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.svc.replace(id, body, actor, ctx.id)
  }

  @Post("ticket-documents/:id/reissue")
  @RequirePermission("ticket.document.issue")
  @Idempotent()
  reissue(@Param("id", Id) id: string, @Body(zbody(ReissueTicketDocumentBody)) body: z.infer<typeof ReissueTicketDocumentBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.svc.reissue(id, body, actor, ctx.id)
  }

  @Post("ticket-documents/:id/revoke")
  @RequirePermission("ticket.document.issue")
  @HttpCode(200)
  revoke(@Param("id", Id) id: string, @Body(zbody(RevokeTicketDocumentBody)) body: z.infer<typeof RevokeTicketDocumentBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.svc.revoke(id, body, actor, ctx.id)
  }
}

/** ADR-0038 D7: the cover logo, uploaded on the Developer Panel next to the settings it is referenced from. */
@ApiTags("ticket-documents")
@Controller("v1/dev/branding")
@DevSurface()
@StaffOnly()
export class DevBrandingController {
  constructor(private readonly svc: TicketDocumentsService) {}

  @Post("logo-uploads")
  @RequirePermission("settings.write")
  @ApiOperation({ summary: "Upload session for the cover logo (PNG, JPEG or SVG, 2 MB); complete it, then set settings.company.logoDocumentId." })
  upload(@Body(zbody(BrandLogoUploadBody)) body: z.infer<typeof BrandLogoUploadBody>, @CurrentActor() actor: Actor) {
    return this.svc.createLogoUpload(body, actor)
  }

  @Post("logo-uploads/:id/complete")
  @RequirePermission("settings.write")
  @HttpCode(200)
  complete(@Param("id", Id) id: string, @CurrentActor() actor: Actor) {
    return this.svc.completeUpload(id, actor, "BRAND_LOGO")
  }

  @Get("logo-uploads/:id")
  @RequirePermission("settings.write")
  status(@Param("id", Id) id: string, @CurrentActor() actor: Actor) {
    return this.svc.uploadStatus(id, actor, "BRAND_LOGO")
  }
}

/** Customer surface: only ISSUED versions of the customer's own requests; anything else is 404. Every file read is audited. */
@ApiTags("ticket-documents")
@Controller("v1/ticket-documents")
export class CustomerTicketDocumentsController {
  constructor(private readonly svc: TicketDocumentsService) {}

  @Get()
  @RequirePermission("flight_request.read.own")
  list(@Query(zbody(CustomerTicketDocumentQuery)) q: z.infer<typeof CustomerTicketDocumentQuery>, @CurrentActor() actor: Actor) {
    return this.svc.customerList(actor, q.requestRef)
  }

  @Get(":id")
  @RequirePermission("flight_request.read.own")
  detail(@Param("id", Id) id: string, @CurrentActor() actor: Actor) {
    return this.svc.customerDetail(id, actor)
  }

  @Get(":id/files/:which")
  @RequirePermission("flight_request.read.own")
  @RateLimit({ name: "ticket-files", limit: 120, windowSeconds: 3600, key: "user" })
  file(@Param("id", Id) id: string, @Param("which", Which) which: z.infer<typeof TicketFileWhich>, @Query(Disposition) q: { disposition: "attachment" | "inline" }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.svc.customerFile(id, which, actor, ctx.id, q.disposition)
  }

  @Get(":id/codes/:index")
  @RequirePermission("flight_request.read.own")
  @RateLimit({ name: "ticket-files", limit: 120, windowSeconds: 3600, key: "user" })
  @ApiOperation({ summary: "PNG crop of the ORIGINAL page around a decoded code (rendered, never re-encoded)." })
  async code(@Param("id", Id) id: string, @Param("index", Index) index: number, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext, @Res() res: Response) {
    const png = await this.svc.customerCodeCrop(id, index, actor, ctx.id)
    res.type("image/png").setHeader("cache-control", "private, no-store")
    res.send(png)
  }
}
