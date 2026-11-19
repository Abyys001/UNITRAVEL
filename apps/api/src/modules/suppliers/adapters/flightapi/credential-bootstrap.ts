import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common"
import type { Redis } from "ioredis"

import { env } from "../../../../core/env"
import { REDIS, UnitOfWork } from "../../../../core/infra.module"
import { PROCESS_ROLE, type ProcessRole } from "../../../../core/workers"
import { AuditService } from "../../../audit/audit.service"
import { SuppliersService } from "../../suppliers.service"
import { FLIGHTAPI_PROVIDER_ID } from "./client"

/**
 * ADR-0036 E12: a first-boot import of `FLIGHTAPI_KEY` into the encrypted credential store when none is stored, as `APIFY_TOKEN` is.
 * The provider's `enabled` flag and the catalog source are left alone. The pacer still falls back to the environment key, so nothing
 * changes for a deployment that never opens the panel. The value is never logged or audited, only its last 4 characters.
 */
@Injectable()
export class FlightapiCredentialBootstrap implements OnApplicationBootstrap {
  private readonly log = new Logger("FlightapiCredentialBootstrap")

  constructor(@Inject(PROCESS_ROLE) private readonly role: ProcessRole, @Inject(REDIS) private readonly redis: Redis, private readonly uow: UnitOfWork, private readonly suppliers: SuppliersService, private readonly audit: AuditService) {}

  async onApplicationBootstrap() {
    if (this.role !== "api") return
    await this.importFromEnv(env().FLIGHTAPI_KEY).catch((err: Error) => this.log.warn({ err: err.name }, "FlightAPI credential import skipped"))
  }

  async importFromEnv(key: string | undefined): Promise<"IMPORTED" | "NO_KEY" | "ALREADY_STORED" | "NO_PROVIDER"> {
    if (!key) return "NO_KEY"
    if (!(await this.suppliers.row(FLIGHTAPI_PROVIDER_ID))) return "NO_PROVIDER"
    if (await this.suppliers.credentialMeta(FLIGHTAPI_PROVIDER_ID)) return "ALREADY_STORED"
    // Insert-if-absent: two API processes starting together import once, and a key entered meanwhile is never replaced.
    if (!(await this.suppliers.importCredentials(FLIGHTAPI_PROVIDER_ID, { apiKey: key }))) return "ALREADY_STORED"
    const last4 = key.slice(-4)
    await this.uow.run((tx) => this.audit.record(tx, { actorKind: "SYSTEM", action: "provider.credential.imported_from_env", entityType: "provider", entityId: FLIGHTAPI_PROVIDER_ID, after: { keys: ["apiKey"], last4 } }))
    await this.suppliers.reload()
    this.log.log({ provider: FLIGHTAPI_PROVIDER_ID, last4 }, "FlightAPI key imported from the environment; it can now be replaced in the Developer Panel")
    return "IMPORTED"
  }
}
