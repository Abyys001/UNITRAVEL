import { type DynamicModule, Module } from "@nestjs/common"
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core"

import { CoreModule } from "./core/core.module"
import { AuthGuard } from "./core/http/auth.guard"
import { IdempotencyInterceptor } from "./core/http/idempotency.interceptor"
import { ProblemFilter } from "./core/http/problem.filter"
import { Logging } from "./core/logging"
import type { ProcessRole } from "./core/workers"
import { DevSystemController } from "./modules/dev/dev-system.controller"
import { DevUsersController } from "./modules/dev/dev-users.controller"
import { AuthController } from "./modules/identity/auth.controller"
import { MeController } from "./modules/identity/me.controller"
import { NotificationsModule } from "./modules/notifications/notifications.module"
import { HealthController } from "./modules/platform/health.controller"
import { HeartbeatService } from "./modules/platform/health.service"
import { OutboxDispatcher } from "./modules/platform/outbox.dispatcher"
import { ReferenceController } from "./modules/reference/reference.controller"
import { DevProvidersController } from "./modules/suppliers/dev-providers.controller"
import { BUSINESS_CONTROLLERS, BusinessModules } from "./modules/business.module"

export const API_CONTROLLERS = [HealthController, AuthController, MeController, ReferenceController, DevUsersController, DevSystemController, DevProvidersController]

/** One codebase, two process roles (ADR-01): `api` serves HTTP, `worker` runs BullMQ consumers, timers and the outbox. */
@Module({})
export class AppModule {
  static forRole(role: ProcessRole): DynamicModule {
    return {
      module: AppModule,
      imports: [Logging, CoreModule.forRole(role), NotificationsModule, BusinessModules],
      controllers: role === "api" ? [...API_CONTROLLERS, ...BUSINESS_CONTROLLERS] : [],
      providers: [
        HeartbeatService,
        ...(role === "worker" ? [OutboxDispatcher] : []),
        ...(role === "api" ? [{ provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }, { provide: APP_FILTER, useClass: ProblemFilter }] : []),
      ],
    }
  }
}
