import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import {
  CuratedListingBody, CuratedListingPatch, FlightListingsView, ListingPath, PublicListingQuery, PublicListingsView, StaffListingPage, StaffListingQuery, StaffListingView,
} from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, Public, RateLimit, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { ListingsService } from "./listings.service"

/** Public listings (ADR-0021). `flights` is declared first so it is never read as a `:vertical`. */
@ApiTags("listings")
@Controller("v1/listings")
export class PublicListingsController {
  constructor(private readonly listings: ListingsService) {}

  /** Cached live-adapter results only, each with CACHED_OFFER and fetchedAt; empty with notice NO_SOURCES otherwise. No amounts. */
  @Get("flights")
  @Public()
  @Header("Cache-Control", "public, max-age=60")
  @RateLimit({ name: "listings", limit: 120, windowSeconds: 60, key: "ip" })
  @ApiZodResponse(200, FlightListingsView)
  flights(@Query(zbody(PublicListingQuery)) q: PublicListingQuery) {
    return this.listings.flights(q)
  }

  /** Published, staff-curated, indicative rows. A price appears only when staff quoted one. */
  @Get(":vertical")
  @Public()
  @Header("Cache-Control", "public, max-age=60")
  @RateLimit({ name: "listings", limit: 120, windowSeconds: 60, key: "ip" })
  @ApiZodResponse(200, PublicListingsView)
  list(@Param("vertical", zbody(ListingPath)) vertical: z.infer<typeof ListingPath>, @Query(zbody(PublicListingQuery)) q: PublicListingQuery) {
    return this.listings.publicList(vertical, q)
  }
}

@ApiTags("admin-listings")
@Controller("v1/admin/listings")
@StaffOnly()
export class AdminListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @RequirePermission("listings.write")
  @ApiZodResponse(200, StaffListingPage)
  list(@Query(zbody(StaffListingQuery)) q: StaffListingQuery) {
    return this.listings.staffList(q)
  }

  @Get(":id")
  @RequirePermission("listings.write")
  @ApiZodResponse(200, StaffListingView)
  detail(@Param("id", zbody(z.uuid())) id: string) {
    return this.listings.staffGet(id)
  }

  @Post()
  @RequirePermission("listings.write")
  @HttpCode(201)
  @ApiZodBody(CuratedListingBody)
  @ApiZodResponse(201, StaffListingView)
  create(@Body(zbody(CuratedListingBody)) body: CuratedListingBody, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.listings.create(body, actor, ctx.id)
  }

  /** Optimistic `version`; `status` publishes, archives or returns a row to draft. */
  @Patch(":id")
  @RequirePermission("listings.write")
  @ApiZodBody(CuratedListingPatch)
  @ApiZodResponse(200, StaffListingView)
  update(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(CuratedListingPatch)) body: CuratedListingPatch, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.listings.update(id, body, actor, ctx.id)
  }
}
