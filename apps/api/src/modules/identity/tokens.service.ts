import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { Injectable, type OnModuleInit } from "@nestjs/common"
import { exportJWK, exportPKCS8, generateKeyPair, importJWK, importPKCS8, type JWTPayload, jwtVerify, SignJWT, type CryptoKey, decodeProtectedHeader } from "jose"

import type { Permission } from "@unitravel/contracts"

import { env, isLocal } from "../../core/env"
import { AppError } from "../../core/errors"

export type Audience = "web" | "console" | "mobile"

export interface AccessClaims extends JWTPayload {
  sub: string
  sid: string
  aud: Audience
  pv: number
  perms: Permission[]
  mfa: number
}

const ISSUER = "unitravel"

/**
 * Access tokens are EdDSA-signed JWTs (ch. 25.2) carrying sub, sid, aud, perm_version, a compact permission list
 * and the MFA level. Several public keys are accepted so keys can rotate every 90 days with overlap.
 */
@Injectable()
export class TokensService implements OnModuleInit {
  private privateKey!: CryptoKey
  private kid!: string
  private readonly publicKeys = new Map<string, CryptoKey>()

  async onModuleInit() {
    let pkcs8 = env().JWT_PRIVATE_KEY
    let publics = env().JWT_PUBLIC_KEYS
    if (!pkcs8 && isLocal()) {
      // Local only: a generated key persisted outside git so sessions survive restarts.
      const file = path.resolve(process.cwd(), ".dev-jwt.json")
      if (!existsSync(file)) {
        const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true })
        const jwk = { ...(await exportJWK(publicKey)), kid: "dev-1" }
        writeFileSync(file, JSON.stringify({ pkcs8: await exportPKCS8(privateKey), publics: [jwk] }), { mode: 0o600 })
      }
      const saved = JSON.parse(readFileSync(file, "utf8")) as { pkcs8: string; publics: unknown[] }
      pkcs8 = saved.pkcs8
      publics = JSON.stringify(saved.publics)
    }
    if (!pkcs8 || !publics) throw new Error("JWT keys missing")
    this.privateKey = await importPKCS8(pkcs8.replace(/\\n/g, "\n"), "EdDSA")
    const jwks = JSON.parse(publics) as { kid: string }[]
    for (const jwk of jwks) this.publicKeys.set(jwk.kid, (await importJWK({ ...jwk, alg: "EdDSA" }, "EdDSA")) as CryptoKey)
    this.kid = jwks[0]!.kid
  }

  async signAccess(c: Omit<AccessClaims, "iat" | "exp" | "iss">, ttlSeconds: number): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    const token = await new SignJWT({ sid: c.sid, pv: c.pv, perms: c.perms, mfa: c.mfa })
      .setProtectedHeader({ alg: "EdDSA", kid: this.kid })
      .setSubject(c.sub as string)
      .setAudience(c.aud as string)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.privateKey)
    return { token, expiresAt }
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { kid } = decodeProtectedHeader(token)
      const key = kid ? this.publicKeys.get(kid) : undefined
      if (!key) throw new AppError("UNAUTHENTICATED", "Unknown signing key")
      const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: ["web", "console", "mobile"], algorithms: ["EdDSA"] })
      return payload as AccessClaims
    } catch (err) {
      if (err instanceof AppError) throw err
      if ((err as { code?: string }).code === "ERR_JWT_EXPIRED") throw new AppError("TOKEN_EXPIRED", "Access token expired")
      throw new AppError("UNAUTHENTICATED", "Invalid access token")
    }
  }
}
