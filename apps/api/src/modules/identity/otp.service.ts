import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, gte, isNull } from "drizzle-orm"
import type { Redis } from "ioredis"
import { parsePhoneNumberFromString } from "libphonenumber-js/max"
import { v7 as uuidv7 } from "uuid"

import type { OtpRequestBody, OtpVerifyBody, TestSignInBody } from "@unitravel/contracts"
import { customerProfiles, type Db, mfaFactors, otpChallenges, roles, type Tx, userIdentities, userRoles, users } from "@unitravel/db"
import { normaliseDigits } from "@unitravel/domain"

import { constantTimeEqual, encryptField, otpHash, randomDigits } from "../../core/crypto"
import { env, testSignInForStaff } from "../../core/env"
import { AppError } from "../../core/errors"
import { DB, REDIS } from "../../core/infra.module"
import { ipKey, ipPrefix, RateLimiter } from "../../core/http/rate-limit"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { OutboxService } from "../platform/outbox.service"
import { PowService } from "./pow.service"
import { type IssuedTokens, SessionsService } from "./sessions.service"

export interface Normalised { type: "PHONE" | "EMAIL"; value: string; country?: string }

const BLOCKED_TYPES = new Set(["PREMIUM_RATE", "SHARED_COST", "VOIP", "UAN", "PAGER"])

/** E.164 on the server; Iranian numbers may be typed locally (0912… → +98912…) and in Persian digits (ch. 11.2). */
export function normaliseIdentity(channel: "PHONE" | "EMAIL", raw: string, defaultCountry?: string): Normalised {
  const value = normaliseDigits(raw.trim())
  if (channel === "EMAIL") {
    const email = value.toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new AppError("VALIDATION_FAILED", "Invalid email address", [{ path: "value", code: "INVALID_EMAIL" }])
    return { type: "EMAIL", value: email }
  }
  const guessCountry = (defaultCountry ?? (/^09\d{9}$/.test(value.replace(/\s/g, "")) ? "IR" : "GB")) as never
  const p = parsePhoneNumberFromString(value, guessCountry)
  // Ofcom's drama range (+44 7700 900xxx) is never assigned to real people; it serves as synthetic test numbers
  // outside production (ch. 32.6) and is refused in production.
  const testNumber = !!p && env().APP_ENV !== "production" && /^\+447700900\d{3}$/.test(p.number)
  if (!p || (!p.isValid() && !testNumber)) throw new AppError("VALIDATION_FAILED", "Invalid phone number", [{ path: "value", code: "INVALID_PHONE" }])
  const t = testNumber ? "MOBILE" : p.getType()
  if (t && BLOCKED_TYPES.has(t)) throw new AppError("DESTINATION_NOT_ALLOWED", "This number type cannot receive codes")
  return { type: "PHONE", value: p.number, country: testNumber ? "GB" : p.country }
}

/**
 * Counts one verification attempt atomically. Returns nil when the challenge is gone, else
 * {outcome, hash, attempts, max} with outcome LOCKED (no attempts left), UNBOUND (other device or network) or CHECK.
 */
const OTP_ATTEMPT_LUA = `
local raw = redis.call("GET", KEYS[1])
if not raw then return nil end
local st = cjson.decode(raw)
if st.attempts >= st.max then return {"LOCKED", "", st.attempts, st.max} end
if st.deviceId ~= ARGV[1] or st.ipPrefix ~= ARGV[2] then return {"UNBOUND", "", st.attempts, st.max} end
st.attempts = st.attempts + 1
redis.call("SET", KEYS[1], cjson.encode(st), "KEEPTTL")
return {"CHECK", st.hash, st.attempts, st.max}
`

export interface RequestCtx { ip: string; userAgent?: string; requestId?: string; locale: "en" | "fa"; userId?: string }

