import { Inject, Injectable, Logger } from "@nestjs/common"
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import { DEFAULT_NOTIFICATION_MATRIX, INTERNATIONAL_SMS_PROVIDERS, type NotificationEvent, type NotificationRule } from "@unitravel/contracts"
import {
  airports, cities, countries, type Db, devices, notificationDeliveries, notifications, notificationTemplates, otpChallenges, shortLinks, smsRoutes, userIdentities, users,
} from "@unitravel/db"

import { decryptField, randomToken } from "../../core/crypto"
import { env } from "../../core/env"
import { DB, REDIS } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { ConfigService } from "../config/config.service"
import { OutboxService } from "../platform/outbox.service"
import { ChannelError, EmailSender, PushProviders, SmsProviders } from "./channels"
import { eventUuid, localDateVars, quietHoursDelay, renderTemplate } from "./format"
import { localisedVars, type NamePair } from "./localise"
import { degradedRoutes, ROUTE_HEALTH } from "./route-health"

export type Audience = NotificationRule["audience"]

export interface NotifyInput {
  eventType: NotificationEvent
  eventId: string
  audience: Audience
  userIds: string[]
  /** Template variables. Keys ending in `_at` hold ISO timestamps and are formatted per recipient. */
  vars: Record<string, string | number | undefined>
  data?: Record<string, unknown>
  /** Used for the "one escalation SMS per request per hour" throttle. */
  requestKey?: string
  /** Deep link path, turned into a short link on Uni Travel's own domain for SMS. */
  linkPath?: string
  /** Data-only push to trigger a client refresh (permission change). */
  silentPush?: boolean
  /**
   * Quotations and invoices (ADR-0006 C8): always inbox and email whatever the stored matrix says, so databases that
   * predate this phase need no matrix migration; with no verified email the same event goes by SMS (decision 6).
   */
  documentDelivery?: boolean
}

interface Recipient {
  id: string
  locale: "en" | "fa"
  tz: string
  calendar: "GREGORIAN" | "JALALI"
  prefs: Record<string, boolean>
  phone: string | null
  email: string | null
}

