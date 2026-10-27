import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { eq, sql } from "drizzle-orm"
import type { Redis } from "ioredis"
import { z } from "zod"

import { CredentialsBody, ProviderId, ProviderPatchBody } from "@unitravel/contracts"
import { type Db, providers } from "@unitravel/db"

import { sandboxAllowed } from "../../core/env"
import { AppError } from "../../core/errors"
import { DB, REDIS, UnitOfWork } from "../../core/infra.module"
import { type Actor, Ctx, CurrentActor, DevSurface, RequirePermission, type RequestContext, StaffOnly, StepUp } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { AuditService } from "../audit/audit.service"
import { OutboxService } from "../platform/outbox.service"
import { SuppliersService } from "./suppliers.service"

/** Developer Panel §2 — flight API configuration (ch. 16.2). */
@ApiTags("dev")
@Controller("v1/dev/providers")
@DevSurface()
@StaffOnly()
export class DevProvidersController {
  constructor(@Inject(DB) private readonly db: Db, @Inject(REDIS) private readonly redis: Redis, private readonly uow: UnitOfWork, private readonly suppliers: SuppliersService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  @Get()
  @RequirePermission("provider.config.read")
  async list() {
    const rows = await this.db.select().from(providers).orderBy(providers.priority)
    return Promise.all(rows.map((r) => this.suppliers.view(r.id)))
  }

  @Get(":id")
  @RequirePermission("provider.config.read")
  get(@Param("id", zbody(ProviderId)) id: string) {
    return this.suppliers.view(id)
  }

  /** Disabling a provider is a sensitive action (step-up) and reaches every process through pub/sub. */
  @Patch(":id")
  @RequirePermission("provider.config.write")
  async patch(@Param("id", zbody(ProviderId)) id: string, @Body(zbody(ProviderPatchBody)) body: z.infer<typeof ProviderPatchBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const before = await this.suppliers.row(id)
    if (!before) throw new AppError("NOT_FOUND")
    if (body.enabled === false && before.enabled) {
      const fresh = actor.mfaVerifiedAt && Date.now() - actor.mfaVerifiedAt.getTime() < 10 * 60_000
      if (!fresh) throw new AppError("STEP_UP_REQUIRED", "Disabling a provider needs a fresh second-factor check")
    }
    if (id === "fake" && !sandboxAllowed()) throw new AppError("VALIDATION_FAILED", "The FAKE adapter only exists with APP_ENV=local (ADR-0014)")
    await this.uow.run(async (tx) => {
      await tx.update(providers).set({ ...body, version: sql`${providers.version} + 1` }).where(eq(providers.id, id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "provider.updated", entityType: "provider", entityId: id, before, after: body, ip: actor.ip, requestId: ctx.id })
      await this.outbox.add(tx, { aggregateType: "provider", aggregateId: id, eventType: "provider.config_changed", payload: { provider: id } })
    })
    await this.redis.publish("provider.config_changed", JSON.stringify({ provider: id }))
    await this.suppliers.reload()
    return this.suppliers.view(id)
  }

  /** Write-only: entered or rotated here, encrypted at rest, never displayed again, never sent to any client. */
  @Put(":id/credentials")
  @RequirePermission("provider.config.write")
  @StepUp()
  async credentials(@Param("id", zbody(ProviderId)) id: string, @Body(zbody(CredentialsBody)) body: { values: Record<string, string> }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.suppliers.setCredentials(id, body.values, actor.userId)
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "provider.credentials_rotated", entityType: "provider", entityId: id, after: { keys: Object.keys(body.values) }, ip: actor.ip, requestId: ctx.id }))
    return this.suppliers.view(id)
  }

  /** Runs a harmless call and shows the raw status, latency and any error code. */
  @Post(":id/test")
  @RequirePermission("provider.config.read")
  @HttpCode(200)
  test(@Param("id", zbody(ProviderId)) id: "fake" | "duffel" | "amadeus-enterprise" | "manual") {
    return this.suppliers.testConnection(id)
  }
}
