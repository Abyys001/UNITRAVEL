import { createHash } from "node:crypto"

import { Inject, Injectable } from "@nestjs/common"
import { and, eq } from "drizzle-orm"
import type { Redis } from "ioredis"
import { v7 as uuidv7 } from "uuid"

import { type PublicTrackView, type TrackItem, type TrackLookupBody, type TrackLookupResult, type TrackVerifyBody } from "@unitravel/contracts"
import { cargoRequests, type Db, flightRequests, requestStatusHistory, serviceRequests, userIdentities } from "@unitravel/db"
import { normaliseReference } from "@unitravel/domain"

import { constantTimeEqual, encryptField, otpHash, randomDigits } from "../../core/crypto"
import { AppError } from "../../core/errors"
import { ipPrefix, RateLimiter } from "../../core/http/rate-limit"
import { DB, REDIS } from "../../core/infra.module"
import { CargoService } from "../cargo/cargo.service"
import { ConfigService } from "../config/config.service"
import { normaliseIdentity } from "../identity/otp.service"
import { PowService } from "../identity/pow.service"
import { InvoicesService } from "../invoices/invoices.service"
import { OutboxService } from "../platform/outbox.service"
import { RequestsService } from "../requests/requests.service"
import { SERVICE_STATUS_LABELS } from "../services/service-labels"
import { ServicesService } from "../services/services.service"

export interface TrackCtx { ip: string; locale: "en" | "fa"; requestId?: string }
type Kind = PublicTrackView["kind"]

/**
 * Purchase tracking (spec section 4.5). Signed in: one list over flights, cargo, services and invoices, own rows only.
 * Signed out: reference + phone. Lookup never reveals whether the pair matched (always 202, same work and same limits); a
 * code goes by SMS to the phone on record only when it did. Verify answers with the status timeline alone: no names,
 * passport data, amounts or documents.
 */
