import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm"
import type { Redis } from "ioredis"
import { v7 as uuidv7 } from "uuid"

import { customerActivity, type Db, mfaFactors, refreshTokens, sessions, trustedDevices, type Tx, users } from "@unitravel/db"

import { randomToken, sha256 } from "../../core/crypto"
import { testSignInEnabled } from "../../core/env"
import { AppError } from "../../core/errors"
import { ipPrefix } from "../../core/http/rate-limit"
import { DB, REDIS } from "../../core/infra.module"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { type Audience, TokensService } from "./tokens.service"

export interface IssuedTokens {
  accessToken: string
  accessExpiresAt: Date
  refreshToken: string
  refreshExpiresAt: Date
  sessionId: string
}

export const REFRESH_REUSE_GRACE_SECONDS = 10
/** Hard cap on how long one customer sign-in can be kept alive by use (web and app); after it the customer signs in again. */
export const REMEMBER_DEVICE_DAYS = 90
const clientBinding = (ctx: { ip?: string; userAgent?: string }) => sha256(`${ctx.ip ?? ""}|${ctx.userAgent ?? ""}`)

/** Revoking for these reasons also ends the device; a remembered device must not reopen what the user just closed. Idle and absolute expiry keep it (ADR-0022). */
const ENDS_DEVICE = new Set(["LOGOUT", "USER_REVOKED", "REFRESH_REUSE"])
const CLIENT_AUDIENCE: Record<"WEB" | "CONSOLE" | "MOBILE", Audience> = { WEB: "web", CONSOLE: "console", MOBILE: "mobile" }

