import { Inject, Injectable } from "@nestjs/common"
import { desc, eq } from "drizzle-orm"

import type { PaymentHealthView, PaymentProviderId, PaymentsConfigView, StripeCredentialsBody, StripeMode } from "@unitravel/contracts"
import { type Db, paymentConfig, stripeEvents, users } from "@unitravel/db"
import { canEnterStripeMode } from "@unitravel/domain"

import { AppError } from "../../core/errors"
import { env } from "../../core/env"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { VendorCredentialsService } from "../notifications/vendor-credentials.service"
import { PaymentsService, STRIPE_VENDOR } from "./payments.service"

const fakeAllowed = () => env().APP_ENV !== "production" && process.env.NODE_ENV !== "production"

/** Developer Panel §2 for payments (ADR-0007 P1, P2, P13): write-only keys, provider choice, mode change workflow, health. */
@Injectable()
export class PaymentConfigService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly vendors: VendorCredentialsService,
    private readonly payments: PaymentsService,
  ) {}

  async view(): Promise<PaymentsConfigView> {
    const cfg = await this.payments.configRow()
    const creds = await this.vendors.get(STRIPE_VENDOR)
    const meta = await this.vendors.meta(STRIPE_VENDOR)
    const events = await this.db.select().from(stripeEvents).orderBy(desc(stripeEvents.receivedAt)).limit(25)
    const [by] = cfg.pendingBy ? await this.db.select({ n: users.displayName }).from(users).where(eq(users.id, cfg.pendingBy)) : []
    return {
      provider: cfg.provider, mode: cfg.mode, liveBlocked: !canEnterStripeMode("live").ok, flagEnabled: this.config.flag("payments.online.enabled"), fakeAvailable: fakeAllowed(),
      webhookUrl: `${env().PUBLIC_API_URL}/v1/webhooks/stripe`,
      credentials: { secretKey: !!creds?.secretKey, publishableKey: !!creds?.publishableKey, webhookSecret: !!creds?.webhookSecret, rotatedAt: meta?.rotatedAt.toISOString() ?? null },
      pendingModeRequest: cfg.pendingMode && cfg.pendingAt ? { mode: cfg.pendingMode, requestedBy: by?.n ?? "unknown", requestedAt: cfg.pendingAt.toISOString() } : null,
      events: events.map((e) => ({ id: e.id, type: e.type, mode: e.mode, outcome: e.outcome, error: e.error, receivedAt: e.receivedAt.toISOString(), processedAt: e.processedAt?.toISOString() ?? null })),
      ...(await this.payments.counts()),
    }
  }

  /** Write-only: merged into the stored set, encrypted at rest, never returned. Audited by key name only. */
  async setCredentials(body: StripeCredentialsBody, actor: Actor) {
    const values = Object.fromEntries(Object.entries({ secretKey: body.secretKey, publishableKey: body.publishableKey, webhookSecret: body.webhookSecret }).filter((e): e is [string, string] => !!e[1]))
    if (body.mode === "live" || Object.values(values).some((v) => /_live_/.test(v))) {
      await this.audit.record(this.db, { actorUserId: actor.userId, actorKind: "STAFF", action: "payments.live_credentials_refused", entityType: "payment_config", entityId: "stripe", after: { keys: Object.keys(values) }, ip: actor.ip })
      throw new AppError("LIVE_MODE_BLOCKED", canEnterStripeMode("live").ok ? "Live credentials are not accepted" : "Live mode is blocked: Stripe's written approval and counsel's advice are outstanding (ADR-0007 P1)")
    }
    const existing = (await this.vendors.get(STRIPE_VENDOR)) ?? {}
    await this.uow.run(async (tx) => {
      await this.vendors.set(tx, STRIPE_VENDOR, { ...existing, ...values }, actor.userId)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "payments.credentials_rotated", entityType: "payment_config", entityId: "stripe", after: { mode: "test", keys: Object.keys(values) }, ip: actor.ip })
    })
    this.payments.invalidateProvider()
    return this.view()
  }

  async setProvider(provider: PaymentProviderId, actor: Actor) {
    if (provider === "FAKE" && !fakeAllowed()) throw new AppError("FORBIDDEN", "The FAKE payment adapter can never run in production")
    const before = await this.payments.configRow()
    await this.uow.run(async (tx) => {
      await tx.insert(paymentConfig).values({ key: "stripe", provider, updatedBy: actor.userId }).onConflictDoUpdate({ target: paymentConfig.key, set: { provider, updatedBy: actor.userId, updatedAt: new Date() } })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "payments.provider_changed", entityType: "payment_config", entityId: "stripe", before: { provider: before.provider }, after: { provider }, ip: actor.ip })
    })
    this.payments.invalidateProvider()
    return this.view()
  }

  /** Step 1 of a mode change: refused outright for live; otherwise pending until an owner approves (P2). */
  async requestMode(mode: StripeMode, actor: Actor) {
    const gate = canEnterStripeMode(mode)
    if (!gate.ok) {
      await this.audit.record(this.db, { actorUserId: actor.userId, actorKind: "STAFF", action: "payments.mode_change_refused", entityType: "payment_config", entityId: "stripe", after: { requested: mode }, ip: actor.ip })
      throw new AppError("LIVE_MODE_BLOCKED", gate.reason)
    }
    const cfg = await this.payments.configRow()
    if (cfg.mode === mode) throw new AppError("INVALID_TRANSITION", `Stripe is already in ${mode} mode`)
    await this.uow.run(async (tx) => {
      await tx.update(paymentConfig).set({ pendingMode: mode, pendingBy: actor.userId, pendingAt: new Date() }).where(eq(paymentConfig.key, "stripe"))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "payments.mode_change_requested", entityType: "payment_config", entityId: "stripe", before: { mode: cfg.mode }, after: { requested: mode }, ip: actor.ip })
    })
    return this.view()
  }

  /** Step 2: a different holder of payments.mode.approve, with step-up; the gate is checked again. */
  async approveMode(actor: Actor) {
    const cfg = await this.payments.configRow()
    if (!cfg.pendingMode) throw new AppError("INVALID_TRANSITION", "There is no pending mode change")
    if (cfg.pendingBy === actor.userId) throw new AppError("FOUR_EYES_REQUIRED", "A different person must approve a mode change")
    const gate = canEnterStripeMode(cfg.pendingMode)
    if (!gate.ok) {
      await this.audit.record(this.db, { actorUserId: actor.userId, actorKind: "STAFF", action: "payments.mode_change_refused", entityType: "payment_config", entityId: "stripe", after: { requested: cfg.pendingMode }, ip: actor.ip })
      throw new AppError("LIVE_MODE_BLOCKED", gate.reason)
    }
    await this.uow.run(async (tx) => {
      await tx.update(paymentConfig).set({ mode: cfg.pendingMode!, pendingMode: null, pendingBy: null, pendingAt: null, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(paymentConfig.key, "stripe"))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "payments.mode_changed", entityType: "payment_config", entityId: "stripe", before: { mode: cfg.mode }, after: { mode: cfg.pendingMode }, ip: actor.ip })
    })
    this.payments.invalidateProvider()
    return this.view()
  }

  async health(): Promise<PaymentHealthView> {
    const { id, adapter } = await this.payments.provider()
    if (!adapter) return { ok: false, provider: id, latencyMs: 0, detail: id === "STRIPE" ? "Stripe test keys and the webhook secret are not set" : "FAKE adapter unavailable" }
    return { provider: id, ...(await adapter.health()) }
  }
}
