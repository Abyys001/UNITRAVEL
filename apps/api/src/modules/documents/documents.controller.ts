import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import { DocumentType, IDENTITY_DOCUMENT_TYPES } from "@unitravel/contracts"

import { AppError } from "../../core/errors"
import { type Actor, Authenticated, Ctx, CurrentActor, RateLimit, type RequestContext } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { DocumentsService } from "./documents.service"

const UploadBody = z.object({ filename: z.string().min(1).max(200), mime: z.string(), size: z.number().int().positive(), type: DocumentType })

@ApiTags("documents")
@Controller("v1")
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  /** Upload session: a pre-signed URL with size and type limits (ch. 24.3). */
  @Post("uploads")
  @Authenticated()
  @RateLimit({ name: "uploads", limit: 60, windowSeconds: 3600, key: "user" })
  create(@Body(zbody(UploadBody)) body: z.infer<typeof UploadBody>, @CurrentActor() actor: Actor) {
    return this.docs.createUpload({ ownerUserId: actor.userId, filename: body.filename, mime: body.mime, size: body.size, type: body.type, createdBy: actor.userId, visibility: "CUSTOMER" })
  }

  @Post("uploads/:id/complete")
  @Authenticated()
  @HttpCode(200)
  complete(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.docs.complete(id, actor.userId)
  }

  @Get("uploads/:id")
  @Authenticated()
  async status(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    const d = await this.docs.get(id)
    if (!d || d.createdBy !== actor.userId) throw new AppError("NOT_FOUND")
    return { documentId: d.id, scanStatus: d.scanStatus, filename: d.filename }
  }

  /**
   * Short-lived signed URL after an ownership or staff permission check; no existence leaks (404).
   * Identity documents need `customer.read.documents` (the broad request-read permissions are not enough) and every
   * staff download is written to the audit log (ADR-0005 V8).
   */
  @Get("documents/:id/download")
  @Authenticated()
  async download(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const d = await this.docs.get(id)
    if (!d) throw new AppError("NOT_FOUND")
    const owner = d.ownerUserId === actor.userId && (d.visibility === "CUSTOMER" || d.createdBy === actor.userId)
    const identity = (IDENTITY_DOCUMENT_TYPES as readonly string[]).includes(d.type)
    // Quotation and invoice PDFs carry amounts: staff need `pricing.read.internal` like in the API views (ADR-0006 C9).
    const priced = d.type === "QUOTE_PDF" || d.type === "INVOICE"
    const staff = identity
      ? actor.permissions.has("customer.read.documents")
      : priced
        ? actor.permissions.has("pricing.read.internal")
        : actor.permissions.has("flight_request.read.any") || actor.permissions.has("cargo_request.read.any") || actor.permissions.has("compliance.case.read") || actor.permissions.has("customer.read.documents")
    if (!owner && !staff) throw new AppError("NOT_FOUND")
    if (!owner) await this.docs.auditStaffDownload(d, actor.userId, actor.ip, ctx.id)
    return this.docs.downloadUrl(d)
  }
}
