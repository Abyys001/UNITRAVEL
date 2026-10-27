import { Controller, Get, Header } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"

import { SiteConfig } from "@unitravel/contracts"

import { Public } from "../../core/http/decorators"
import { ApiZodResponse } from "../../core/http/zod"
import { SiteService } from "./site.service"

@ApiTags("site")
@Controller("v1/site")
export class SiteController {
  constructor(private readonly site: SiteService) {}

  /** Public and cached for 60 s in-process: the menu, support contacts and whether online payment is on. */
  @Get()
  @Public()
  @Header("Cache-Control", "public, max-age=60")
  @ApiZodResponse(200, SiteConfig)
  get() {
    return this.site.get()
  }
}
