import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { eq, sql } from "drizzle-orm"
import type { Redis } from "ioredis"
import { z } from "zod"

import { CredentialsBody, DevApifyTestResult, ProviderId, ProviderPatchBody, ProviderRunsQuery, ProviderUsageView, ProviderView } from "@unitravel/contracts"
import { type Db, providers } from "@unitravel/db"

import { sandboxAllowed } from "../../core/env"
import { AppError } from "../../core/errors"
import { DB, REDIS, UnitOfWork } from "../../core/infra.module"
import { type Actor, Ctx, CurrentActor, DevSurface, RequirePermission, type RequestContext, StaffOnly, StepUp } from "../../core/http/decorators"
import { ApiZodResponse, zbody } from "../../core/http/zod"
import { AuditService } from "../audit/audit.service"
import { OutboxService } from "../platform/outbox.service"
import { APIFY_ID, FlightDataService } from "./apify/flight-data.service"
import { SuppliersService } from "./suppliers.service"

/**
 * ADR-0032 B7: the Admin Panel dashboard's Apify usage card. Read-only and the same view as the Developer Panel
 * usage route; `/v1/dev/*` does not exist on the admin host.
 */
@ApiTags("admin-providers")
@Controller("v1/admin/providers")
@StaffOnly()
export class AdminProvidersController {
  constructor(private readonly flightData: FlightDataService) {}

  @Get(`${APIFY_ID}/usage`)
  @RequirePermission("provider.config.read")
  @ApiZodResponse(200, ProviderUsageView)
  usage() {
    return this.flightData.usage()
  }
}

/** Developer Panel §2 — flight API configuration (ch. 16.2). */
@ApiTags("dev")
@Controller("v1/dev/providers")
@DevSurface()
@StaffOnly()
export class DevProvidersController {
  constructor(@Inject(DB) private readonly db: Db, @Inject(REDIS) private readonly redis: Redis, private readonly uow: UnitOfWork, private readonly suppliers: SuppliersService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly flightData: FlightDataService) {}

  @Get()
  @RequirePermission("provider.config.read")
  async list() {
    const rows = await this.db.select().from(providers).orderBy(providers.priority)
    return Promise.all(rows.map((r) => this.suppliers.view(r.id)))
  }

  /** Credential metadata only (set, last4, rotatedAt, rotatedBy, invalidAt, testedAt); never a value. */
  @Get(":id")
  @RequirePermission("provider.config.read")
  @ApiZodResponse(200, ProviderView)
  get(@Param("id", zbody(ProviderId)) id: string) {
    return this.suppliers.view(id)
  }

  /** Disabling a provider is a sensitive action (step-up) and reaches every process through pub/sub. */
  @Patch(":id")
  @RequirePermission("provider.config.write")
  async patch(@Param("id", zbody(ProviderId)) id: string, @Body(zbody(ProviderPatchBody)) body: z.infer<typeof ProviderPatchBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const before = await this.suppliers.row(id)
    if (!before) throw new AppError("NOT_FOUND")
    const fresh = actor.mfaVerifiedAt && Date.now() - actor.mfaVerifiedAt.getTime() < 10 * 60_000
    if (body.enabled === false && before.enabled && !fresh) throw new AppError("STEP_UP_REQUIRED", "Disabling a provider needs a fresh second-factor check")
    // Metering decides how much money the provider may spend, so it needs the same fresh check and is audited with the rest of the patch.
    if (body.metering) {
      if (!before.metering) throw new AppError("VALIDATION_FAILED", "This provider is not metered", [{ path: "metering", code: "NOT_METERED" }])
      if (!fresh) throw new AppError("STEP_UP_REQUIRED", "Changing metering needs a fresh second-factor check")
    }
    // A metered provider is never called without a customer waiting for the answer (ADR-0029 A6).
    if (body.shadowMode && before.metering) throw new AppError("VALIDATION_FAILED", "A metered provider cannot run in shadow mode", [{ path: "shadowMode", code: "METERED" }])
    if (body.capabilities?.price && before.metering) throw new AppError("VALIDATION_FAILED", "An indicative source cannot be repriced (ADR-0029)", [{ path: "capabilities.price", code: "METERED" }])
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

  /** Apify's own usage next to our spend ledger per pool (ADR-0029 A6). Free to call. */
  @Get(":id/usage")
  @RequirePermission("provider.config.read")
  usage(@Param("id", zbody(ProviderId)) id: string) {
    if (id !== APIFY_ID) throw new AppError("NOT_FOUND")
    return this.flightData.usage()
  }

  /** The run log with the free notice and error rows Apify returned. */
  @Get(":id/runs")
  @RequirePermission("provider.config.read")
  runs(@Param("id", zbody(ProviderId)) id: string, @Query(zbody(ProviderRunsQuery)) q: z.infer<typeof ProviderRunsQuery>) {
    if (id !== APIFY_ID) throw new AppError("NOT_FOUND")
    return this.flightData.runs(q.limit)
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

  /**
   * ADR-0032 B2: Apify's free `/users/me/limits` with the stored token. Declared before `:id/test` so it wins the match.
   * Write permission: a rejected token is marked invalid, which stops every Apify call.
   */
  @Post(`${APIFY_ID}/test`)
  @RequirePermission("provider.config.write")
  @HttpCode(200)
  @ApiZodResponse(200, DevApifyTestResult)
  testApify() {
    return this.flightData.testConnection()
  }

  /** Runs a harmless call and shows the raw status, latency and any error code. */
  @Post(":id/test")
  @RequirePermission("provider.config.read")
  @HttpCode(200)
  test(@Param("id", zbody(ProviderId)) id: z.infer<typeof ProviderId>) {
    return this.suppliers.testConnection(id)
  }
}
