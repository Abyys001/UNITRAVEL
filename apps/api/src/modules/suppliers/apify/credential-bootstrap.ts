import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common"
import { eq, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import { providers } from "@unitravel/db"

import { env } from "../../../core/env"
import { REDIS, UnitOfWork } from "../../../core/infra.module"
import { PROCESS_ROLE, type ProcessRole } from "../../../core/workers"
import { AuditService } from "../../audit/audit.service"
import { OutboxService } from "../../platform/outbox.service"
import { SuppliersService } from "../suppliers.service"
import { APIFY_ID } from "./flight-data.service"

/**
 * ADR-0032 B1: a first-boot import of `APIFY_TOKEN` into the encrypted credential store. Once any credential is stored
 * (valid or marked invalid) the environment is ignored. The value is never logged or audited, only its last 4 characters.
 */
@Injectable()
export class ApifyCredentialBootstrap implements OnApplicationBootstrap {
  private readonly log = new Logger("ApifyCredentialBootstrap")

  constructor(@Inject(PROCESS_ROLE) private readonly role: ProcessRole, @Inject(REDIS) private readonly redis: Redis, private readonly uow: UnitOfWork, private readonly suppliers: SuppliersService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  async onApplicationBootstrap() {
    if (this.role !== "api") return
    await this.importFromEnv(env().APIFY_TOKEN).catch((err: Error) => this.log.warn({ err: err.name }, "Apify credential import skipped"))
  }

  async importFromEnv(token: string | undefined): Promise<"IMPORTED" | "NO_TOKEN" | "ALREADY_STORED" | "NO_PROVIDER"> {
    if (!token) return "NO_TOKEN"
    if (!(await this.suppliers.row(APIFY_ID))) return "NO_PROVIDER"
    if (await this.suppliers.credentialMeta(APIFY_ID)) return "ALREADY_STORED"
    // Insert-if-absent, so two API processes starting together import once and a credential entered meanwhile is never replaced.
    if (!(await this.suppliers.importCredentials(APIFY_ID, { token }))) return "ALREADY_STORED"
    const last4 = token.slice(-4)
    await this.uow.run(async (tx) => {
      await tx.update(providers).set({ enabled: true, version: sql`${providers.version} + 1` }).where(eq(providers.id, APIFY_ID))
      await this.audit.record(tx, { actorKind: "SYSTEM", action: "provider.credential.imported_from_env", entityType: "provider", entityId: APIFY_ID, after: { keys: ["token"], last4, enabled: true } })
      await this.outbox.add(tx, { aggregateType: "provider", aggregateId: APIFY_ID, eventType: "provider.config_changed", payload: { provider: APIFY_ID } })
    })
    await this.redis.publish("provider.config_changed", JSON.stringify({ provider: APIFY_ID }))
    await this.suppliers.reload()
    this.log.log({ provider: APIFY_ID, last4 }, "Apify credential imported from the environment; remove APIFY_TOKEN from .env")
    return "IMPORTED"
  }
}
