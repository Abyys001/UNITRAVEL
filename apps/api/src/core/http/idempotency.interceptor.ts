import { createHash } from "node:crypto"

import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import type { Request, Response } from "express"
import type { Redis } from "ioredis"
import { from, type Observable, of, switchMap, tap } from "rxjs"

import { AppError } from "../errors"
import { REDIS } from "../infra.module"
import { IDEMPOTENT_KEY, type RequestContext } from "./decorators"

const KEY = /^[A-Za-z0-9_-]{8,128}$/
const TTL = 24 * 3600

/**
 * Idempotency-Key on creates and record commands (ch. 20.5): the first response is stored 24 h and replayed for
 * retries with the same key and body hash; a different body returns 422 IDEMPOTENCY_MISMATCH.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(REDIS) private readonly redis: Redis, private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [ctx.getHandler(), ctx.getClass()])) return next.handle()
    const req = ctx.switchToHttp().getRequest<Request & { ctx: RequestContext }>()
    const res = ctx.switchToHttp().getResponse<Response>()
    const key = req.header("idempotency-key")
    if (!key) return next.handle()
    if (!KEY.test(key)) throw new AppError("VALIDATION_FAILED", "Idempotency-Key must be 8–128 URL-safe characters")
    const owner = req.ctx.actor?.userId ?? req.ctx.anonKey ?? req.ip ?? "anon"
    const redisKey = `idem:${owner}:${req.method}:${req.route?.path ?? req.path}:${key}`
    const fingerprint = createHash("sha256").update(JSON.stringify(req.body ?? null)).digest("hex")
    return from(this.redis.set(redisKey, JSON.stringify({ fingerprint, status: 0 }), "EX", TTL, "NX")).pipe(
      switchMap((reserved) => {
        if (reserved) {
          return next.handle().pipe(tap({
            next: (body) => void this.redis.set(redisKey, JSON.stringify({ fingerprint, status: res.statusCode, body }), "EX", TTL),
            error: () => void this.redis.del(redisKey),
          }))
        }
        return from(this.redis.get(redisKey)).pipe(switchMap((raw) => {
          const stored = raw ? (JSON.parse(raw) as { fingerprint: string; status: number; body: unknown }) : null
          if (!stored || stored.status === 0) throw new AppError("IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is still in progress")
          if (stored.fingerprint !== fingerprint) throw new AppError("IDEMPOTENCY_MISMATCH", "Idempotency-Key was already used with a different body")
          res.status(stored.status).setHeader("Idempotent-Replayed", "true")
          return of(stored.body)
        }))
      }),
    )
  }
}
