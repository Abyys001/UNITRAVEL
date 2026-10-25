import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Res } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { and, eq } from "drizzle-orm"
import type { Response } from "express"
import { z } from "zod"

import {
  AppSettings, AuditQuery, ConfigDomain, ConfigDraftBody, FEATURE_FLAGS, type FeatureFlag, INTERNATIONAL_SMS_PROVIDERS, prefixCoversIran, PublishBody, SmsRouteBody, TemplateBody,
} from "@unitravel/contracts"
import { type Db, featureFlags, notificationTemplates, smsRoutes } from "@unitravel/db"
import { smsSegments } from "@unitravel/domain"

import { env } from "../../core/env"
import { AppError } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import { type Actor, Ctx, CurrentActor, DevSurface, RequirePermission, type RequestContext, StaffOnly, StepUp } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { QUEUES, Queues } from "../../core/queues"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { templateVariables } from "../notifications/format"
import { NotificationsService } from "../notifications/notifications.service"
import { sampleVars } from "../notifications/sample-vars"
import { isVendorId, VENDOR_CREDENTIAL_SCHEMAS, VENDOR_IDS } from "../notifications/vendor-schemas"
import { VendorCredentialsService } from "../notifications/vendor-credentials.service"
import { HealthService } from "../platform/health.service"
import { SuppliersService } from "../suppliers/suppliers.service"

const DOMAIN_PERMISSION: Record<z.infer<typeof ConfigDomain>, "engine.rules.publish" | "settings.write" | "notification.template.write"> = {
  ENGINE_RULES: "engine.rules.publish", HUBS: "engine.rules.publish", WORKFLOW: "settings.write", NOTIFICATION_MATRIX: "notification.template.write", AUTH: "settings.write",
}

