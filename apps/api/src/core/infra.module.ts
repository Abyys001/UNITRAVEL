import { Global, Inject, Injectable, Module, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common"
import { Redis } from "ioredis"

import { createDb, type Db, type Tx } from "@unitravel/db"

import { env, isLocal } from "./env"

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

/**
 * The app must connect as the least-privileged app_rw role: a superuser or the schema owner is not bound by the
 * insert-only grants or (as owner) could drop the append-only triggers. Checked at start-up on deployed hosts.
 */
@Injectable()
class DbPrivilegeCheck implements OnModuleInit {
  constructor(@Inject("PG_POOL") private readonly pool: { query(sql: string): Promise<{ rows: { rolsuper: boolean; owns: boolean; role: string }[] }> }) {}
  async onModuleInit() {
    if (isLocal()) return
    const { rows } = await this.pool.query("select current_user as role, r.rolsuper, exists(select 1 from pg_tables where schemaname = 'public' and tableowner = current_user) as owns from pg_roles r where r.rolname = current_user")
    const r = rows[0]
    if (!r || r.rolsuper || r.owns) throw new Error(`DATABASE_URL connects as "${r?.role}", a superuser or the schema owner; use the app_rw role (DATABASE_MIGRATE_URL is for migrations only)`)
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
    DbPrivilegeCheck,
  ],
  exports: [DB, REDIS, "PG_POOL", UnitOfWork],
})
export class InfraModule {}
