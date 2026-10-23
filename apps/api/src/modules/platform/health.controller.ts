import { Controller, Get } from "@nestjs/common"
import { ApiExcludeController } from "@nestjs/swagger"

import { Public } from "../../core/http/decorators"
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
  async ready() {
    const d = await this.health.diagnostics()
    return { ready: d.database.ok && d.redis.ok, database: d.database.ok, redis: d.redis.ok }
  }
}
