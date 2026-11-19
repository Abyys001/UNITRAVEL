import { Controller, Get } from "@nestjs/common"
import { ApiExcludeController } from "@nestjs/swagger"

import { Public, RateLimit } from "../../core/http/decorators"
import { HealthService } from "./health.service"

@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("health")
  @Public()
  live() {
    return this.health.liveness()
  }

  @Get("ready")
  @Public()
  @RateLimit({ name: "ready", limit: 120, windowSeconds: 60, key: "ip" })
  ready() {
    return this.health.readiness()
  }
}
