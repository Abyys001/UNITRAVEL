import { hostname } from "node:os"

import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common"
import { desc, gte, isNull, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import { type Db, outboxEvents, processHeartbeats } from "@unitravel/db"

import { env } from "../../core/env"
import { DB, REDIS } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { PROCESS_ROLE, type ProcessRole } from "../../core/workers"
import { ConfigService } from "../config/config.service"

/** Each process logs and reports the configuration version it runs, so drift is visible (ch. 16.3 step 4). */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout
  readonly id = `${hostname()}:${process.pid}`

  constructor(@Inject(DB) private readonly db: Db, @Inject(PROCESS_ROLE) private readonly role: ProcessRole, private readonly config: ConfigService) {}

  onApplicationBootstrap() {
    void this.beat()
    this.timer = setInterval(() => void this.beat(), 15_000)
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer)
  }

  private async beat() {
    const versions = this.config.versions()
    await this.db.insert(processHeartbeats).values({ id: this.id, role: this.role, configVersions: versions, appVersion: env().APP_VERSION, lastHeartbeat: new Date() })
      .onConflictDoUpdate({ target: processHeartbeats.id, set: { configVersions: versions, lastHeartbeat: new Date() } }).catch(() => undefined)
  }
}

@Injectable()
export class HealthService {
  private readonly started = Date.now()

  constructor(@Inject(DB) private readonly db: Db, @Inject(REDIS) private readonly redis: Redis, private readonly queues: Queues, private readonly config: ConfigService) {}

  async liveness() {
    return { status: "ok", version: env().APP_VERSION }
  }

  async diagnostics(extraDependencies: { name: string; kind: string; ok: boolean | null; successRate: number | null; p50: number | null; p95: number | null; lastError: string | null; circuit: string | null }[] = []) {
    const t0 = Date.now()
    let dbOk = true
    let migrations = { applied: 0, latest: null as string | null }
    try {
      const r = await this.db.execute(sql`select count(*)::int as n, max(created_at)::text as latest from drizzle.__drizzle_migrations`)
      const row = r.rows[0] as { n: number; latest: string | null }
      migrations = { applied: row.n, latest: row.latest }
    } catch {
      dbOk = false
    }
    const dbLatency = Date.now() - t0
    const t1 = Date.now()
    const redisOk = (await this.redis.ping().catch(() => "ERR")) === "PONG"
    const redisLatency = Date.now() - t1
    const queues = await Promise.all(this.queues.all().map(async (q) => {
      const c = await q.getJobCounts("waiting", "active", "delayed", "failed")
      const oldest = await q.getJobs(["waiting"], 0, 0, true)
      return { name: q.name, waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, oldestWaitingSeconds: oldest[0] ? Math.round((Date.now() - oldest[0].timestamp) / 1000) : null }
    }))
    const beats = await this.db.select().from(processHeartbeats).where(gte(processHeartbeats.lastHeartbeat, new Date(Date.now() - 60_000))).orderBy(desc(processHeartbeats.lastHeartbeat))
    const pending = await this.db.select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(created_at)::text` }).from(outboxEvents).where(isNull(outboxEvents.dispatchedAt))
    return {
      version: env().APP_VERSION, commit: env().GIT_COMMIT, env: env().APP_ENV, uptimeSeconds: Math.round((Date.now() - this.started) / 1000),
      database: { ok: dbOk, latencyMs: dbLatency, migrations },
      redis: { ok: redisOk, latencyMs: redisLatency },
      queues,
      workers: beats.map((b) => ({ id: b.id, role: b.role, configVersions: b.configVersions, lastHeartbeat: b.lastHeartbeat.toISOString() })),
      configVersions: this.config.versions(),
      flags: this.config.flags(),
      dependencies: extraDependencies,
      outbox: { pending: pending[0]?.n ?? 0, oldestSeconds: pending[0]?.oldest ? Math.round((Date.now() - new Date(pending[0].oldest).getTime()) / 1000) : null },
    }
  }
}
