import { Controller, Get, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import { Public, RateLimit } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { ReferenceService } from "./reference.service"

@ApiTags("reference")
@Controller("v1")
export class ReferenceController {
  constructor(private readonly ref: ReferenceService) {}

  @Get("locations")
  @Public()
  @RateLimit({ name: "locations", limit: 600, windowSeconds: 600, key: "ip" })
  locations(@Query(zbody(z.object({ q: z.string().max(60).default("") }))) q: { q: string }) {
    return this.ref.suggest(q.q)
  }
}
