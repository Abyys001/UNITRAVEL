import { type DynamicModule, Global, Module } from "@nestjs/common"

import { AccessService } from "../modules/access/access.service"
import { AuditService } from "../modules/audit/audit.service"
import { ConfigService } from "../modules/config/config.service"
import { OutboxService } from "../modules/platform/outbox.service"
import { MfaService } from "../modules/identity/mfa.service"
import { OtpService } from "../modules/identity/otp.service"
import { PowService } from "../modules/identity/pow.service"
import { SessionsService } from "../modules/identity/sessions.service"
import { TokensService } from "../modules/identity/tokens.service"
import { ReferenceService } from "../modules/reference/reference.service"
import { RateLimiter } from "./http/rate-limit"
import { InfraModule } from "./infra.module"
import { Queues } from "./queues"
import { ObjectStorage } from "./storage"
import { PROCESS_ROLE, type ProcessRole, WorkerRegistry } from "./workers"
import { SuppliersService } from "../modules/suppliers/suppliers.service"
import { HealthService } from "../modules/platform/health.service"

/** Foundation services every business module may depend on (Figure 20.1, bottom row). */
const SERVICES = [AuditService, OutboxService, ConfigService, AccessService, TokensService, SessionsService, OtpService, PowService, MfaService, RateLimiter, Queues, WorkerRegistry, ReferenceService, ObjectStorage, SuppliersService, HealthService]

@Global()
@Module({})
export class CoreModule {
  static forRole(role: ProcessRole): DynamicModule {
    return {
      module: CoreModule,
      imports: [InfraModule],
      providers: [{ provide: PROCESS_ROLE, useValue: role }, ...SERVICES],
      exports: [InfraModule, PROCESS_ROLE, ...SERVICES],
    }
  }
}
