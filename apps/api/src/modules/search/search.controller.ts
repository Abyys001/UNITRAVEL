import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request, Response } from "express"
import type { Redis } from "ioredis"
import { z } from "zod"

import { CONFIG_SCHEMAS, SearchQuery, SearchStateQuery, SimulateBody } from "@unitravel/contracts"

import { randomToken } from "../../core/crypto"
import { AppError } from "../../core/errors"
import { COOKIE_ANON } from "../../core/http/auth.guard"
import { type Actor, Authenticated, Ctx, CurrentActor, DevSurface, OptionalActor, Public, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { RateLimiter } from "../../core/http/rate-limit"
import { zbody } from "../../core/http/zod"
import { newRedis, REDIS } from "../../core/infra.module"
import { ConfigService } from "../config/config.service"
import { customerItinerary, type SearchOwner, SearchService } from "./search.service"


function owner(actor: Actor | undefined, ctx: RequestContext): SearchOwner {
  return { userId: actor?.userId, anonKey: ctx.anonKey, staff: false }
}

@ApiTags("search")
@Controller("v1")
export class SearchController {
  constructor(private readonly search: SearchService, private readonly limiter: RateLimiter, @Inject(REDIS) private readonly redis: Redis) {}

  /** 202 with the search id (< 300 ms); anonymous searches are rate-limited harder (ch. 25.7). */
  @Post("flight-searches")
  @Public()
  @HttpCode(202)
  async start(@Body(zbody(SearchQuery)) q: z.infer<typeof SearchQuery>, @OptionalActor() actor: Actor | undefined, @Ctx() ctx: RequestContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (actor) await this.limiter.enforce("search-user", actor.userId, 60, 3600)
    else await this.limiter.enforce("search-anon", req.ip ?? "?", 10, 3600)
    if (!actor && !ctx.anonKey) {
      ctx.anonKey = randomToken(18)
      res.cookie(COOKIE_ANON, ctx.anonKey, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 86400_000 })
    }
    const r = await this.search.start(q, owner(actor, ctx), ctx.locale)
    res.setHeader("Location", `/v1/flight-searches/${r.id}`)
    return r
  }

  @Get("flight-searches/:id")
  @Public()
  get(@Param("id", zbody(z.uuid())) id: string, @Query(zbody(SearchStateQuery)) q: z.infer<typeof SearchStateQuery>, @OptionalActor() actor: Actor | undefined, @Ctx() ctx: RequestContext) {
    return this.search.get(id, owner(actor, ctx), q)
  }

  /** Server-sent events: progress, results, done. Small and resumable; clients re-fetch on results (ch. 24.9). */
  @Get("flight-searches/:id/events")
  @Public()
  async events(@Param("id", zbody(z.uuid())) id: string, @OptionalActor() actor: Actor | undefined, @Ctx() ctx: RequestContext, @Req() req: Request, @Res() res: Response) {
    const channel = await this.search.subscribe(id, owner(actor, ctx))
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" })
    let seq = Number(req.header("last-event-id") ?? 0)
    const send = (event: string, data: unknown) => res.write(`id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    const state = await this.search.get(id, owner(actor, ctx), { limit: 1 })
    send("progress", { ...state.progress })
    if (state.version > 0) send("results", { version: state.version, count: state.total })
    if (state.status !== "RUNNING") { send("done", { status: state.status, count: state.total }); res.end(); return }
    const sub = newRedis()
    await sub.subscribe(channel)
    const close = () => { sub.disconnect(); res.end() }
    const timer = setTimeout(close, 60_000)
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000)
    sub.on("message", (_c, msg) => {
      const m = JSON.parse(msg) as { event: string }
      const { event, ...data } = m as { event: string } & Record<string, unknown>
      send(event, data)
      if (m.event === "done") { clearTimeout(timer); clearInterval(ping); close() }
    })
    req.on("close", () => { clearTimeout(timer); clearInterval(ping); sub.disconnect() })
    void this.redis
  }

  @Get("itineraries/:id")
  @Public()
  async itinerary(@Param("id") id: string, @OptionalActor() actor: Actor | undefined, @Ctx() ctx: RequestContext) {
    const r = await this.search.itinerary(id, owner(actor, ctx))
    return { searchId: r.searchId, itinerary: customerItinerary(r.itinerary), query: r.query }
  }

  @Post("itineraries/:id/price-check")
  @Authenticated()
  @HttpCode(200)
  priceCheck(@Param("id") id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.search.priceCheck(id, owner(actor, ctx), ctx.id)
  }

  @Get("itineraries/:id/seat-maps")
  @Authenticated()
  seatMaps(@Param("id") id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.search.seatMaps(id, owner(actor, ctx), ctx.id)
  }
}

/** Staff search with staff fields and "Add to quote" (ch. 15.2), and the rule simulator (ch. 16.2 §4). */
@ApiTags("admin-search")
@Controller("v1")
@StaffOnly()
export class StaffSearchController {
  constructor(private readonly search: SearchService, private readonly config: ConfigService) {}

  @Post("admin/flight-searches")
  @RequirePermission("flight_search.run")
  @HttpCode(202)
  start(@Body(zbody(SearchQuery)) q: z.infer<typeof SearchQuery>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    if (!actor.isStaff) throw new AppError("FORBIDDEN")
    return this.search.start(q, { userId: actor.userId, staff: true }, ctx.locale)
  }

  @Get("admin/flight-searches/:id")
  @RequirePermission("flight_search.run")
  get(@Param("id", zbody(z.uuid())) id: string, @Query(zbody(SearchStateQuery)) q: z.infer<typeof SearchStateQuery>, @CurrentActor() actor: Actor) {
    return this.search.get(id, { userId: actor.userId, staff: true }, q)
  }

  @Post("admin/itineraries/:id/price-check")
  @RequirePermission("flight_search.run")
  @HttpCode(200)
  priceCheck(@Param("id") id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.search.priceCheck(id, { userId: actor.userId, staff: true }, ctx.id)
  }

  @Get("admin/itineraries/:id")
  @RequirePermission("flight_search.run")
  async itinerary(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.search.itinerary(id, { userId: actor.userId, staff: true })
  }

  @Post("dev/config/:domain/simulate")
  @DevSurface()
  @RequirePermission("engine.rules.read", "engine.rules.publish")
  @HttpCode(200)
  async simulate(@Param("domain", zbody(z.enum(["ENGINE_RULES", "HUBS"]))) domain: "ENGINE_RULES" | "HUBS", @Body(zbody(SimulateBody.extend({ payload: z.unknown().optional() }))) body: { searchId?: string; draftVersion?: number; payload?: unknown }) {
    if (!body.searchId) throw new AppError("VALIDATION_FAILED", "Choose a stored search to simulate against", [{ path: "searchId", code: "REQUIRED" }])
    let payload = body.payload
    if (!payload && body.draftVersion) payload = (await this.config.listVersions(domain)).find((v) => v.version === body.draftVersion)?.payload
    if (!payload) throw new AppError("VALIDATION_FAILED", "Provide a draft payload or version")
    const parsed = CONFIG_SCHEMAS[domain].parse(payload)
    return this.search.simulate(body.searchId, domain === "ENGINE_RULES" ? { rules: parsed as never } : { hubs: parsed as never })
  }
}
