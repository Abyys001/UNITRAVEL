import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, isNull } from "drizzle-orm"
import type { Redis } from "ioredis"
import { v7 as uuidv7 } from "uuid"

import { type Db, refreshTokens, sessions, type Tx } from "@unitravel/db"

import { randomToken, sha256 } from "../../core/crypto"
import { AppError } from "../../core/errors"
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
const clientBinding = (ctx: { ip?: string; userAgent?: string }) => sha256(`${ctx.ip ?? ""}|${ctx.userAgent ?? ""}`)

const CLIENT_AUDIENCE: Record<"WEB" | "CONSOLE" | "MOBILE", Audience> = { WEB: "web", CONSOLE: "console", MOBILE: "mobile" }

/**
 * Sessions and rotating refresh tokens (ch. 25.2). Refresh tokens are opaque and stored hashed; each refresh returns
 * a new one; presenting an already-rotated token revokes the whole family and the session (theft detection), except
 * for a short same-client grace window that absorbs concurrent refreshes.
 * Console sessions have a 12-hour absolute lifetime and a 30-minute idle timeout.
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

  async create(tx: Tx, input: { userId: string; client: "WEB" | "CONSOLE" | "MOBILE"; deviceId?: string; ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    const auth = this.config.get("AUTH")
    const absolute = input.client === "CONSOLE" ? auth.staffSessionHours * 3600_000 : auth.refreshTtlDays * 86400_000
    const [s] = await tx.insert(sessions).values({ userId: input.userId, client: input.client, deviceId: input.deviceId, ip: input.ip, userAgent: input.userAgent?.slice(0, 400), absoluteExpiresAt: new Date(Date.now() + absolute) }).returning()
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
      const acc = await this.access.load(s.userId, tx)
      if (acc.status !== "ACTIVE") throw new AppError("UNAUTHENTICATED", "Account suspended")
      if (!grace) {
        await tx.update(refreshTokens).set({ rotatedAt: new Date() }).where(eq(refreshTokens.id, rt.id))
        await this.redis.set(`rt:rot:${rt.id}`, clientBinding(ctx), "EX", REFRESH_REUSE_GRACE_SECONDS)
      }
      await tx.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, s.id))
      return { tokens: await this.issue(tx, s, rt.familyId) }
    })
    if (out.tokens) return out.tokens
    // Reuse outside the grace window: assume theft, revoke the family and the session (committed before failing).
    const rt0 = out.reuse!
    const [s0] = await this.db.select().from(sessions).where(eq(sessions.id, rt0.sessionId))
    await this.db.transaction(async (tx) => {
      await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.familyId, rt0.familyId))
      await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: "REFRESH_REUSE" }).where(eq(sessions.id, rt0.sessionId))
      await this.audit.record(tx, { actorUserId: s0?.userId, actorKind: "CUSTOMER", action: "security.refresh_reuse", entityType: "session", entityId: rt0.sessionId, ip: ctx.ip, requestId: ctx.requestId })
    })
    await this.redis.set(`sess:${rt0.sessionId}:revoked`, "1", "EX", 13 * 3600)
    throw new AppError("UNAUTHENTICATED", "Session ended")
  }

  async revoke(sessionId: string, reason: string) {
    await this.db.update(sessions).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.sessionId, sessionId))
    await this.redis.set(`sess:${sessionId}:revoked`, "1", "EX", 13 * 3600)
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
      await this.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId))
      await this.redis.del(`sess:${sessionId}:meta`)
    }
  }
}