@Injectable()
export class TrackService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly limiter: RateLimiter,
    private readonly pow: PowService,
    private readonly outbox: OutboxService,
    private readonly requests: RequestsService,
    private readonly cargo: CargoService,
    private readonly services: ServicesService,
    private readonly invoices: InvoicesService,
  ) {}

  // ---------------- signed in ----------------

  async mine(userId: string, locale: "en" | "fa"): Promise<TrackItem[]> {
    const [flights, cargo, services, billing] = await Promise.all([
      this.requests.customerList(userId, locale), this.cargo.customerList(userId, locale), this.services.customerList(userId, locale), this.invoices.billing(userId),
    ])
    const items: TrackItem[] = [
      ...flights.map((f) => ({ kind: "FLIGHT" as const, ref: f.ref, status: f.status, statusLabel: f.statusLabel, title: f.routeLabel, serviceType: null, updatedAt: f.updatedAt })),
      ...cargo.map((c) => ({ kind: "CARGO" as const, ref: c.ref, status: c.status, statusLabel: c.statusLabel, title: c.routeLabel, serviceType: null, updatedAt: c.updatedAt })),
      ...services.map((s) => ({ kind: "SERVICE" as const, ref: s.ref, status: s.status, statusLabel: SERVICE_STATUS_LABELS[s.status][locale], title: s.title, serviceType: s.type, updatedAt: s.updatedAt })),
      ...billing.invoices.map((i) => ({ kind: "INVOICE" as const, ref: i.number, status: i.status, statusLabel: i.status, title: i.requestRef, serviceType: null, updatedAt: [i.issuedAt, i.paidAt, i.cancelledAt].filter(Boolean).sort().pop()! })),
    ]
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  // ---------------- signed out ----------------

  private key(ref: string, phone: string) {
    return `track:otp:${createHash("sha256").update(`${ref}|${phone}`).digest("hex")}`
  }

  /** The contact phone on record for a reference, or null. Flights and services keep a snapshot; cargo keeps the shipper's verified identity. */
  private async phoneOnRecord(ref: string): Promise<{ kind: Kind; id: string; phone: string; locale: "en" | "fa" } | null> {
    if (ref.startsWith("UT-F-")) {
      const [r] = await this.db.select().from(flightRequests).where(eq(flightRequests.ref, ref))
      return r ? { kind: "FLIGHT", id: r.id, phone: r.contactPhoneSnapshot, locale: r.submittedLocale } : null
    }
    if (ref.startsWith("UT-S-")) {
      const [r] = await this.db.select().from(serviceRequests).where(eq(serviceRequests.ref, ref))
      return r ? { kind: "SERVICE", id: r.id, phone: r.contactPhoneSnapshot, locale: r.submittedLocale } : null
    }
    if (ref.startsWith("UT-C-")) {
      const [r] = await this.db.select({ id: cargoRequests.id, phone: userIdentities.valueNormalised }).from(cargoRequests).innerJoin(userIdentities, eq(userIdentities.id, cargoRequests.shipperIdentityId)).where(and(eq(cargoRequests.ref, ref)))
      return r ? { kind: "CARGO", id: r.id, phone: r.phone, locale: "en" } : null
    }
    return null
  }

  async lookup(body: TrackLookupBody, ctx: TrackCtx): Promise<TrackLookupResult> {
    const auth = this.config.get("AUTH")
    const phone = normaliseIdentity("PHONE", body.phone)
    if (!auth.allowedCountries.includes(phone.country!)) throw new AppError("DESTINATION_NOT_ALLOWED", "Codes cannot be sent to this country")
    // The same layered limits as OTP sign-in, spent before and independently of the match (separate counters: an
    // attacker must not be able to burn a victim's sign-in budget through this public route).
    const recentFromIp = await this.limiter.count("track-ip-10m", ctx.ip, 600)
    if (auth.challengeAfterRequestsPerIp10Min > 0 && recentFromIp >= auth.challengeAfterRequestsPerIp10Min && !(await this.pow.verify(body.challenge))) {
      throw new AppError("CHALLENGE_REQUIRED", "Please complete the check", undefined, { challenge: this.pow.create() })
    }
    if ((await this.redis.set(`track:cooldown:${phone.value}`, "1", "EX", auth.resendCooldownSeconds, "NX")) !== "OK") {
      throw new AppError("RATE_LIMITED", "Please wait before requesting another code", undefined, { retryAfter: auth.resendCooldownSeconds })
    }
    await this.limiter.enforce("track-number-1h", phone.value, auth.maxPerHour, 3600)
    await this.limiter.enforce("track-number-1d", phone.value, auth.maxPerDay, 86400)
    await this.limiter.enforce("track-ip-1h", ctx.ip, 20, 3600)
    await this.limiter.enforce("track-net-1h", ipPrefix(ctx.ip), 60, 3600)
    await this.limiter.enforce("track-device-1h", body.deviceId, 10, 3600)
    await this.limiter.hit("track-ip-10m", ctx.ip, 600)

    const ref = normaliseReference(body.ref)
    const rec = ref ? await this.phoneOnRecord(ref) : null
    if (ref && rec && rec.phone === phone.value) {
      const challengeId = uuidv7()
      const code = randomDigits(auth.otpLength)
      await this.redis.set(this.key(ref, phone.value), JSON.stringify({ hash: otpHash(code, challengeId), challengeId, attempts: 0, max: auth.otpMaxAttempts }), "EX", auth.otpTtlSeconds)
      // The SMS worker only needs the payload; there is no otp_challenges row (that table is for sign-in) so its status update is a no-op.
      await this.outbox.add(this.db, { aggregateType: "otp", aggregateId: challengeId, eventType: "auth.otp_requested", payload: { challengeId, channel: "PHONE", destination: phone.value, code: encryptField(code).ciphertext, locale: rec.locale, voice: false }, dedupeKey: `track-otp:${challengeId}` })
    }
    return { accepted: true }
  }

  async verify(body: TrackVerifyBody, ctx: TrackCtx): Promise<PublicTrackView> {
    const auth = this.config.get("AUTH")
    await this.limiter.enforce("track-verify-ip", ctx.ip, auth.verifyIpLimitPer10Min, 600)
    const phone = normaliseIdentity("PHONE", body.phone).value
    const ref = normaliseReference(body.ref)
    const raw = ref ? await this.redis.get(this.key(ref, phone)) : null
    // One answer for every failure (unknown pair, expired, locked, wrong): the code is the only thing a caller can learn about.
    if (!ref || !raw) throw new AppError("OTP_INVALID")
    const st = JSON.parse(raw) as { hash: string; challengeId: string; attempts: number; max: number }
    if (st.attempts >= st.max) throw new AppError("OTP_INVALID")
    st.attempts += 1
    const ttl = await this.redis.ttl(this.key(ref, phone))
    await this.redis.set(this.key(ref, phone), JSON.stringify(st), "EX", Math.max(1, ttl))
    if (!constantTimeEqual(st.hash, otpHash(body.code, st.challengeId))) throw new AppError("OTP_INVALID")
    await this.redis.del(this.key(ref, phone))
    const rec = await this.phoneOnRecord(ref)
    if (!rec) throw new AppError("OTP_INVALID")
    return this.view(ref, rec.kind, rec.id)
  }

  private async view(ref: string, kind: Kind, id: string): Promise<PublicTrackView> {
    let status: string
    let serviceType: PublicTrackView["serviceType"] = null
    if (kind === "FLIGHT") status = (await this.db.select({ s: flightRequests.status }).from(flightRequests).where(eq(flightRequests.id, id)))[0]!.s
    else if (kind === "CARGO") status = (await this.db.select({ s: cargoRequests.status }).from(cargoRequests).where(eq(cargoRequests.id, id)))[0]!.s
    else { const [r] = await this.db.select({ s: serviceRequests.status, t: serviceRequests.type }).from(serviceRequests).where(eq(serviceRequests.id, id)); status = r!.s; serviceType = r!.t }
    const hist = await this.db.select().from(requestStatusHistory).where(and(eq(requestStatusHistory.requestType, kind), eq(requestStatusHistory.requestId, id))).orderBy(requestStatusHistory.createdAt)
    // A compliance hold is internal; to an outsider it reads as the state before it.
    const mask = (s: string) => (s === "COMPLIANCE_HOLD" ? "SUBMITTED" : s)
    return {
      ref, kind, serviceType, status: mask(status),
      timeline: hist.filter((h) => h.toStatus !== "COMPLIANCE_HOLD" && h.fromStatus !== "COMPLIANCE_HOLD").map((h) => ({ at: h.createdAt.toISOString(), status: mask(h.toStatus) })),
    }
  }
}