@Injectable()
export class OtpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly limiter: RateLimiter,
    private readonly pow: PowService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
    private readonly access: AccessService,
  ) {}

  async request(body: OtpRequestBody, ctx: RequestCtx) {
    const auth = this.config.get("AUTH")
    const id = normaliseIdentity(body.channel, body.value, body.defaultCountry)
    if (id.type === "EMAIL" && !auth.emailSignIn) throw new AppError("FEATURE_DISABLED", "Email sign-in is disabled")
    if (id.type === "PHONE" && !auth.allowedCountries.includes(id.country!)) throw new AppError("DESTINATION_NOT_ALLOWED", "Codes cannot be sent to this country")
    if (id.type === "PHONE" && (await this.redis.get(`otp:blocked_prefix:${id.value.slice(0, 6)}`))) throw new AppError("DESTINATION_NOT_ALLOWED", "Temporarily unavailable for this number range")
    if ((body.purpose === "VERIFY_PHONE" || body.purpose === "VERIFY_EMAIL" || body.purpose === "STEP_UP") && !ctx.userId) throw new AppError("UNAUTHENTICATED")

    // Layered abuse controls (ch. 25.1): per IP challenge threshold, then sliding windows per number/IP/network/device/country.
    const recentFromIp = await this.limiter.count("otp-ip-10m", ctx.ip, 600)
    if (auth.challengeAfterRequestsPerIp10Min > 0 && recentFromIp >= auth.challengeAfterRequestsPerIp10Min && !(await this.pow.verify(body.challenge))) {
      throw new AppError("CHALLENGE_REQUIRED", "Please complete the check", undefined, { challenge: this.pow.create() })
    }
    const lastHour = await this.db.select().from(otpChallenges).where(and(eq(otpChallenges.identityValue, id.value), gte(otpChallenges.createdAt, new Date(Date.now() - 3600_000)))).orderBy(desc(otpChallenges.createdAt))
    if (lastHour[0]) {
      const cooldown = auth.resendCooldownSeconds * 2 ** Math.max(0, lastHour.length - 1)
      const wait = Math.ceil((lastHour[0].createdAt.getTime() + cooldown * 1000 - Date.now()) / 1000)
      if (wait > 0) throw new AppError("RATE_LIMITED", "Please wait before requesting another code", undefined, { retryAfter: wait })
    }
    // Every window is checked before any is recorded, and the requester's own budgets (IP, network, device) come first:
    // a client that has used up its own budget can no longer fill a victim's per-number window and lock them out.
    const windows: [string, string, number, number][] = [
      ["otp-ip-1h", ipKey(ctx.ip), 20, 3600],
      ["otp-net-1h", ipPrefix(ctx.ip), 60, 3600],
      ["otp-device-1h", body.deviceId, 10, 3600],
      ["otp-number-1h", id.value, auth.maxPerHour, 3600],
      ["otp-number-1d", id.value, auth.maxPerDay, 86400],
      ...(id.country ? [["otp-country-1h", id.country, 2000, 3600] as [string, string, number, number]] : []),
    ]
    for (const [name, key, limit, window] of windows) await this.limiter.check(name, key, limit, window)
    for (const [name, key, , window] of windows) await this.limiter.hit(name, key, window)
    await this.limiter.hit("otp-ip-10m", ctx.ip, 600)
    if (id.country) await this.limiter.hit("otp-sent-country-1d", id.country, 86400)

    const challengeId = uuidv7()
    const code = randomDigits(auth.otpLength)
    const hash = otpHash(code, challengeId)
    const expiresAt = new Date(Date.now() + auth.otpTtlSeconds * 1000)
    const voice = body.voice && id.type === "PHONE" && lastHour.length >= 2
    await this.db.transaction(async (tx) => {
      await tx.insert(otpChallenges).values({ id: challengeId, identityValue: id.value, identityType: id.type, purpose: body.purpose, userId: ctx.userId, codeHash: hash, expiresAt, maxAttempts: auth.otpMaxAttempts, ip: ctx.ip, ipPrefix: ipPrefix(ctx.ip), deviceId: body.deviceId, voice })
      // The code travels to the worker encrypted; it is never stored or logged in clear (ch. 25.1 figure).
      await this.outbox.add(tx, { aggregateType: "otp", aggregateId: challengeId, eventType: "auth.otp_requested", payload: { challengeId, channel: id.type, destination: id.value, code: encryptField(code).ciphertext, locale: ctx.locale, voice }, dedupeKey: `otp:${challengeId}` })
    })
    await this.redis.set(`otp:${challengeId}`, JSON.stringify({ hash, attempts: 0, deviceId: body.deviceId, ipPrefix: ipPrefix(ctx.ip), max: auth.otpMaxAttempts }), "EX", auth.otpTtlSeconds)
    const nextCooldown = auth.resendCooldownSeconds * 2 ** lastHour.length
    return { challengeId, resendAfterSeconds: nextCooldown, expiresAt: expiresAt.toISOString(), normalised: id.value, voiceAvailable: id.type === "PHONE" && lastHour.length + 1 >= 2 }
  }

  async verify(body: OtpVerifyBody, ctx: RequestCtx): Promise<{ userId: string; isNewUser: boolean; needsProfile: boolean; tokens?: IssuedTokens; mfaRequired: boolean; mfaEnrolmentRequired: boolean; purpose: string }> {
    await this.limiter.enforce("otp-verify-ip", ipKey(ctx.ip), this.config.get("AUTH").verifyIpLimitPer10Min, 600)
    const code = normaliseDigits(body.code)
    const [row] = await this.db.select().from(otpChallenges).where(eq(otpChallenges.id, body.challengeId))
    if (!row || row.consumedAt) throw new AppError(row && row.expiresAt < new Date() ? "OTP_EXPIRED" : "OTP_INVALID")
    if (row.lockedAt) throw new AppError("OTP_LOCKED")
    // One atomic step counts the attempt before the code is compared, so parallel guesses each spend an attempt.
    const res = (await this.redis.eval(OTP_ATTEMPT_LUA, 1, `otp:${body.challengeId}`, body.deviceId, ipPrefix(ctx.ip))) as [string, string, number, number] | null
    if (!res) throw new AppError(row.expiresAt < new Date() ? "OTP_EXPIRED" : "OTP_INVALID")
    const [outcome, hash, attempts, max] = res
    if (outcome === "LOCKED") throw new AppError("OTP_LOCKED")
    // Binding: verification from a different device or network range needs a new code (ch. 25.1).
    if (outcome === "UNBOUND") throw new AppError("OTP_INVALID")
    await this.db.update(otpChallenges).set({ attempts, lockedAt: attempts >= max ? new Date() : null }).where(and(eq(otpChallenges.id, row.id), isNull(otpChallenges.consumedAt)))
    if (!constantTimeEqual(hash, otpHash(code, row.id))) throw new AppError(attempts >= max ? "OTP_LOCKED" : "OTP_INVALID")
    // Single use: only the request that deletes the challenge wins; a concurrent correct guess gets OTP_INVALID.
    if ((await this.redis.del(`otp:${body.challengeId}`)) !== 1) throw new AppError("OTP_INVALID")

    return this.db.transaction(async (tx) => {
      const consumed = await tx.update(otpChallenges).set({ consumedAt: new Date(), deliveryStatus: "DELIVERED" }).where(and(eq(otpChallenges.id, row.id), isNull(otpChallenges.consumedAt))).returning({ id: otpChallenges.id })
      if (consumed.length !== 1) throw new AppError("OTP_INVALID")
      if (row.purpose === "SIGN_IN") return this.signIn(tx, { type: row.identityType, value: row.identityValue }, body, ctx)
      if (!row.userId) throw new AppError("UNAUTHENTICATED")
      if (row.purpose === "STEP_UP") return { userId: row.userId, isNewUser: false, needsProfile: false, mfaRequired: false, mfaEnrolmentRequired: false, purpose: row.purpose }
      await this.attachIdentity(tx, row.userId, row.identityType, row.identityValue, ctx)
      return { userId: row.userId, isNewUser: false, needsProfile: false, mfaRequired: false, mfaEnrolmentRequired: false, purpose: row.purpose }
    })
  }

  /** ADR-0012: sign-in without a code for the testing phase; the controller only calls it when TEST_SIGN_IN is on or customers. */
  async testSignIn(body: TestSignInBody, ctx: RequestCtx) {
    const id = normaliseIdentity("EMAIL", body.email)
    return this.db.transaction((tx) => this.signIn(tx, id, body, ctx, true))
  }

  private async signIn(tx: Tx, id: { type: "PHONE" | "EMAIL"; value: string }, body: Pick<OtpVerifyBody, "client" | "deviceId" | "profile">, ctx: RequestCtx, test = false) {
    const [existing] = await tx.select().from(userIdentities).where(and(eq(userIdentities.type, id.type), eq(userIdentities.valueNormalised, id.value), isNull(userIdentities.revokedAt)))
    let userId: string
    let isNewUser = false
    if (existing) {
      userId = existing.userId
      const [u] = await tx.select().from(users).where(eq(users.id, userId))
      if (!u || u.status !== "ACTIVE") throw new AppError("OTP_INVALID")
      // Verified means verified: a successful OTP for this exact E.164 number (ch. 11.2).
      if (!existing.verifiedAt) await tx.update(userIdentities).set({ verifiedAt: new Date() }).where(eq(userIdentities.id, existing.id))
    } else {
      // The console is staff-only: a console sign-in never creates a customer account (and says nothing about who exists).
      if (body.client === "CONSOLE") throw new AppError("OTP_INVALID")
      isNewUser = true
      const p = body.profile
      const [u] = await tx.insert(users).values({
        displayName: p ? `${p.givenNamesLatin} ${p.surnameLatin}` : id.type === "PHONE" ? "Customer" : id.value.split("@")[0]!,
        preferredLocale: ctx.locale, calendar: ctx.locale === "fa" ? "JALALI" : "GREGORIAN", timezone: id.value.startsWith("+98") ? "Asia/Tehran" : "Europe/London",
      }).returning()
      userId = u!.id
      await tx.insert(userIdentities).values({ userId, type: id.type, valueNormalised: id.value, verifiedAt: new Date(), isPrimary: true })
      await tx.insert(customerProfiles).values({ userId, givenNamesLatin: p?.givenNamesLatin ?? null, surnameLatin: p?.surnameLatin ?? null, nameFa: p?.nameFa ?? null, termsVersion: this.config.settings().legal.termsVersion, privacyVersion: this.config.settings().legal.privacyVersion })
      const [customerRole] = await tx.select().from(roles).where(eq(roles.key, "customer"))
      await tx.insert(userRoles).values({ userId, roleId: customerRole!.id })
      await this.outbox.add(tx, { aggregateType: "user", aggregateId: userId, eventType: "user.registered", payload: { userId } })
    }
    const [profile] = await tx.select().from(customerProfiles).where(eq(customerProfiles.userId, userId))
    const acc = await this.access.load(userId, tx)
    const staff = this.access.isStaff(acc.permissions)
    // Refused before a session exists, so a customer phone can never reach TOTP enrolment on the console (ch. 25.2).
    if (body.client === "CONSOLE" && !staff) throw new AppError("OTP_INVALID")
    // TEST_SIGN_IN=customers: staff accounts never sign in without a code (one answer for every refusal).
    if (test && (staff || body.client === "CONSOLE") && !testSignInForStaff()) throw new AppError("OTP_INVALID")
    const factors = staff ? await tx.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId))) : []
    const confirmed = factors.filter((f) => f.confirmedAt)
    const needsMfa = !test && staff && this.config.get("AUTH").staffSecondFactor && body.client !== "WEB"
    const tokens = await this.sessions.create(tx, { userId, client: body.client, deviceId: body.deviceId, ip: ctx.ip, userAgent: ctx.userAgent, mfaSatisfied: test })
    await this.audit.record(tx, { actorUserId: userId, actorKind: staff ? "STAFF" : "CUSTOMER", action: test ? "user.test_signed_in" : isNewUser ? "user.signed_up" : "user.signed_in", entityType: "session", entityId: tokens.sessionId, after: { client: body.client, identityType: id.type, isNewUser }, ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId })
    await this.outbox.add(tx, { aggregateType: "user", aggregateId: userId, eventType: "identity.verified", payload: { userId, identityType: id.type } })
    if (!isNewUser) await this.outbox.add(tx, { aggregateType: "user", aggregateId: userId, eventType: "security.new_sign_in", payload: { userId, client: body.client, sessionId: tokens.sessionId } })
    return {
      userId, isNewUser, tokens, purpose: "SIGN_IN",
      needsProfile: !profile?.givenNamesLatin || !profile.surnameLatin,
      mfaRequired: needsMfa && confirmed.length > 0,
      mfaEnrolmentRequired: needsMfa && confirmed.length === 0,
    }
  }

  /** A new phone or email stays unverified until its own OTP succeeds; the old verified one stays (ch. 11.2). */
  private async attachIdentity(tx: Tx, userId: string, type: "PHONE" | "EMAIL", value: string, ctx: RequestCtx) {
    const [taken] = await tx.select().from(userIdentities).where(and(eq(userIdentities.type, type), eq(userIdentities.valueNormalised, value), isNull(userIdentities.revokedAt)))
    if (taken && taken.userId !== userId) throw new AppError("VALIDATION_FAILED", "This identity belongs to another account; ask us to merge accounts")
    if (taken) await tx.update(userIdentities).set({ verifiedAt: new Date() }).where(eq(userIdentities.id, taken.id))
    else {
      const hasPrimary = await tx.select().from(userIdentities).where(and(eq(userIdentities.userId, userId), eq(userIdentities.type, type), eq(userIdentities.isPrimary, true), isNull(userIdentities.revokedAt)))
      await tx.insert(userIdentities).values({ userId, type, valueNormalised: value, verifiedAt: new Date(), isPrimary: hasPrimary.length === 0 })
    }
    await this.audit.record(tx, { actorUserId: userId, actorKind: "CUSTOMER", action: "identity.verified", entityType: "user_identity", entityId: userId, after: { type, value }, ip: ctx.ip, requestId: ctx.requestId })
    await this.outbox.add(tx, { aggregateType: "user", aggregateId: userId, eventType: "identity.verified", payload: { userId, identityType: type } })
  }
}