/** Developer Panel §3 §4–§10 (configuration, health, audit, notifications, settings and flags). */
@ApiTags("dev")
@Controller("v1/dev")
@DevSurface()
@StaffOnly()
export class DevSystemController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly health: HealthService,
    private readonly queues: Queues,
    private readonly notifications: NotificationsService,
    private readonly vendors: VendorCredentialsService,
    private readonly suppliers: SuppliersService,
  ) {}

  // ---- versioned configuration ----
  @Get("config/:domain/versions")
  @RequirePermission("engine.rules.read", "settings.write", "notification.template.write")
  async versions(@Param("domain", zbody(ConfigDomain)) domain: z.infer<typeof ConfigDomain>) {
    const rows = await this.config.listVersions(domain)
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), publishedAt: r.publishedAt?.toISOString() ?? null, createdBy: r.createdBy ?? "system", publishedBy: r.publishedBy }))
  }

  @Post("config/:domain/versions")
  @RequirePermission("engine.rules.publish", "settings.write", "notification.template.write")
  async draft(@Param("domain", zbody(ConfigDomain)) domain: z.infer<typeof ConfigDomain>, @Body(zbody(ConfigDraftBody)) body: { payload: unknown; changeNote?: string }, @CurrentActor() actor: Actor) {
    if (!actor.permissions.has(DOMAIN_PERMISSION[domain])) throw new AppError("FORBIDDEN", `Requires ${DOMAIN_PERMISSION[domain]}`)
    return this.config.saveDraft(domain, body.payload, body.changeNote, actor.userId)
  }

  /** Publishing engine rules is a sensitive action: step-up within 10 minutes and a mandatory change note (ch. 16.1). */
  @Post("config/:domain/versions/:version/publish")
  @RequirePermission("engine.rules.publish", "settings.write", "notification.template.write")
  @StepUp()
  @HttpCode(200)
  async publish(@Param("domain", zbody(ConfigDomain)) domain: z.infer<typeof ConfigDomain>, @Param("version", zbody(z.coerce.number().int())) version: number, @Body(zbody(PublishBody)) body: { changeNote: string }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    if (!actor.permissions.has(DOMAIN_PERMISSION[domain])) throw new AppError("FORBIDDEN", `Requires ${DOMAIN_PERMISSION[domain]}`)
    const row = await this.config.publish(domain, version, body.changeNote, actor.userId, { ip: actor.ip, requestId: ctx.id })
    // Read-your-writes in this process; other processes reload on config.published (ch. 16.3).
    await this.config.reload()
    return row
  }

  // ---- settings and flags (§10) ----
  @Get("settings")
  @RequirePermission("settings.write", "flags.write", "diagnostics.read")
  settings() {
    return this.config.settings()
  }

  @Put("settings")
  @RequirePermission("settings.write")
  async putSettings(@Body(zbody(AppSettings)) body: z.infer<typeof AppSettings>, @CurrentActor() actor: Actor) {
    await this.uow.run((tx) => this.config.setSettings(body, actor.userId, tx))
    await this.config.reload()
    return this.config.settings()
  }

  @Get("feature-flags")
  @RequirePermission("flags.write", "diagnostics.read")
  flags() {
    return this.db.select().from(featureFlags)
  }

  @Put("feature-flags/:key")
  @RequirePermission("flags.write")
  async putFlag(@Param("key") key: string, @Body(zbody(z.object({ enabled: z.boolean() }))) body: { enabled: boolean }, @CurrentActor() actor: Actor) {
    if (!FEATURE_FLAGS.includes(key as FeatureFlag)) throw new AppError("NOT_FOUND")
    // ADR-0007 amends D-03: online payment (test mode only) may be switched on by an owner after a fresh second-factor check.
    if (key === "payments.online.enabled" && body.enabled) {
      if (!actor.permissions.has("payments.mode.approve")) throw new AppError("FORBIDDEN", "Only an owner can switch online payments on (ADR-0007)")
      const fresh = actor.mfaVerifiedAt && Date.now() - actor.mfaVerifiedAt.getTime() < 10 * 60_000
      if (!fresh) throw new AppError("STEP_UP_REQUIRED", "Switching online payments on needs a fresh second-factor check")
    }
    await this.uow.run((tx) => this.config.setFlag(key as FeatureFlag, body.enabled, actor.userId, tx))
    await this.config.reload()
    return { key, enabled: body.enabled }
  }

  // ---- audit (§8) ----
  @Get("audit-log")
  @RequirePermission("audit.read")
  async auditLog(@Query(zbody(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    const r = await this.audit.query(q)
    return { items: r.items.map((a) => ({ ...a, id: String(a.id), occurredAt: a.occurredAt.toISOString() })), nextCursor: r.nextCursor }
  }

  @Get("audit-log/verify")
  @RequirePermission("audit.read")
  verify() {
    return this.audit.verify()
  }

  /** Export to CSV requires step-up and is itself audited (ch. 16.2 §8). */
  @Post("audit-log/export")
  @RequirePermission("audit.read")
  @StepUp()
  async export(@Body(zbody(AuditQuery)) q: z.infer<typeof AuditQuery>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext, @Res() res: Response) {
    const r = await this.audit.query({ ...q, limit: 200 })
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "audit.exported", entityType: "audit_log", after: { filters: q, rows: r.items.length }, ip: actor.ip, requestId: ctx.id }))
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const csv = ["id,occurred_at,actor,actor_kind,action,entity_type,entity_id,context_ref,ip,request_id,hash", ...r.items.map((a) => [a.id, a.occurredAt.toISOString(), a.actorUserId, a.actorKind, a.action, a.entityType, a.entityId, a.contextRef, a.ip, a.requestId, a.hash].map(esc).join(","))].join("\n")
    res.type("text/csv").setHeader("content-disposition", "attachment; filename=audit-log.csv")
    res.send(csv)
  }

  // ---- diagnostics (§3, §9) ----
  @Get("health")
  @RequirePermission("diagnostics.read")
  async diagnostics() {
    const providers = await this.suppliers.healthSummary()
    const routes = await this.db.select().from(smsRoutes)
    const smsDeps = []
    for (const r of routes) for (const p of r.providers) {
      const s = await this.notifications.routeStats(r.prefix, p)
      const total = s.ok + s.fail
      smsDeps.push({ name: `sms ${r.prefix} → ${p}`, kind: "sms", ok: total ? s.fail / total < 0.2 : null, successRate: total ? s.ok / total : null, p50: null, p95: null, lastError: null, circuit: null })
    }
    return this.health.diagnostics([...providers, ...smsDeps])
  }

  @Get("queues/dead-letters")
  @RequirePermission("diagnostics.read")
  async deadLetters() {
    const out = []
    for (const name of QUEUES) {
      const failed = await this.queues.get(name).getJobs(["failed"], 0, 50)
      for (const j of failed) out.push({ id: j.id, queue: name, name: j.name, failedReason: j.failedReason, attemptsMade: j.attemptsMade, timestamp: new Date(j.timestamp).toISOString(), data: redact(j.data) })
    }
    return out
  }

  @Post("jobs/:queue/:id/retry")
  @RequirePermission("diagnostics.read")
  @HttpCode(200)
  async retry(@Param("queue") queue: string, @Param("id") id: string, @CurrentActor() actor: Actor) {
    if (!QUEUES.includes(queue as never)) throw new AppError("NOT_FOUND")
    const job = await this.queues.get(queue as never).getJob(id)
    if (!job) throw new AppError("NOT_FOUND")
    await job.retry()
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "job.retried", entityType: "job", entityId: `${queue}/${id}` }))
    return { ok: true }
  }

  @Post("jobs/:queue/:id/discard")
  @RequirePermission("diagnostics.read")
  @HttpCode(200)
  async discard(@Param("queue") queue: string, @Param("id") id: string, @CurrentActor() actor: Actor) {
    if (!QUEUES.includes(queue as never)) throw new AppError("NOT_FOUND")
    const job = await this.queues.get(queue as never).getJob(id)
    if (!job) throw new AppError("NOT_FOUND")
    await job.remove()
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "job.discarded", entityType: "job", entityId: `${queue}/${id}` }))
    return { ok: true }
  }

  // ---- notifications (§6) ----
  @Get("notification-templates")
  @RequirePermission("notification.template.write", "diagnostics.read")
  async templates() {
    const rows = await this.db.select().from(notificationTemplates).orderBy(notificationTemplates.eventType, notificationTemplates.channel, notificationTemplates.locale)
    return rows.map((t) => ({ ...t, segments: t.channel === "SMS" ? smsSegments(t.body) : undefined }))
  }

  /** Variable sets are declared and validated at save time (ch. 17.4). */
  @Put("notification-templates")
  @RequirePermission("notification.template.write")
  async putTemplate(@Body(zbody(TemplateBody)) body: z.infer<typeof TemplateBody>, @CurrentActor() actor: Actor) {
    const used = templateVariables(`${body.title} ${body.body}`)
    const undeclared = used.filter((v) => !body.variables.includes(v))
    if (undeclared.length) throw new AppError("VALIDATION_FAILED", `Undeclared variables: ${undeclared.join(", ")}`, undeclared.map((v) => ({ path: "body", code: "UNDECLARED_VARIABLE", message: v })))
    return this.uow.run(async (tx) => {
      const [before] = await tx.select().from(notificationTemplates).where(and(eq(notificationTemplates.eventType, body.eventType), eq(notificationTemplates.channel, body.channel), eq(notificationTemplates.locale, body.locale)))
      const [row] = await tx.insert(notificationTemplates).values({ ...body, version: (before?.version ?? 0) + 1, updatedBy: actor.userId })
        .onConflictDoUpdate({ target: [notificationTemplates.eventType, notificationTemplates.channel, notificationTemplates.locale], set: { title: body.title, body: body.body, variables: body.variables, providerTemplateId: body.providerTemplateId, active: body.active, version: (before?.version ?? 0) + 1, updatedBy: actor.userId } }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "template.saved", entityType: "notification_template", entityId: row!.id, before: before ? { body: before.body } : null, after: { body: body.body } })
      return { ...row, segments: body.channel === "SMS" ? smsSegments(body.body) : undefined }
    })
  }

  /** Delivers a template to the developer's own verified phone or email — never to anyone else. */
  @Post("notification-templates/test-send")
  @RequirePermission("notification.template.write")
  @HttpCode(202)
  async testSend(@Body(zbody(z.object({ eventType: z.string(), channel: z.enum(["SMS", "EMAIL", "PUSH", "INBOX"]) }))) body: { eventType: string; channel: string }, @CurrentActor() actor: Actor) {
    const rows = await this.db.select().from(notificationTemplates).where(and(eq(notificationTemplates.eventType, body.eventType), eq(notificationTemplates.active, true)))
    if (!rows.length) throw new AppError("NOT_FOUND", "No active template for this event")
    // Every declared variable of every template of the event gets a sample value (the declared set is validated at save time).
    const declared = [...new Set([...rows.flatMap((t) => t.variables), ...rows.flatMap((t) => templateVariables(`${t.title} ${t.body}`))])]
    await this.notifications.notify({ eventType: body.eventType as never, eventId: crypto.randomUUID(), audience: "DEVELOPERS", userIds: [actor.userId], vars: sampleVars(declared) })
    return { queued: true }
  }

  @Get("sms-routes")
  @RequirePermission("notification.template.write", "diagnostics.read")
  async routes() {
    const rows = await this.db.select().from(smsRoutes)
    const out = []
    for (const r of rows) {
      let ok = 0, fail = 0
      for (const p of r.providers) { const s = await this.notifications.routeStats(r.prefix, p); ok += s.ok; fail += s.fail }
      out.push({ ...r, successRate: ok + fail ? ok / (ok + fail) : null, sent24h: ok + fail })
    }
    return out
  }

  @Put("sms-routes")
  @RequirePermission("notification.template.write")
  async putRoute(@Body(zbody(SmsRouteBody)) body: z.infer<typeof SmsRouteBody>, @CurrentActor() actor: Actor) {
    // +98 must never be routed through international providers (ch. 8.1).
    // Any prefix that can match Iranian numbers ("+98", "+9891", "+9") is covered, not only the exact string.
    if (prefixCoversIran(body.prefix) && body.providers.some((p) => INTERNATIONAL_SMS_PROVIDERS.includes(p))) throw new AppError("VALIDATION_FAILED", "Do not route +98 through international providers", [{ path: "providers", code: "IRAN_INTERNATIONAL_PROVIDER" }])
    if (env().APP_ENV === "production" && body.providers.includes("console")) throw new AppError("VALIDATION_FAILED", "The console sink is not a production provider", [{ path: "providers", code: "CONSOLE_IN_PRODUCTION" }])
    return this.uow.run(async (tx) => {
      const [row] = await tx.insert(smsRoutes).values(body).onConflictDoUpdate({ target: smsRoutes.prefix, set: { providers: body.providers, enabled: body.enabled } }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "sms_route.saved", entityType: "sms_route", entityId: row!.id, after: body })
      return row
    })
  }

  /** Write-only vendor credentials (SMS, push, email): encrypted at rest, never displayed again (ch. 16.2 §2). */
  @Put("vendors/:vendor/credentials")
  @RequirePermission("provider.config.write")
  @StepUp()
  async vendorCredentials(@Param("vendor") vendor: string, @Body(zbody(z.object({ values: z.record(z.string(), z.string().max(4096)) }))) body: { values: Record<string, string> }, @CurrentActor() actor: Actor) {
    if (!isVendorId(vendor)) throw new AppError("NOT_FOUND", "Unknown vendor")
    const parsed = VENDOR_CREDENTIAL_SCHEMAS[vendor].safeParse(body.values)
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", `Credentials for ${vendor} are incomplete or have unknown fields`, parsed.error.issues.map((i) => ({ path: `values.${i.path.join(".")}`, code: i.code, message: i.message })))
    const values = parsed.data as Record<string, string>
    await this.uow.run(async (tx) => {
      await this.vendors.set(tx, vendor, values, actor.userId)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "vendor.credentials_rotated", entityType: "vendor", entityId: vendor, after: { keys: Object.keys(values) } })
    })
    return { vendor, rotatedAt: new Date().toISOString() }
  }

  @Get("vendors")
  @RequirePermission("provider.config.read")
  async vendorList() {
    return Promise.all(VENDOR_IDS.map(async (v) => ({ vendor: v, credentials: await this.vendors.meta(v), fields: Object.keys(VENDOR_CREDENTIAL_SCHEMAS[v].shape) })))
  }
}

function redact(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data ?? null, (k, v) => (/code|phone|destination|email|name|body|message|token/i.test(k) && typeof v === "string" ? "[redacted]" : v)))
}
