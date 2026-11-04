import { Controller, Get, Header, Param, Query, Req, Res } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request, Response } from "express"
import { z } from "zod"

import { CatalogRoutesResponse, CatalogSearchQuery, CatalogSearchResponse, PublicItineraryDetail } from "@unitravel/contracts"

import { Public, RateLimit } from "../../core/http/decorators"
import { ApiZodQuery, ApiZodResponse, zbody } from "../../core/http/zod"
import { CatalogReadService } from "./catalog-read.service"

/**
 * ADR-0034 C1: the customer flight endpoints. Public, answered from stored snapshots, and unable to reach a provider: this controller
 * (and the service behind it) has no dependency on the supplier gateway or the Apify client.
 */
@ApiTags("flights")
@Controller("v1/flights")
export class CatalogReadController {
  constructor(private readonly read: CatalogReadService) {}

  @Get("search")
  @Public()
  @RateLimit({ name: "flights-search", limit: 600, windowSeconds: 60, key: "ip" })
  @ApiZodQuery(CatalogSearchQuery)
  @ApiZodResponse(200, CatalogSearchResponse)
  async search(@Query(zbody(CatalogSearchQuery)) q: CatalogSearchQuery, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.read.search(q, { ip: req.ip ?? "", ua: req.header("user-agent") ?? "" })
    if (!out.cacheable) {
      res.setHeader("Cache-Control", "no-store")
      return out.body
    }
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=900")
    res.setHeader("ETag", out.etag)
    if (req.header("if-none-match")?.split(",").map((t) => t.trim()).includes(out.etag)) {
      res.status(304)
      return undefined
    }
    return out.body
  }

  /** Static route table: `routes` is declared before `results/:id` only for readability; the paths cannot collide. */
  @Get("routes")
  @Public()
  @Header("Cache-Control", "public, max-age=3600, s-maxage=3600")
  @ApiZodResponse(200, CatalogRoutesResponse)
  routes() {
    return this.read.trackedRoutes()
  }

  @Get("results/:id")
  @Public()
  @Header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=900")
  @RateLimit({ name: "flights-detail", limit: 300, windowSeconds: 60, key: "ip" })
  @ApiZodResponse(200, PublicItineraryDetail)
  detail(@Param("id", zbody(z.uuid())) id: string) {
    return this.read.detail(id)
  }
}
