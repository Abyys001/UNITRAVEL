import { Injectable, Module, type OnModuleInit } from "@nestjs/common"

import { Queues } from "../../core/queues"
import { WorkerRegistry } from "../../core/workers"
import type { DispatchedEvent } from "../platform/outbox.dispatcher"
import { EmailSender, PushProviders, SmsProviders } from "./channels"
import { NotificationRouter } from "./notification-router"
import { NotificationsController } from "./notifications.controller"
import { NotificationsService } from "./notifications.service"
import { VendorCredentialsService } from "./vendor-credentials.service"

@Injectable()
class NotificationWorkers implements OnModuleInit {
  constructor(private readonly registry: WorkerRegistry, private readonly n: NotificationsService, private readonly router: NotificationRouter, private readonly queues: Queues) {}

  async onModuleInit() {
    this.registry.register("notify.route", (job) => this.router.handle(job.data as DispatchedEvent), 10)
    this.registry.register("notify.sms", async (job) => {
      // The OTP event arrives straight from the outbox on this queue (high priority, ch. 26.5 "< 3 s").
      if (job.name === "auth.otp_requested") return this.n.sendOtp((job.data as DispatchedEvent).payload as never)
      return this.n.processSms((job.data as { deliveryId: string }).deliveryId)
    }, 10)
    this.registry.register("notify.push", (job) => this.n.processPush((job.data as { deliveryId: string }).deliveryId, !!(job.data as { silent?: boolean }).silent), 10)
    this.registry.register("notify.email", (job) => this.n.processEmail((job.data as { deliveryId: string }).deliveryId), 5)
    this.registry.register("notify.escalate", (job) => this.n.processEscalation((job.data as { notificationId: string }).notificationId), 5)
    this.registry.registerJob("maintenance", "notify.route-health", () => this.n.checkRouteHealth())
    // Repeatable jobs are idempotent by key (ch. 30.7 trigger window is 30 min; checking every 5 min keeps alerts timely).
    await this.queues.get("maintenance").upsertJobScheduler("route-health-every-5m", { every: 5 * 60_000 }, { name: "notify.route-health" }).catch(() => undefined)
  }
}

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationRouter, SmsProviders, PushProviders, EmailSender, VendorCredentialsService, NotificationWorkers],
  exports: [NotificationsService, VendorCredentialsService, SmsProviders],
})
export class NotificationsModule {}