/**
 * The notification service (ch. 17): the in-app inbox is the system of record; push where it works; SMS for
 * anything a customer must not miss, routed by country prefix; email for copies and staff digests.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger("Notify")

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly queues: Queues,
    private readonly sms: SmsProviders,
    private readonly push: PushProviders,
    private readonly email: EmailSender,
    private readonly outbox: OutboxService,
  ) {}

  private async recipient(userId: string): Promise<Recipient | null> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId))
    if (!u || u.status !== "ACTIVE") return null
    const ids = await this.db.select().from(userIdentities).where(and(eq(userIdentities.userId, userId), isNull(userIdentities.revokedAt)))
    const phone = ids.find((i) => i.type === "PHONE" && i.verifiedAt && i.isPrimary) ?? ids.find((i) => i.type === "PHONE" && i.verifiedAt)
    const email = ids.find((i) => i.type === "EMAIL" && i.verifiedAt)
    return { id: u.id, locale: u.preferredLocale, tz: u.timezone, calendar: u.calendar, prefs: u.notificationPrefs, phone: phone?.valueNormalised ?? null, email: email?.valueNormalised ?? null }
  }

  private async template(eventType: string, channel: "INBOX" | "PUSH" | "SMS" | "EMAIL", locale: "en" | "fa") {
    const rows = await this.db.select().from(notificationTemplates).where(and(eq(notificationTemplates.eventType, eventType), eq(notificationTemplates.channel, channel), eq(notificationTemplates.active, true)))
    return rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === "en") ?? null
  }

  private varsFor(r: Recipient, vars: NotifyInput["vars"]): Record<string, string | number | undefined> {
    const out: Record<string, string | number | undefined> = {}
    for (const [k, v] of Object.entries(vars)) {
      if (k.endsWith("_at") && typeof v === "string") Object.assign(out, localDateVars(k, v, r))
      out[k] = v
    }
    // "<name>_fa" variables replace "<name>" for Persian recipients (localised status labels).
    if (r.locale === "fa") for (const [k, v] of Object.entries(vars)) if (k.endsWith("_fa") && v !== undefined) out[k.slice(0, -3)] = v
    if (r.locale === "en") for (const [k, v] of Object.entries(vars)) if (k.endsWith("_en") && v !== undefined) out[k.slice(0, -3)] = v
    return out
  }

  private placeNames?: { at: number; names: Map<string, NamePair> }

  /** English and Persian names of cities, airports and countries, keyed by lower-cased name in either language. */
  private async nameMap(): Promise<Map<string, NamePair>> {
    if (this.placeNames && Date.now() - this.placeNames.at < 600_000) return this.placeNames.names
    const [c, a, k] = await Promise.all([this.db.select({ en: cities.nameEn, fa: cities.nameFa }).from(cities), this.db.select({ en: airports.nameEn, fa: airports.nameFa }).from(airports), this.db.select({ en: countries.nameEn, fa: countries.nameFa }).from(countries)])
    const names = new Map<string, NamePair>()
    for (const row of [...a, ...k, ...c]) for (const key of [row.en, row.fa]) names.set(key.toLowerCase(), row)
    this.placeNames = { at: Date.now(), names }
    return names
  }

  /** Raw variables plus per-language variants of route, client, decision and trigger. */
  private async withLocalised(vars: NotifyInput["vars"]): Promise<NotifyInput["vars"]> {
    const names = typeof vars.route === "string" && vars.route ? await this.nameMap() : new Map<string, NamePair>()
    return { ...vars, ...localisedVars(vars, names) }
  }

  async shortLink(path: string): Promise<string> {
    const code = randomToken(6).replace(/[-_]/g, "x").slice(0, 8)
    await this.db.insert(shortLinks).values({ code, target: path, expiresAt: new Date(Date.now() + 90 * 86400_000) })
    return `${env().PUBLIC_WEB_URL}/s/${code}`
  }

  async resolveShortLink(code: string): Promise<string | null> {
    const [l] = await this.db.select().from(shortLinks).where(eq(shortLinks.code, code))
    return l && (!l.expiresAt || l.expiresAt > new Date()) ? l.target : null
  }

  private async workingDevices(userId: string) {
    const fresh = this.config.get("NOTIFICATION_MATRIX").pushTokenFreshDays * 86400_000
    const rows = await this.db.select().from(devices).where(and(eq(devices.userId, userId), isNull(devices.disabledAt)))
    return rows.filter((d) => (d.lastSuccessAt ?? d.createdAt).getTime() > Date.now() - fresh)
  }

  /** Delivery decision for one notification to many users (Figure 17.1). Idempotent per (event, recipient). */
  async notify(input: NotifyInput): Promise<void> {
    const matrix = this.config.get("NOTIFICATION_MATRIX")
    const find = (rules: NotificationRule[]) => rules.find((r) => r.event === input.eventType && r.audience === input.audience)
    // An event added after the matrix was stored (service_request.* in ADR-0015) falls back to the shipped default rule.
    const stored: NotificationRule = find(matrix.rules) ?? find(DEFAULT_NOTIFICATION_MATRIX.rules)
      ?? { event: input.eventType, audience: input.audience, channels: ["INBOX"], sms: "NONE", critical: false, locked: false }
    const rule: NotificationRule = input.documentDelivery ? { ...stored, channels: [...new Set([...stored.channels, "INBOX" as const, "EMAIL" as const])] } : stored
    const link = input.linkPath ? await this.shortLink(input.linkPath) : undefined
    for (const userId of [...new Set(input.userIds)]) {
      const r = await this.recipient(userId)
      if (!r) continue
      const vars = this.varsFor(r, await this.withLocalised({ ...input.vars, link: link ?? "" }))
      const inboxT = await this.template(input.eventType, "INBOX", r.locale)
      const title = renderTemplate(inboxT?.title ?? input.eventType, vars)
      const body = renderTemplate(inboxT?.body ?? "", vars)
      // 1. Always write the inbox row first; the dedupe key makes retries harmless.
      const [n] = await this.db.insert(notifications).values({
        userId, eventType: input.eventType, eventId: eventUuid(input.eventId), title, body, critical: rule.critical,
        data: { ...input.data, linkPath: input.linkPath, requestKey: input.requestKey, vars }, dedupeKey: `${input.eventId}:${userId}:${input.eventType}:${input.audience}`,
      }).onConflictDoNothing().returning()
      if (!n) continue
      await this.redis.publish(`inbox.${userId}`, JSON.stringify({ id: n.id }))

      // 2. Preferences and quiet hours apply only to non-critical events; security/critical cannot be switched off.
      const allowed = (ch: string) => rule.critical || rule.locked || r.prefs[ch] !== false
      const defer = rule.critical ? 0 : quietHoursDelay(r.tz, matrix.quietHours)
      const devs = await this.workingDevices(userId)

      if ((rule.channels.includes("PUSH") || input.silentPush) && devs.length > 0 && allowed("PUSH")) {
        await this.queueDelivery(n.id, "PUSH", "notify.push", input.silentPush ? 0 : defer, { silent: !!input.silentPush })
      }
      if (rule.channels.includes("EMAIL") && r.email && allowed("EMAIL")) await this.queueDelivery(n.id, "EMAIL", "notify.email", defer)
      else if (input.documentDelivery && !r.email && r.phone && allowed("SMS")) await this.queueDelivery(n.id, "SMS", "notify.sms", defer)
      if (rule.channels.includes("SMS") && r.phone && allowed("SMS")) {
        // +98 users without a working push token get escalation immediately (ch. 17.3 rule 4).
        const iranNoPush = r.phone.startsWith("+98") && devs.length === 0
        if (rule.sms === "IMMEDIATE" || (rule.sms === "ESCALATING" && iranNoPush)) await this.queueDelivery(n.id, "SMS", "notify.sms", defer)
        else if (rule.sms === "ESCALATING") {
          await this.queues.get("notify.escalate").add("escalate", { notificationId: n.id }, { jobId: `esc--${n.id}`, delay: Math.max(defer, (rule.escalateAfterMinutes ?? 30) * 60_000) })
        }
      }
    }
  }

  private async queueDelivery(notificationId: string, channel: "PUSH" | "SMS" | "EMAIL", queue: "notify.push" | "notify.sms" | "notify.email", delay: number, extra: Record<string, unknown> = {}) {
    const [d] = await this.db.insert(notificationDeliveries).values({ notificationId, channel, status: "QUEUED", scheduledFor: delay ? new Date(Date.now() + delay) : null }).onConflictDoNothing().returning()
    if (!d) return
    await this.queues.get(queue).add(channel, { deliveryId: d.id, notificationId, ...extra }, { jobId: `${queue}--${d.id}`, delay })
  }

  // ---------------- channel workers ----------------

  async processEscalation(notificationId: string) {
    const [n] = await this.db.select().from(notifications).where(eq(notifications.id, notificationId))
    if (!n || n.readAt) return "read"
    await this.queueDelivery(n.id, "SMS", "notify.sms", 0)
    return "escalated"
  }

  async processSms(deliveryId: string) {
    const [d] = await this.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, deliveryId))
    if (!d || d.status === "SENT" || d.status === "DELIVERED") return
    const [n] = await this.db.select().from(notifications).where(eq(notifications.id, d.notificationId))
    const r = n ? await this.recipient(n.userId) : null
    if (!n || !r?.phone) return this.markDelivery(deliveryId, "SKIPPED", null, "No verified phone")
    const matrix = this.config.get("NOTIFICATION_MATRIX")
    // Throttles (ch. 17.3 rule 5): one escalation SMS per request per hour, daily cap per user (OTP excluded).
    const requestKey = (n.data as { requestKey?: string }).requestKey
    if (requestKey && !n.critical) {
      const ok = await this.redis.set(`sms:throttle:${requestKey}:${r.id}`, "1", "EX", matrix.escalationThrottleMinutes * 60, "NX")
      if (!ok) return this.markDelivery(deliveryId, "SKIPPED", null, "Throttled: one SMS per request per hour")
    }
    const day = new Date().toISOString().slice(0, 10)
    const count = await this.redis.incr(`sms:daily:${r.id}:${day}`)
    await this.redis.expire(`sms:daily:${r.id}:${day}`, 36 * 3600)
    if (count > matrix.smsDailyCap) return this.markDelivery(deliveryId, "SKIPPED", null, "Daily SMS cap reached")
    const t = await this.template(n.eventType, "SMS", r.locale)
    const vars = (n.data as { vars?: Record<string, string> }).vars ?? {}
    const body = renderTemplate(t?.body ?? n.title, vars)
    try {
      const sent = await this.routeSms(r.phone, { to: r.phone, body })
      await this.markDelivery(deliveryId, "SENT", sent.provider, null, sent.messageId, r.phone)
    } catch (err) {
      await this.markDelivery(deliveryId, "FAILED", null, String(err))
      throw err
    }
  }

  /** Route by country prefix with ordered fallback (ch. 8.1); +98 never goes through international providers. */
  async routeSms(phone: string, m: { to: string; body: string; templateId?: string | null; tokens?: string[]; otp?: boolean; voice?: boolean }) {
    const routes = await this.db.select().from(smsRoutes).where(eq(smsRoutes.enabled, true))
    const route = routes.filter((r) => r.prefix !== "default" && phone.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0] ?? routes.find((r) => r.prefix === "default")
    // The route table is validated on save, but +98 must not depend on that: a disabled +98 route would otherwise fall to "default".
    const providers = (route?.providers ?? []).filter((p) => !(phone.startsWith("+98") && INTERNATIONAL_SMS_PROVIDERS.includes(p)))
    const errors: string[] = []
    for (const p of providers) {
      if (!(await this.sms.available(p))) { errors.push(`${p}: not configured`); continue }
      try {
        const r = await this.sms.send(p, m)
        await this.recordRoute(route?.prefix ?? "default", p, true)
        return r
      } catch (err) {
        errors.push(`${p}: ${(err as Error).message}`)
        await this.recordRoute(route?.prefix ?? "default", p, false)
        if (err instanceof ChannelError && !err.permanent) continue
      }
    }
    if (env().APP_ENV !== "production") return this.sms.send("console", m)
    throw new ChannelError(`All providers failed for ${route?.prefix}: ${errors.join("; ")}`)
  }

  private async recordRoute(prefix: string, provider: string, ok: boolean) {
    const k = `sms:route:${prefix}:${provider}:${new Date().toISOString().slice(0, 13)}`
    await this.redis.hincrby(k, ok ? "ok" : "fail", 1)
    await this.redis.expire(k, 26 * 3600)
  }

  async routeStats(prefix: string, provider: string): Promise<{ ok: number; fail: number }> {
    let ok = 0, fail = 0
    for (let h = 0; h < 24; h++) {
      const k = `sms:route:${prefix}:${provider}:${new Date(Date.now() - h * 3600_000).toISOString().slice(0, 13)}`
      const v = await this.redis.hgetall(k)
      ok += Number(v.ok ?? 0); fail += Number(v.fail ?? 0)
    }
    return { ok, fail }
  }

  async processPush(deliveryId: string, silent: boolean) {
    const [d] = await this.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, deliveryId))
    if (!d || d.status === "SENT") return
    const [n] = await this.db.select().from(notifications).where(eq(notifications.id, d.notificationId))
    if (!n) return
    const devs = await this.workingDevices(n.userId)
    let sent = 0
    let provider: string | null = null
    for (const dev of devs) {
      try {
        const r = await this.push.send(dev.pushProvider, { token: dev.pushToken, title: n.title, body: n.body, data: { notificationId: n.id, ...((n.data as { linkPath?: string }).linkPath ? { link: (n.data as { linkPath?: string }).linkPath } : {}) }, silent })
        if ((r as { invalidToken?: boolean }).invalidToken) { await this.db.update(devices).set({ disabledAt: new Date() }).where(eq(devices.id, dev.id)); continue }
        sent++; provider = r.provider
        await this.db.update(devices).set({ lastSuccessAt: new Date() }).where(eq(devices.id, dev.id))
      } catch (err) {
        this.log.warn({ err: String(err) }, "push failed")
      }
    }
    await this.markDelivery(deliveryId, sent > 0 ? "SENT" : "FAILED", provider, sent > 0 ? null : "No device accepted the push")
  }

  async processEmail(deliveryId: string) {
    const [d] = await this.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, deliveryId))
    if (!d || d.status === "SENT") return
    const [n] = await this.db.select().from(notifications).where(eq(notifications.id, d.notificationId))
    const r = n ? await this.recipient(n.userId) : null
    if (!n || !r?.email) return this.markDelivery(deliveryId, "SKIPPED", null, "No verified email")
    const t = await this.template(n.eventType, "EMAIL", r.locale)
    const vars = (n.data as { vars?: Record<string, string> }).vars ?? {}
    try {
      const sent = await this.email.send(r.email, renderTemplate(t?.title ?? n.title, vars), renderTemplate(t?.body ?? n.body, vars), r.locale)
      await this.markDelivery(deliveryId, "SENT", sent.provider, null, sent.messageId, r.email)
    } catch (err) {
      await this.markDelivery(deliveryId, "FAILED", null, String(err))
      throw err
    }
  }

  /** OTP delivery: high-priority, via the SMS route for that country, pre-approved template (ch. 25.1 steps 6–8). */
  async sendOtp(p: { challengeId: string; channel: "PHONE" | "EMAIL"; destination: string; code: string; locale: "en" | "fa"; voice?: boolean }) {
    const code = decryptField(p.code)
    const t = await this.template("auth.otp", p.channel === "PHONE" ? "SMS" : "EMAIL", p.locale)
    const body = renderTemplate(t?.body ?? "Your Uni Travel code is {code}", { code })
    try {
      let sent
      if (p.channel === "EMAIL") sent = await this.email.send(p.destination, renderTemplate(t?.title || "Your Uni Travel code", { code }), body, p.locale)
      else sent = await this.routeSms(p.destination, { to: p.destination, body, templateId: t?.providerTemplateId, tokens: [code], otp: true, voice: p.voice })
      await this.db.update(otpChallenges).set({ deliveryStatus: "SENT", route: sent.provider, providerMessageId: sent.messageId }).where(eq(otpChallenges.id, p.challengeId))
    } catch (err) {
      await this.db.update(otpChallenges).set({ deliveryStatus: "FAILED" }).where(eq(otpChallenges.id, p.challengeId))
      throw err
    }
  }

  private async markDelivery(id: string, status: "SENT" | "FAILED" | "SKIPPED" | "DELIVERED" | "UNDELIVERABLE", provider: string | null, error: string | null, providerMessageId?: string, destination?: string) {
    await this.db.update(notificationDeliveries).set({
      status, provider, error, providerMessageId, destination: destination ? `${destination.slice(0, 4)}••${destination.slice(-2)}` : undefined,
      attempts: sql`${notificationDeliveries.attempts} + 1`, sentAt: status === "SENT" ? new Date() : undefined,
    }).where(eq(notificationDeliveries.id, id))
  }

  /** Delivery reports from SMS providers (ch. 17.5). */
  async deliveryReport(provider: string, messageId: string, status: "DELIVERED" | "FAILED" | "UNDELIVERABLE") {
    await this.db.update(notificationDeliveries).set({ status, deliveredAt: status === "DELIVERED" ? new Date() : null }).where(and(eq(notificationDeliveries.provider, provider), eq(notificationDeliveries.providerMessageId, messageId)))
    await this.db.update(otpChallenges).set({ deliveryStatus: status }).where(eq(otpChallenges.providerMessageId, messageId))
  }

  // ---------------- inbox ----------------

  async inbox(userId: string, limit: number, cursor?: string, locale?: "en" | "fa") {
    const rows = await this.db.select().from(notifications).where(and(eq(notifications.userId, userId), cursor ? lt(notifications.createdAt, new Date(cursor)) : undefined)).orderBy(desc(notifications.createdAt)).limit(limit + 1)
    const unread = await this.db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    const r = locale ? await this.recipient(userId) : null
    const templates = new Map<string, Awaited<ReturnType<NotificationsService["template"]>>>()
    // Rows keep their rendered text; with `locale` we re-render from the stored vars so /fa shows Persian regardless of the locale at creation.
    const render = async (n: typeof rows[number]) => {
      const vars = (n.data as { vars?: Record<string, string | number | undefined> }).vars
      if (!locale || !r || !vars) return { title: n.title, body: n.body }
      if (!templates.has(`${n.eventType}:${locale}`)) templates.set(`${n.eventType}:${locale}`, await this.template(n.eventType, "INBOX", locale))
      const t = templates.get(`${n.eventType}:${locale}`)
      if (!t || t.locale !== locale) return { title: n.title, body: n.body }
      const fresh = Object.fromEntries(Object.entries(vars).filter(([k]) => !k.endsWith("_local")))
      const v = this.varsFor({ ...r, locale }, fresh as NotifyInput["vars"])
      return { title: renderTemplate(t.title, v), body: renderTemplate(t.body, v) }
    }
    const page = rows.slice(0, limit)
    const texts = await Promise.all(page.map(render))
    return {
      items: page.map((n, i) => ({ id: n.id, eventType: n.eventType, title: texts[i]!.title, body: texts[i]!.body, data: { linkPath: (n.data as { linkPath?: string }).linkPath }, critical: n.critical, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })),
      nextCursor: rows.length > limit ? rows[limit - 1]!.createdAt.toISOString() : null,
      unread: unread[0]?.n ?? 0,
    }
  }

  async markRead(userId: string, ids?: string[], all?: boolean) {
    const where = all ? and(eq(notifications.userId, userId), isNull(notifications.readAt)) : and(eq(notifications.userId, userId), inArray(notifications.id, ids ?? []))
    await this.db.update(notifications).set({ readAt: new Date() }).where(where)
  }

  /** Read receipts for requests: messages and notifications about a request count as read when the customer opens it. */
  async markRequestRead(userId: string, requestKey: string) {
    await this.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt), sql`${notifications.data}->>'requestKey' = ${requestKey}`))
  }

  async deliveryRate(provider: string, since: Date) {
    const rows = await this.db.select({ status: notificationDeliveries.status, n: sql<number>`count(*)::int` }).from(notificationDeliveries).where(and(eq(notificationDeliveries.provider, provider), gte(notificationDeliveries.createdAt, since))).groupBy(notificationDeliveries.status)
    return Object.fromEntries(rows.map((r) => [r.status, r.n]))
  }

  /** Repeatable check (ch. 30.7): emits notification.route_degraded at most once per route per hour. */
  async checkRouteHealth() {
    const since = new Date(Date.now() - ROUTE_HEALTH.windowMinutes * 60_000)
    const rows = await this.db.select({ route: notificationDeliveries.provider, status: notificationDeliveries.status, n: sql<number>`count(*)::int` }).from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.channel, "SMS"), gte(notificationDeliveries.createdAt, since), sql`${notificationDeliveries.provider} is not null`))
      .groupBy(notificationDeliveries.provider, notificationDeliveries.status)
    const degraded = degradedRoutes(rows.map((r) => ({ route: r.route!, status: r.status, n: r.n })))
    const emitted: string[] = []
    for (const d of degraded) {
      const key = `sms:route-degraded:${d.route}`
      if ((await this.redis.set(key, "1", "EX", ROUTE_HEALTH.alertTtlSeconds, "NX")) !== "OK") continue
      try {
        await this.outbox.add(this.db, { aggregateType: "sms_route", aggregateId: d.route, eventType: "notification.route_degraded", payload: { route: d.route, rate: d.rate, sample: d.sample, windowMinutes: ROUTE_HEALTH.windowMinutes } })
      } catch (err) {
        await this.redis.del(key)
        throw err
      }
      emitted.push(d.route)
    }
    return { degraded: degraded.length, emitted }
  }
}
