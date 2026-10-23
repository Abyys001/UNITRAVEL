import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request } from "express"
import type { Redis } from "ioredis"

import { CursorQuery, MarkReadBody } from "@unitravel/contracts"

import { constantTimeEqual } from "../../core/crypto"
import { isLocal } from "../../core/env"
import { AppError } from "../../core/errors"
import { REDIS } from "../../core/infra.module"
import { type Actor, Authenticated, CurrentActor, Public, RateLimit } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { NotificationsService } from "./notifications.service"
import { VendorCredentialsService } from "./vendor-credentials.service"

@ApiTags("notifications")
@Controller("v1")
export class NotificationsController {
  constructor(private readonly n: NotificationsService, private readonly creds: VendorCredentialsService, @Inject(REDIS) private readonly redis: Redis) {}

  @Get("notifications")
  @Authenticated()
  inbox(@Query(zbody(CursorQuery)) q: { limit: number; cursor?: string }, @CurrentActor() actor: Actor) {
    return this.n.inbox(actor.userId, q.limit, q.cursor)
  }

  @Post("notifications/read")
  @Authenticated()
  @HttpCode(204)
  async read(@Body(zbody(MarkReadBody)) body: { ids?: string[]; all?: boolean }, @CurrentActor() actor: Actor) {
    await this.n.markRead(actor.userId, body.ids, body.all)
  }

  /**
   * Delivery reports (ch. 17.5, 24.6): verified by shared secret (constant-time), recorded, done. Processing beyond
   * mapping the status is not needed for SMS reports.
   */
  @Post("webhooks/sms/:provider")
  @Public()
  @HttpCode(200)
  @RateLimit({ name: "webhook-sms", limit: 6000, windowSeconds: 60, key: "ip" })
  async smsWebhook(@Param("provider") provider: string, @Req() req: Request, @Body() body: Record<string, unknown>) {
    const c = await this.creds.get(`sms:${provider}`)
    const presented = (req.query.secret as string | undefined) ?? req.header("x-webhook-secret") ?? ""
    if (!c?.webhookSecret || !constantTimeEqual(presented, c.webhookSecret)) throw new AppError("FORBIDDEN", "Invalid webhook signature")
    for (const r of normaliseReports(provider, body)) await this.n.deliveryReport(provider, r.messageId, r.status)
    return { ok: true }
  }

  @Post("webhooks/push/:provider")
  @Public()
  @HttpCode(200)
  async pushWebhook(@Param("provider") provider: string, @Req() req: Request) {
    const c = await this.creds.get(`push:${provider}`)
    if (!c?.webhookSecret || !constantTimeEqual(req.header("x-webhook-secret") ?? "", c.webhookSecret)) throw new AppError("FORBIDDEN", "Invalid webhook signature")
    return { ok: true }
  }

  @Get("s/:code")
  @Public()
  @RateLimit({ name: "shortlink", limit: 120, windowSeconds: 600, key: "ip" })
  async shortLink(@Param("code") code: string) {
    const target = await this.n.resolveShortLink(code)
    if (!target) throw new AppError("NOT_FOUND")
    return { target }
  }

  /** Local only: the console SMS/push sinks, used by the developer workflow and end-to-end tests. */
  @Get("dev-sink/sms")
  @Public()
  async smsSink() {
    if (!isLocal()) throw new AppError("NOT_FOUND")
    return (await this.redis.lrange("dev:sms", 0, 49)).map((s) => JSON.parse(s))
  }

  @Get("dev-sink/push")
  @Public()
  async pushSink() {
    if (!isLocal()) throw new AppError("NOT_FOUND")
    return (await this.redis.lrange("dev:push", 0, 49)).map((s) => JSON.parse(s))
  }
}

function normaliseReports(provider: string, body: Record<string, unknown>): { messageId: string; status: "DELIVERED" | "FAILED" | "UNDELIVERABLE" }[] {
  const map = (s: string) => (/deliver/i.test(s) ? "DELIVERED" : /undeliver|reject|blacklist|expired/i.test(s) ? "UNDELIVERABLE" : "FAILED") as "DELIVERED" | "FAILED" | "UNDELIVERABLE"
  if (provider === "infobip") return ((body.results as { messageId: string; status: { groupName: string } }[]) ?? []).map((r) => ({ messageId: r.messageId, status: map(r.status.groupName) }))
  if (provider === "sinch") return [{ messageId: String(body.batch_id ?? ""), status: map(String(body.status ?? "")) }]
  if (provider === "kavenegar") return [{ messageId: String(body.messageid ?? ""), status: String(body.status) === "10" ? "DELIVERED" : map(String(body.status ?? "")) }]
  return [{ messageId: String(body.messageId ?? body.MessageId ?? ""), status: map(String(body.status ?? body.DeliveryState ?? "")) }]
}
