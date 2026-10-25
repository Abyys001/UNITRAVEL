import { createHmac, randomBytes } from "node:crypto"

import { Inject, Injectable } from "@nestjs/common"
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server"
import { and, desc, eq, isNotNull } from "drizzle-orm"
import type { Redis } from "ioredis"

import { type Db, mfaFactors, users } from "@unitravel/db"

import { decryptField, encryptField } from "../../core/crypto"
import { env } from "../../core/env"
import { AppError } from "../../core/errors"
import { DB, REDIS } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { SessionsService } from "./sessions.service"

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ""
  for (const b of buf) {
    value = (value << 8) | b; bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0
  const out: number[] = []
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(c)
    if (i < 0) continue
    value = (value << 5) | i; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s). */
export function totp(secret: Buffer, at = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)))
  const h = createHmac("sha1", secret).update(counter).digest()
  const o = h[h.length - 1]! & 0xf
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!
  return String(n % 1_000_000).padStart(6, "0")
}

/**
 * Staff second factor (ch. 25.5): passkey (WebAuthn) preferred, TOTP accepted. Enrolment is forced on first console
 * sign-in; a verification within the last 10 minutes satisfies step-up for privileged actions.
 */
@Injectable()
export class MfaService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(REDIS) private readonly redis: Redis, private readonly sessions: SessionsService, private readonly audit: AuditService) {}

  private rp() {
    const u = new URL(env().PUBLIC_CONSOLE_ADMIN_URL)
    // Passkeys are scoped to the registrable domain so admin. and dev. hosts share them.
    const rpID = u.hostname.split(".").slice(-2).join(".") === "localhost" ? "localhost" : u.hostname.split(".").slice(-2).join(".")
    return { rpID, rpName: "Uni Travel", origins: [env().PUBLIC_CONSOLE_ADMIN_URL, env().PUBLIC_CONSOLE_DEV_URL] }
  }

  async enrolTotp(userId: string) {
    const secret = randomBytes(20)
    const [u] = await this.db.select().from(users).where(eq(users.id, userId))
    const enc = encryptField(secret.toString("hex"))
    const [f] = await this.db.insert(mfaFactors).values({ userId, type: "TOTP", secretCiphertext: enc.ciphertext }).returning()
    const b32 = base32Encode(secret)
    const label = encodeURIComponent(`Uni Travel:${u?.displayName ?? userId}`)
    return { factorId: f!.id, secret: b32, otpauthUrl: `otpauth://totp/${label}?secret=${b32}&issuer=Uni%20Travel&algorithm=SHA1&digits=6&period=30` }
  }

  private checkTotp(secretHex: string, code: string): boolean {
    const secret = Buffer.from(secretHex, "hex")
    const now = Date.now()
    return [-1, 0, 1].some((w) => totp(secret, now + w * 30_000) === code)
  }

  /** Verifies a TOTP code against confirmed factors (or confirms a pending one) and raises the session's MFA level. */
  async verifyTotp(userId: string, sessionId: string, code: string, ctx: { ip?: string; requestId?: string }) {
    const replayKey = `mfa:totp:${userId}:${code}`
    if (await this.redis.get(replayKey)) throw new AppError("OTP_INVALID")
    const factors = await this.db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.type, "TOTP")))
    const match = factors.find((f) => f.secretCiphertext && this.checkTotp(decryptField(f.secretCiphertext), code))
    if (!match) throw new AppError("OTP_INVALID")
    await this.redis.set(replayKey, "1", "EX", 90)
    await this.db.update(mfaFactors).set({ lastUsedAt: new Date(), confirmedAt: match.confirmedAt ?? new Date() }).where(eq(mfaFactors.id, match.id))
    // Unconfirmed duplicates from abandoned enrolments are removed once one factor is confirmed.
    for (const f of factors) if (f.id !== match.id && !f.confirmedAt) await this.db.delete(mfaFactors).where(eq(mfaFactors.id, f.id))
    await this.sessions.markMfa(sessionId, 1)
    await this.db.transaction((tx) => this.audit.record(tx, { actorUserId: userId, actorKind: "STAFF", action: match.confirmedAt ? "mfa.verified" : "mfa.enrolled", entityType: "mfa_factor", entityId: match.id, ip: ctx.ip, requestId: ctx.requestId }))
    return { level: 1 }
  }

  /**
   * Local test helper: the code the user's newest TOTP factor shows now (confirmed first, else a pending enrolment).
   * If the current code was already used, returns the next step's code, which verification still accepts.
   */
  async currentTotp(userId: string): Promise<{ code: string } | null> {
    const factors = await this.db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.type, "TOTP"))).orderBy(desc(mfaFactors.createdAt))
    const f = factors.find((x) => x.confirmedAt && x.secretCiphertext) ?? factors.find((x) => x.secretCiphertext)
    if (!f) return null
    const secret = Buffer.from(decryptField(f.secretCiphertext!), "hex")
    const now = totp(secret)
    return { code: (await this.redis.get(`mfa:totp:${userId}:${now}`)) ? totp(secret, Date.now() + 30_000) : now }
  }

  async enrolled(userId: string): Promise<string[]> {
    const rows = await this.db.select({ type: mfaFactors.type }).from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.confirmedAt)))
    return [...new Set(rows.map((r) => r.type))]
  }

  async webauthnRegistrationOptions(userId: string) {
    const { rpID, rpName } = this.rp()
    const [u] = await this.db.select().from(users).where(eq(users.id, userId))
    const existing = await this.db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.type, "WEBAUTHN")))
    const options = await generateRegistrationOptions({
      rpName, rpID, userName: u?.displayName ?? userId, userID: new TextEncoder().encode(userId), attestationType: "none",
      excludeCredentials: existing.filter((e) => e.credentialId).map((e) => ({ id: e.credentialId! })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    })
    await this.redis.set(`webauthn:reg:${userId}`, options.challenge, "EX", 300)
    return options
  }

  async webauthnRegister(userId: string, sessionId: string, response: Record<string, unknown>) {
    const { rpID, origins } = this.rp()
    const challenge = await this.redis.get(`webauthn:reg:${userId}`)
    if (!challenge) throw new AppError("OTP_EXPIRED")
    const v = await verifyRegistrationResponse({ response: response as never, expectedChallenge: challenge, expectedOrigin: origins, expectedRPID: rpID })
    if (!v.verified || !v.registrationInfo) throw new AppError("OTP_INVALID")
    const cred = v.registrationInfo.credential
    await this.db.insert(mfaFactors).values({ userId, type: "WEBAUTHN", credentialId: cred.id, publicKey: Buffer.from(cred.publicKey).toString("base64url"), counter: cred.counter, confirmedAt: new Date(), lastUsedAt: new Date() })
    await this.sessions.markMfa(sessionId, 2)
    return { level: 2 }
  }

  async webauthnAuthOptions(userId: string) {
    const { rpID } = this.rp()
    const creds = await this.db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.type, "WEBAUTHN")))
    const options = await generateAuthenticationOptions({ rpID, allowCredentials: creds.map((c) => ({ id: c.credentialId! })), userVerification: "preferred" })
    await this.redis.set(`webauthn:auth:${userId}`, options.challenge, "EX", 300)
    return options
  }

  async webauthnAuthenticate(userId: string, sessionId: string, response: Record<string, unknown>) {
    const { rpID, origins } = this.rp()
    const challenge = await this.redis.get(`webauthn:auth:${userId}`)
    if (!challenge) throw new AppError("OTP_EXPIRED")
    const [cred] = await this.db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.credentialId, String(response.id))))
    if (!cred) throw new AppError("OTP_INVALID")
    const v = await verifyAuthenticationResponse({
      response: response as never, expectedChallenge: challenge, expectedOrigin: origins, expectedRPID: rpID,
      credential: { id: cred.credentialId!, publicKey: Buffer.from(cred.publicKey!, "base64url"), counter: cred.counter },
    })
    if (!v.verified) throw new AppError("OTP_INVALID")
    await this.db.update(mfaFactors).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(mfaFactors.id, cred.id))
    await this.sessions.markMfa(sessionId, 2)
    return { level: 2 }
  }
}