/**
 * Sessions and rotating refresh tokens (ch. 25.2). Refresh tokens are opaque and stored hashed; each refresh returns
 * a new one; presenting an already-rotated token revokes the whole family and the session (theft detection), except
 * for a short same-client grace window that absorbs concurrent refreshes.
 * Console sessions have a 12-hour absolute lifetime and a 30-minute idle timeout; a remembered device can open a new
 * one without a sign-in, but never carries a recent second factor across (ADR-0022).
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly tokens: TokensService,
    private readonly access: AccessService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async create(tx: Tx, input: { userId: string; client: "WEB" | "CONSOLE" | "MOBILE"; deviceId?: string; ip?: string; userAgent?: string; mfaSatisfied?: boolean; trustedDeviceId?: string }): Promise<IssuedTokens> {
    const auth = this.config.get("AUTH")
    // A customer device is remembered: the refresh token rotates on every use and lasts refreshTtlDays from the last use, so a
    // device in regular use stays signed in, up to a hard cap of REMEMBER_DEVICE_DAYS from sign-in. Staff sessions stay short.
    const absolute = input.client === "CONSOLE" ? auth.staffSessionHours * 3600_000 : Math.max(auth.refreshTtlDays, REMEMBER_DEVICE_DAYS) * 86400_000
    const [s] = await tx.insert(sessions).values({ userId: input.userId, client: input.client, deviceId: input.deviceId, ip: input.ip, userAgent: input.userAgent?.slice(0, 400), absoluteExpiresAt: new Date(Date.now() + absolute), trustedDeviceId: input.trustedDeviceId, ...(input.mfaSatisfied ? { mfaLevel: 1, mfaVerifiedAt: new Date() } : input.trustedDeviceId ? { mfaLevel: 1 } : {}) }).returning()
    // ADR-0018: a sign-in row (no content). Staff console sign-ins are not customer activity.
    if (input.client !== "CONSOLE") await tx.insert(customerActivity).values({ userId: input.userId, sessionId: s!.id, kind: "SIGN_IN", client: input.client, network: input.ip ? ipPrefix(input.ip) : null })
    return this.issue(tx, s!, uuidv7())
  }

  private async issue(tx: Tx, s: typeof sessions.$inferSelect, familyId: string): Promise<IssuedTokens> {
    const auth = this.config.get("AUTH")
    const acc = await this.access.load(s.userId, tx)
    const refresh = randomToken(32)
    const refreshExpiresAt = new Date(Math.min(s.absoluteExpiresAt.getTime(), Date.now() + auth.refreshTtlDays * 86400_000))
    await tx.insert(refreshTokens).values({ sessionId: s.id, tokenHash: sha256(refresh), familyId, expiresAt: refreshExpiresAt })
    const { token, expiresAt } = await this.tokens.signAccess({ sub: s.userId, sid: s.id, aud: CLIENT_AUDIENCE[s.client], pv: acc.permVersion, perms: acc.permissions, mfa: s.mfaLevel }, auth.accessTtlSeconds)
    await this.redis.set(`perm:${s.userId}`, String(acc.permVersion))
    return { accessToken: token, accessExpiresAt: expiresAt, refreshToken: `${s.id}.${refresh}`, refreshExpiresAt, sessionId: s.id }
  }

  /**
   * Rotates a refresh token. A just-rotated token presented again inside REFRESH_REUSE_GRACE_SECONDS from the same ip and
   * user agent (two tabs or contexts racing on one cookie) gets a sibling token in the same family instead of ending the
   * session (OWASP session management, ch. 25.2). Anything later, or from elsewhere, is treated as theft and revokes the family.
   */
  async refresh(presented: string, ctx: { ip?: string; userAgent?: string; requestId?: string }): Promise<IssuedTokens> {
    const [sessionId, raw] = presented.split(".")
    if (!sessionId || !raw) throw new AppError("UNAUTHENTICATED", "Invalid refresh token")
    const out = await this.db.transaction(async (tx) => {
      const [rt] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw))).for("update")
      if (!rt || rt.sessionId !== sessionId) throw new AppError("UNAUTHENTICATED", "Invalid refresh token")
      let grace = false
      if (rt.rotatedAt || rt.revokedAt) {
        const inWindow = !rt.revokedAt && !!rt.rotatedAt && Date.now() - rt.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_SECONDS * 1000
        const bound = inWindow && (await this.redis.get(`rt:rot:${rt.id}`)) === clientBinding(ctx)
        if (!bound) return { reuse: rt }
        grace = true
      }
      const [s] = await tx.select().from(sessions).where(eq(sessions.id, rt.sessionId))
      if (!s || s.revokedAt) throw new AppError("UNAUTHENTICATED", "Session ended")
      if (rt.expiresAt <= new Date() || s.absoluteExpiresAt <= new Date()) throw new AppError("UNAUTHENTICATED", "Session expired")
      const auth = this.config.get("AUTH")
      if (s.client === "CONSOLE" && Date.now() - s.lastSeenAt.getTime() > auth.staffIdleMinutes * 60_000) return { idle: s.id }
      const acc = await this.access.load(s.userId, tx)
      if (acc.status !== "ACTIVE") throw new AppError("UNAUTHENTICATED", "Account suspended")
      if (!grace) {
        await tx.update(refreshTokens).set({ rotatedAt: new Date() }).where(eq(refreshTokens.id, rt.id))
        await this.redis.set(`rt:rot:${rt.id}`, clientBinding(ctx), "EX", REFRESH_REUSE_GRACE_SECONDS)
      }
      // A background refresh is not console activity (ADR-0022).
      if (s.client !== "CONSOLE") await tx.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, s.id))
      return { tokens: await this.issue(tx, s, rt.familyId) }
    })
    if (out.tokens) return out.tokens
    if (out.idle) {
      await this.revoke(out.idle, "IDLE_TIMEOUT")
      throw new AppError("UNAUTHENTICATED", "Signed out after inactivity")
    }
    // Reuse outside the grace window: assume theft, revoke the family and the session (committed before failing).
    const rt0 = out.reuse!
    const [s0] = await this.db.select().from(sessions).where(eq(sessions.id, rt0.sessionId))
    await this.db.transaction(async (tx) => {
      await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.familyId, rt0.familyId))
      await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: "REFRESH_REUSE" }).where(eq(sessions.id, rt0.sessionId))
      await this.audit.record(tx, { actorUserId: s0?.userId, actorKind: "CUSTOMER", action: "security.refresh_reuse", entityType: "session", entityId: rt0.sessionId, ip: ctx.ip, requestId: ctx.requestId })
    })
    await this.redis.set(`sess:${rt0.sessionId}:revoked`, "1", "EX", 13 * 3600)
    if (s0?.trustedDeviceId) await this.revokeDevice(s0.trustedDeviceId, "REFRESH_REUSE", ctx)
    throw new AppError("UNAUTHENTICATED", "Session ended")
  }

  async revoke(sessionId: string, reason: string, ctx: { ip?: string; requestId?: string } = {}) {
    await this.db.update(sessions).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.sessionId, sessionId))
    await this.redis.set(`sess:${sessionId}:revoked`, "1", "EX", 13 * 3600)
    if (ENDS_DEVICE.has(reason)) {
      const s = await this.get(sessionId)
      if (s?.trustedDeviceId) await this.revokeDevice(s.trustedDeviceId, reason, ctx)
    }
  }

  /**
   * Remembers this console device once its session has a satisfied second factor; null when there is nothing new to
   * remember (not a console session, factor outstanding, or the session already belongs to a device).
   */
  async trustDevice(sessionId: string, host: string, ctx: { ip?: string; userAgent?: string; requestId?: string }): Promise<{ token: string; expiresAt: Date } | null> {
    const auth = this.config.get("AUTH")
    const s = await this.get(sessionId)
    if (!s || s.revokedAt || s.client !== "CONSOLE" || s.trustedDeviceId) return null
    if (auth.staffSecondFactor && s.mfaLevel < 1) return null
    const raw = randomToken(32)
    const expiresAt = new Date(Date.now() + auth.staffDeviceIdleDays * 86400_000)
    const maxExpiresAt = new Date(Date.now() + auth.staffDeviceMaxDays * 86400_000)
    const capped = expiresAt < maxExpiresAt ? expiresAt : maxExpiresAt
    const id = await this.db.transaction(async (tx) => {
      const [d] = await tx.insert(trustedDevices).values({ userId: s.userId, host, userAgent: ctx.userAgent?.slice(0, 400), tokenHash: sha256(raw), expiresAt: capped, maxExpiresAt }).returning({ id: trustedDevices.id })
      await tx.update(sessions).set({ trustedDeviceId: d!.id }).where(eq(sessions.id, sessionId))
      await this.audit.record(tx, { actorUserId: s.userId, actorKind: "STAFF", action: "session.device_trusted", entityType: "trusted_device", entityId: d!.id, after: { host }, ip: ctx.ip, requestId: ctx.requestId })
      return d!.id
    })
    return { token: `${id}.${raw}`, expiresAt: capped }
  }

  /**
   * Opens a new console session from a remembered device and rotates its token. The session has level 1 but no
   * verification time, so step-up actions still ask for the second factor. The previous token presented again is treated
   * like refresh reuse: inside the same-client grace it gets a session and no new token; otherwise the device is revoked.
   */
  async resumeDevice(presented: string, host: string, ctx: { ip?: string; userAgent?: string; requestId?: string }): Promise<{ tokens: IssuedTokens; device?: { token: string; expiresAt: Date } }> {
    const [deviceId, raw] = presented.split(".")
    if (!deviceId || !raw || !/^[0-9a-f-]{36}$/.test(deviceId)) throw new AppError("UNAUTHENTICATED", "Device not recognised")
    const auth = this.config.get("AUTH")
    const hash = sha256(raw)
    const out = await this.db.transaction(async (tx) => {
      const [d] = await tx.select().from(trustedDevices).where(eq(trustedDevices.id, deviceId)).for("update")
      if (!d || d.host !== host || d.revokedAt || d.expiresAt <= new Date()) throw new AppError("UNAUTHENTICATED", "Device not recognised")
      let grace = false
      if (hash !== d.tokenHash) {
        if (hash !== d.previousTokenHash) throw new AppError("UNAUTHENTICATED", "Device not recognised")
        const inWindow = !!d.rotatedAt && Date.now() - d.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_SECONDS * 1000
        if (!inWindow || (await this.redis.get(`dt:rot:${d.id}`)) !== clientBinding(ctx)) return { reuse: d.id }
        grace = true
      }
      const acc = await this.access.load(d.userId, tx)
      if (acc.status !== "ACTIVE") throw new AppError("UNAUTHENTICATED", "Account suspended")
      // Same rule as a console sign-in: whoever is no longer staff does not get a console session.
      if (!this.access.isStaff(acc.permissions)) throw new AppError("UNAUTHENTICATED", "Device not recognised")
      if (auth.staffSecondFactor && !testSignInEnabled()) {
        const [factor] = await tx.select({ id: mfaFactors.id }).from(mfaFactors).where(and(eq(mfaFactors.userId, d.userId), isNotNull(mfaFactors.confirmedAt))).limit(1)
        if (!factor) throw new AppError("UNAUTHENTICATED", "Second factor required")
      }
      const tokens = await this.create(tx, { userId: d.userId, client: "CONSOLE", ip: ctx.ip, userAgent: ctx.userAgent, trustedDeviceId: d.id })
      await this.audit.record(tx, { actorUserId: d.userId, actorKind: "STAFF", action: "session.device_resumed", entityType: "trusted_device", entityId: d.id, after: { sessionId: tokens.sessionId }, ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId })
      if (grace) return { tokens }
      const next = randomToken(32)
      const idle = new Date(Date.now() + auth.staffDeviceIdleDays * 86400_000)
      const expiresAt = idle < d.maxExpiresAt ? idle : d.maxExpiresAt
      await tx.update(trustedDevices).set({ tokenHash: sha256(next), previousTokenHash: hash, rotatedAt: new Date(), lastUsedAt: new Date(), expiresAt, userAgent: ctx.userAgent?.slice(0, 400) }).where(eq(trustedDevices.id, d.id))
      await this.redis.set(`dt:rot:${d.id}`, clientBinding(ctx), "EX", REFRESH_REUSE_GRACE_SECONDS)
      return { tokens, device: { token: `${d.id}.${next}`, expiresAt } }
    })
    if (out.tokens) return { tokens: out.tokens, device: out.device }
    await this.revokeDevice(out.reuse!, "TOKEN_REUSE", ctx, "security.device_reuse")
    throw new AppError("UNAUTHENTICATED", "Device not recognised")
  }

  /** Sign-out from a session that has already ended: the cookie itself is the proof. Unknown tokens are ignored. */
  async forgetDevice(presented: string, ctx: { ip?: string; requestId?: string }) {
    const [deviceId, raw] = presented.split(".")
    if (!deviceId || !raw || !/^[0-9a-f-]{36}$/.test(deviceId)) return
    const hash = sha256(raw)
    const [d] = await this.db.select().from(trustedDevices).where(eq(trustedDevices.id, deviceId))
    if (d && (hash === d.tokenHash || hash === d.previousTokenHash)) await this.revokeDevice(d.id, "LOGOUT", ctx)
  }

  /** Ends the device and every session it opened. Safe to call twice: only the first call changes anything or is audited. */
  async revokeDevice(id: string, reason: string, ctx: { ip?: string; requestId?: string } = {}, action = "session.device_revoked") {
    const [d] = await this.db.update(trustedDevices).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(trustedDevices.id, id), isNull(trustedDevices.revokedAt))).returning()
    if (!d) return
    const open = await this.db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.trustedDeviceId, id), isNull(sessions.revokedAt)))
    for (const s of open) await this.revoke(s.id, reason === "TOKEN_REUSE" ? reason : "DEVICE_REVOKED")
    await this.db.transaction((tx) => this.audit.record(tx, { actorUserId: d.userId, actorKind: "STAFF", action, entityType: "trusted_device", entityId: id, after: { reason }, ip: ctx.ip, requestId: ctx.requestId }))
  }

  async listDevices(userId: string) {
    return this.db.select().from(trustedDevices).where(and(eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt), gt(trustedDevices.expiresAt, new Date()))).orderBy(desc(trustedDevices.lastUsedAt))
  }

  async getDevice(id: string) {
    const [d] = await this.db.select().from(trustedDevices).where(eq(trustedDevices.id, id))
    return d
  }

  /** Logout: ends the session, writes the audit action `user.signed_out` and, for customers, a SIGN_OUT activity row (ADR-0018). */
  async signOut(actor: { userId: string; sessionId: string; audience: Audience; ip?: string; userAgent?: string }, requestId?: string) {
    await this.revoke(actor.sessionId, "LOGOUT")
    await this.db.transaction(async (tx) => {
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: actor.audience === "console" ? "STAFF" : "CUSTOMER", action: "user.signed_out", entityType: "session", entityId: actor.sessionId, ip: actor.ip, userAgent: actor.userAgent, requestId })
      if (actor.audience !== "console") await tx.insert(customerActivity).values({ userId: actor.userId, sessionId: actor.sessionId, kind: "SIGN_OUT", client: actor.audience === "mobile" ? "MOBILE" : "WEB", network: actor.ip ? ipPrefix(actor.ip) : null })
    })
  }

  async list(userId: string) {
    return this.db.select().from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))).orderBy(desc(sessions.lastSeenAt))
  }

  async get(sessionId: string) {
    const [s] = await this.db.select().from(sessions).where(eq(sessions.id, sessionId))
    return s
  }

  async markMfa(sessionId: string, level: number) {
    await this.db.update(sessions).set({ mfaLevel: level, mfaVerifiedAt: new Date() }).where(eq(sessions.id, sessionId))
    await this.redis.del(`sess:${sessionId}:meta`)
  }

  /** Session state for the guard: revoked flag, idle timeout for console, MFA timestamps (cached briefly). */
  async guardState(sessionId: string): Promise<{ revoked: boolean; client: string; mfaLevel: number; mfaVerifiedAt: Date | null; lastSeenAt: Date; absoluteExpiresAt: Date } | null> {
    if (await this.redis.get(`sess:${sessionId}:revoked`)) return null
    const cached = await this.redis.get(`sess:${sessionId}:meta`)
    let meta: { revoked: boolean; client: string; mfaLevel: number; mfaVerifiedAt: string | null; lastSeenAt: string; absoluteExpiresAt: string }
    if (cached) meta = JSON.parse(cached)
    else {
      const s = await this.get(sessionId)
      if (!s) return null
      meta = { revoked: !!s.revokedAt, client: s.client, mfaLevel: s.mfaLevel, mfaVerifiedAt: s.mfaVerifiedAt?.toISOString() ?? null, lastSeenAt: s.lastSeenAt.toISOString(), absoluteExpiresAt: s.absoluteExpiresAt.toISOString() }
      await this.redis.set(`sess:${sessionId}:meta`, JSON.stringify(meta), "EX", 30)
    }
    return { ...meta, mfaVerifiedAt: meta.mfaVerifiedAt ? new Date(meta.mfaVerifiedAt) : null, lastSeenAt: new Date(meta.lastSeenAt), absoluteExpiresAt: new Date(meta.absoluteExpiresAt) }
  }

  /** Throttled last-seen update (once a minute) so idle timeouts work without a write per request. */
  async touch(sessionId: string) {
    const ok = await this.redis.set(`sess:${sessionId}:touch`, "1", "EX", 60, "NX")
    if (ok) {
      const now = new Date()
      const [s] = await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId)).returning({ userId: sessions.userId })
      // Same once-a-minute throttle: "online" and "last seen" for the customer list (ADR-0018).
      if (s) await this.db.update(users).set({ lastActiveAt: now }).where(eq(users.id, s.userId))
      await this.redis.del(`sess:${sessionId}:meta`)
    }
  }
}
