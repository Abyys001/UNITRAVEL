import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import { DocumentType } from "@unitravel/contracts"

import { AppError } from "../../core/errors"
import { type Actor, Authenticated, CurrentActor, RateLimit } from "../../core/http/decorators"
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

  /** Short-lived signed URL after an ownership or staff permission check; no existence leaks (404). */
  @Get("documents/:id/download")
  @Authenticated()
  async download(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    const d = await this.docs.get(id)
    if (!d) throw new AppError("NOT_FOUND")
    const staff = actor.permissions.has("flight_request.read.any") || actor.permissions.has("cargo_request.read.any") || actor.permissions.has("compliance.case.read")
    const owner = d.ownerUserId === actor.userId && (d.visibility === "CUSTOMER" || d.createdBy === actor.userId)
    if (!staff && !owner) throw new AppError("NOT_FOUND")
    return this.docs.downloadUrl(d)
  }
}
