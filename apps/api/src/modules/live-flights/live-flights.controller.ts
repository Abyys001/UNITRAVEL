import { Controller, Get, Header, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"

import { LiveFlightsQuery, LiveFlightsView } from "@unitravel/contracts"

import { Public, RateLimit } from "../../core/http/decorators"
import { ApiZodResponse, zbody } from "../../core/http/zod"
import { LiveFlightsService } from "./live-flights.service"

@ApiTags("live-flights")
@Controller("v1/live-flights")
export class LiveFlightsController {
  constructor(private readonly live: LiveFlightsService) {}

  /** Airline aircraft in the air now (ADR-0027). Observations only: no price, availability or route. */
  @Get()
  @Public()
  @Header("Cache-Control", "public, max-age=15")
  @RateLimit({ name: "live-flights", limit: 120, windowSeconds: 60, key: "ip" })
  @ApiZodResponse(200, LiveFlightsView)
  list(@Query(zbody(LiveFlightsQuery)) q: LiveFlightsQuery) {
    return this.live.list(q)
  }
}
