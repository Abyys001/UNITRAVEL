import { createHash, randomBytes } from "node:crypto"

import { Inject, Injectable } from "@nestjs/common"
import type { Redis } from "ioredis"

import type { PowChallenge } from "@unitravel/contracts"

import { constantTimeEqual, hmacSign } from "../../core/crypto"
import { REDIS } from "../../core/infra.module"

/**
 * Self-hosted proof-of-work challenge, ALTCHA-compatible (ch. 8.6, 25.1): no Google or hCaptcha dependency, so it
 * works for users in Iran. The client finds `number` such that SHA-256(salt + number) === challenge.
 */
@Injectable()
export class PowService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  create(maxnumber = 50_000, ttlSeconds = 300): PowChallenge {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds
    const salt = `${randomBytes(12).toString("hex")}?expires=${expires}`
    const number = Math.floor(Math.random() * maxnumber)
    const challenge = createHash("sha256").update(salt + number).digest("hex")
    return { algorithm: "SHA-256", challenge, salt, maxnumber, signature: hmacSign(challenge, "pow") }
  }

  /** Payload: base64(JSON { algorithm, challenge, number, salt, signature }). Each solution is accepted once. */
  async verify(payload: string | undefined): Promise<boolean> {
    if (!payload) return false
    try {
      const p = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { algorithm: string; challenge: string; number: number; salt: string; signature: string }
      if (p.algorithm !== "SHA-256") return false
      const expires = Number(new URLSearchParams(p.salt.split("?")[1] ?? "").get("expires"))
      if (!expires || expires * 1000 < Date.now()) return false
      if (!constantTimeEqual(hmacSign(p.challenge, "pow"), p.signature)) return false
      if (createHash("sha256").update(p.salt + p.number).digest("hex") !== p.challenge) return false
      return (await this.redis.set(`pow:used:${p.challenge}`, "1", "EX", 600, "NX")) === "OK"
    } catch {
      return false
    }
  }
}
