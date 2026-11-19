import { Inject, Injectable } from "@nestjs/common"
import type { Redis } from "ioredis"

import { AppError } from "../errors"
import { REDIS } from "../infra.module"

/** Sliding-window limits in Redis (ch. 25.7), key rl:{route}:{key}:{window}. */
@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Records one hit; returns the count in the window after recording. */
  async hit(name: string, key: string, windowSeconds: number): Promise<number> {
    const now = Date.now()
    const k = `rl:${name}:${key}:${windowSeconds}`
    const res = await this.redis.multi()
      .zremrangebyscore(k, 0, now - windowSeconds * 1000)
      .zadd(k, now, `${now}-${Math.random().toString(36).slice(2, 8)}`)
      .zcard(k)
      .pexpire(k, windowSeconds * 1000)
      .exec()
    return Number(res?.[2]?.[1] ?? 0)
  }

  async count(name: string, key: string, windowSeconds: number): Promise<number> {
    const k = `rl:${name}:${key}:${windowSeconds}`
    await this.redis.zremrangebyscore(k, 0, Date.now() - windowSeconds * 1000)
    return this.redis.zcard(k)
  }

  /** Throws when the window is already full, without recording a hit. */
  async check(name: string, key: string, limit: number, windowSeconds: number): Promise<void> {
    if ((await this.count(name, key, windowSeconds)) >= limit) throw new AppError("RATE_LIMITED", `Limit ${limit} per ${windowSeconds}s`, undefined, { retryAfter: windowSeconds })
  }

  async enforce(name: string, key: string, limit: number, windowSeconds: number): Promise<void> {
    const n = await this.hit(name, key, windowSeconds)
    if (n > limit) throw new AppError("RATE_LIMITED", `Limit ${limit} per ${windowSeconds}s`, undefined, { retryAfter: windowSeconds })
  }
}

/** /24 network for IPv4, /48 for IPv6 — used for per-network OTP limits (ch. 25.1). */
export function ipPrefix(ip: string): string {
  const v4 = ip.replace(/^::ffff:/, "")
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split(".").slice(0, 3).join(".") + ".0/24"
  return ip.split(":").slice(0, 3).join(":") + "::/48"
}

/**
 * Key for per-client limits: the address itself for IPv4, the /64 for IPv6 (one subscriber usually holds a whole /64,
 * so keying on the full address would hand an attacker 2^64 separate budgets).
 */
export function ipKey(ip: string): string {
  const v4 = ip.replace(/^::ffff:/, "")
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4) || !ip.includes(":")) return v4
  const [head = "", tail = ""] = ip.split("::")
  const left = head ? head.split(":") : []
  const right = tail ? tail.split(":") : []
  const full = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left
  return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "").toLowerCase()).join(":") + "::/64"
}
