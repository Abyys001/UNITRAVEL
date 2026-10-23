import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common"
import { Redis } from "ioredis"

import { createDb, type Db, type Tx } from "@unitravel/db"

import { env } from "./env"

export const DB = Symbol("DB")
export const REDIS = Symbol("REDIS")

/** Business rows + history + audit + outbox commit together (ch. 20.4 step 7). */
@Injectable()
export class UnitOfWork {
  constructor(@Inject(DB) private readonly db: Db) {}

  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn)
  }
}

@Injectable()
class Shutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis, @Inject("PG_POOL") private readonly pool: { end(): Promise<void> }) {}
  async onApplicationShutdown() {
    this.redis.disconnect()
    await this.pool.end()
  }
}

export function newRedis(): Redis {
  return new Redis(env().REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true })
}

@Global()
@Module({
  providers: [
    { provide: "DB_BUNDLE", useFactory: () => createDb(env().DATABASE_URL) },
    { provide: DB, useFactory: (b: ReturnType<typeof createDb>) => b.db, inject: ["DB_BUNDLE"] },
    { provide: "PG_POOL", useFactory: (b: ReturnType<typeof createDb>) => b.pool, inject: ["DB_BUNDLE"] },
    { provide: REDIS, useFactory: newRedis },
    UnitOfWork,
    Shutdown,
  ],
  exports: [DB, REDIS, "PG_POOL", UnitOfWork],
})
export class InfraModule {}
