import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common"
import { ApiOperation, ApiTags } from "@nestjs/swagger"
import type { Request, Response } from "express"
import { z } from "zod"

import {
  AmendFlightRequestBody,
  AfterSalesBody, CommandBodies, ContactAttemptBody, CreateFlightRequestBody, FLIGHT_COMMANDS, MessageBody, NoteBody, PaymentBody, QuoteDraftBody, ReservationBody, TicketsBody,
} from "@unitravel/contracts"

import { AppError } from "../../core/errors"
import { UnitOfWork } from "../../core/infra.module"
import { type Actor, Ctx, CurrentActor, Idempotent, RateLimit, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { AccessService } from "../access/access.service"
import { BookingsService } from "../bookings/bookings.service"
import { StaffEvents } from "../platform/staff-events"
import { DashboardService } from "./dashboard.service"
import { QuotesService } from "./quotes.service"
import { RequestsService } from "./requests.service"

const ifMatch = (v?: string) => (v === undefined || v === "" ? undefined : Number(v.replace(/"/g, "")))
const via = (a: Actor) => (a.audience === "mobile" ? "MOBILE" : a.audience === "console" ? "CONSOLE" : "WEB") as "WEB" | "MOBILE" | "CONSOLE"

/** Customer endpoints (ch. 24.3): ownership checked on every call; customer serialisation only. */
@ApiTags("flight-requests")
@Controller("v1/flight-requests")
export class CustomerFlightRequestsController {
  constructor(private readonly requests: RequestsService, private readonly bookings: BookingsService) {}

  @Post()
  @RequirePermission("flight_request.create.own")
  @Idempotent()
  @RateLimit({ name: "customer-writes", limit: 60, windowSeconds: 3600, key: "user" })
  create(@Body(zbody(CreateFlightRequestBody)) body: z.infer<typeof CreateFlightRequestBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.requests.create(body, actor, { requestId: ctx.id, locale: ctx.locale, via: via(actor) })
  }

  @Get()
  @RequirePermission("flight_request.read.own")
  list(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.requests.customerList(actor.userId, ctx.locale)
  }

  @Get(":ref")
  @RequirePermission("flight_request.read.own")
  detail(@Param("ref") ref: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.requests.customerDetail(ref, actor, ctx.locale)
  }

  @Post(":ref/messages")
  @RequirePermission("flight_request.read.own")
  @RateLimit({ name: "customer-writes", limit: 60, windowSeconds: 3600, key: "user" })
  message(@Param("ref") ref: string, @Body(zbody(MessageBody)) body: z.infer<typeof MessageBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.requests.customerMessage(ref, actor, body.body, body.documentIds, ctx.id)
  }

  @Post(":ref/quotes/:quoteId/accept")
  @RequirePermission("flight_request.read.own")
  @Idempotent()
  @HttpCode(200)
  async accept(@Param("ref") ref: string, @Param("quoteId", zbody(z.uuid())) quoteId: string, @Body(zbody(z.object({ optionId: z.uuid() }))) body: { optionId: string }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.requests.acceptQuote(ref, quoteId, body.optionId, actor, ctx.id)
    return this.requests.customerDetail(ref, actor, ctx.locale)
  }

  @Post(":ref/quotes/:quoteId/decline")
  @RequirePermission("flight_request.read.own")
  @HttpCode(200)
  async decline(@Param("ref") ref: string, @Param("quoteId", zbody(z.uuid())) quoteId: string, @Body(zbody(z.object({ reason: z.string().max(1000).optional() }))) body: { reason?: string }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.requests.declineQuote(ref, quoteId, actor, ctx.id, body.reason)
    return this.requests.customerDetail(ref, actor, ctx.locale)
  }

  @Post(":ref/cancel")
  @RequirePermission("flight_request.read.own")
  @HttpCode(200)
  async cancel(@Param("ref") ref: string, @Body(zbody(z.object({ reason: z.string().max(1000).optional() }))) body: { reason?: string }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.requests.customerCancel(ref, actor, ctx.id, body.reason)
    return this.requests.customerDetail(ref, actor, ctx.locale)
  }

  @Post(":ref/after-sales")
  @RequirePermission("flight_request.read.own")
  afterSales(@Param("ref") ref: string, @Body(zbody(AfterSalesBody)) body: z.infer<typeof AfterSalesBody>, @CurrentActor() actor: Actor) {
    return this.bookings.createAfterSales(ref, body, actor, true)
  }
}

/** Admin Panel endpoints (ch. 24.4): commands, not fields; If-Match on every command. */
@ApiTags("admin-flight-requests")
@Controller("v1/admin")
@StaffOnly()
export class AdminFlightRequestsController {
  constructor(private readonly requests: RequestsService, private readonly quotes: QuotesService, private readonly bookings: BookingsService, private readonly uow: UnitOfWork, private readonly access: AccessService, private readonly staffEvents: StaffEvents, private readonly dashboard: DashboardService) {}

  /** Staff directory for the assign dialog: whoever may assign needs to see who can be assigned. */
  @Get("staff")
  @RequirePermission("flight_request.assign")
  staff() {
    return this.access.staffDirectory().then((items) => ({ items }))
  }

  /** Dashboard aggregates (counts and sums over existing rows; sections the viewer cannot read are null). */
  @Get("dashboard/metrics")
  @ApiOperation({ summary: "Admin dashboard metrics", description: "DashboardMetrics: daily submissions (Europe/London days), open requests by status, first-contact SLA outcome, invoice status counts; invoice money only with pricing.read.internal." })
  @RequirePermission("flight_request.read.any", "cargo_request.read.any")
  @RateLimit({ name: "dashboard-metrics", limit: 120, windowSeconds: 60, key: "user" })
  metrics(@Query(zbody(z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }))) q: { days: number }, @CurrentActor() actor: Actor) {
    return this.dashboard.metrics(actor, q.days)
  }

  @Get("queues/summary")
  @RequirePermission("flight_request.read.any", "cargo_request.read.any")
  summary(@CurrentActor() actor: Actor) {
    return this.requests.queueSummary(actor)
  }

  /**
   * Server-sent events for the console (ch. 29.2): `queue-counts` whenever the summary changes and
   * `request-changed {requestType, ref, version, status, statusLabel}` for every request event. Streams end after 5 minutes so the browser
   * reconnects through the auth guard again (permissions, idle timeout).
   */
  @Get("events")
  @ApiOperation({ summary: "Staff live events (SSE)", description: "text/event-stream. `queue-counts` carries the queue summary; `request-changed` carries StaffRequestChangedEvent {requestType, ref, version, status, statusLabel}." })
  @RequirePermission("flight_request.read.any", "cargo_request.read.any")
  async events(@CurrentActor() actor: Actor, @Req() req: Request, @Res() res: Response) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" })
    res.write("retry: 3000\n\n")
    let seq = 0
    let open = true
    const send = (event: string, data: unknown) => { if (open) res.write(`id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
    let last = ""
    const counts = async () => {
      const s = JSON.stringify(await this.requests.queueSummary(actor))
      if (s !== last) { last = s; send("queue-counts", JSON.parse(s)) }
    }
    let debounce: NodeJS.Timeout | undefined
    const off = this.staffEvents.listen((s) => {
      void this.requests.refVersion(s.aggregateType, s.aggregateId).then((v) => v && send("request-changed", v)).catch(() => undefined)
      debounce ??= setTimeout(() => { debounce = undefined; void counts().catch(() => undefined) }, 250)
    })
    // SLA breaches and deadline windows move with the clock, not with events.
    const tick = setInterval(() => void counts().catch(() => undefined), 60_000)
    const ping = setInterval(() => { if (open) res.write(": ping\n\n") }, 15_000)
    const close = () => {
      if (!open) return
      open = false
      off(); clearInterval(tick); clearInterval(ping); clearTimeout(end); if (debounce) clearTimeout(debounce)
      res.end()
    }
    const end = setTimeout(close, 5 * 60_000)
    req.on("close", close)
    await counts().catch(() => undefined)
  }

  @Get("flight-requests")
  @RequirePermission("flight_request.read.any")
  list(@Query(zbody(z.object({ tab: z.string().optional(), status: z.string().optional(), assignee: z.string().optional(), q: z.string().max(60).optional(), from: z.string().optional(), to: z.string().optional(), flags: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().optional() }))) q: { tab?: string; status?: string; assignee?: string; q?: string; from?: string; to?: string; flags?: string; limit: number; cursor?: string }, @CurrentActor() actor: Actor) {
    return this.requests.adminList(q, actor)
  }

  @Get("flight-requests/:ref")
  @RequirePermission("flight_request.read.any")
  detail(@Param("ref") ref: string, @CurrentActor() actor: Actor) {
    return this.requests.staffDetail(ref, actor)
  }

  @Post("flight-requests/:ref/commands/:command")
  @RequirePermission("flight_request.transition", "flight_request.assign", "quote.create", "commercial_document.issue", "compliance.case.decide")
  @HttpCode(200)
  async command(@Param("ref") ref: string, @Param("command") command: string, @Body() raw: unknown, @Headers("if-match") im: string | undefined, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    if (!(FLIGHT_COMMANDS as readonly string[]).includes(command)) throw new AppError("NOT_FOUND", "Unknown command")
    const body = CommandBodies[command as keyof typeof CommandBodies].parse(raw ?? {}) as Record<string, unknown>
    await this.requests.staffCommand(ref, command, body, actor, ifMatch(im), ctx.id)
    if (command === "send_quote") {
      const r = await this.requests.byRef(ref)
      await this.uow.run((tx) => this.bookings.quotePdf(tx, r, String(body.quoteId), actor))
    }
    return this.requests.staffDetail(ref, actor)
  }

  @Post("flight-requests/:ref/notes")
  @RequirePermission("flight_request.note.internal")
  note(@Param("ref") ref: string, @Body(zbody(NoteBody)) body: { body: string }, @CurrentActor() actor: Actor) {
    return this.requests.note(ref, actor, body.body)
  }

  @Post("flight-requests/:ref/messages")
  @RequirePermission("flight_request.transition")
  message(@Param("ref") ref: string, @Body(zbody(MessageBody)) body: z.infer<typeof MessageBody>, @CurrentActor() actor: Actor) {
    return this.requests.staffMessage(ref, actor, body.body, body.documentIds)
  }

  @Post("flight-requests/:ref/amend")
  @HttpCode(200)
  @RequirePermission("flight_request.transition")
  @ApiOperation({ summary: "Amend the trip and/or travellers with a reason (ADR-0013); not a status change" })
  amend(@Param("ref") ref: string, @Body(zbody(AmendFlightRequestBody)) body: AmendFlightRequestBody, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.requests.amend(ref, body, actor, ctx.id)
  }

  @Post("flight-requests/:ref/contact-attempts")
  @RequirePermission("flight_request.transition")
  contact(@Param("ref") ref: string, @Body(zbody(ContactAttemptBody)) body: z.infer<typeof ContactAttemptBody>, @CurrentActor() actor: Actor) {
    return this.requests.contactAttempt(ref, actor, body)
  }

  @Get("flight-requests/:ref/quotes/from-snapshot")
  @RequirePermission("pricing.read.internal")
  fromSnapshot(@Param("ref") ref: string) {
    return this.quotes.fromSnapshot(ref)
  }

  @Post("flight-requests/:ref/quotes")
  @RequirePermission("pricing.write")
  draft(@Param("ref") ref: string, @Body(zbody(QuoteDraftBody)) body: z.infer<typeof QuoteDraftBody>, @CurrentActor() actor: Actor) {
    return this.quotes.createDraft(ref, body, actor)
  }

  @Patch("flight-requests/:ref/quotes/:id")
  @RequirePermission("pricing.write")
  editDraft(@Param("ref") ref: string, @Param("id", zbody(z.uuid())) id: string, @Body(zbody(QuoteDraftBody)) body: z.infer<typeof QuoteDraftBody>, @Headers("if-match") im: string | undefined, @CurrentActor() actor: Actor) {
    return this.quotes.updateDraft(ref, id, body, actor, ifMatch(im))
  }

  @Get("flight-requests/:ref/quotes/:id")
  @RequirePermission("quote.create", "flight_request.read.any")
  quote(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.quotes.view(id, actor)
  }

  @Post("flight-requests/:ref/reservations")
  @RequirePermission("reservation.record")
  @Idempotent()
  async reservation(@Param("ref") ref: string, @Body(zbody(ReservationBody)) body: z.infer<typeof ReservationBody>, @Headers("if-match") im: string | undefined, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.bookings.recordReservation(ref, body, actor, ifMatch(im), ctx.id)
    return this.requests.staffDetail(ref, actor)
  }

  @Post("flight-requests/:ref/reservations/:id/cancel")
  @RequirePermission("reservation.record")
  @HttpCode(200)
  cancelReservation(@Param("ref") ref: string, @Param("id", zbody(z.uuid())) id: string, @Body(zbody(z.object({ reason: z.string().min(3) }))) body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.bookings.cancelReservation(ref, id, body.reason, actor)
  }

  @Post("flight-requests/:ref/tickets")
  @RequirePermission("ticket.record")
  @Idempotent()
  async tickets(@Param("ref") ref: string, @Body(zbody(TicketsBody)) body: z.infer<typeof TicketsBody>, @Headers("if-match") im: string | undefined, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const r = await this.bookings.recordTickets(ref, body, actor, ifMatch(im), ctx.id)
    return { ...r, request: await this.requests.staffDetail(ref, actor) }
  }

  @Post("flight-requests/:ref/payments")
  @RequirePermission("payment.record")
  @Idempotent()
  payment(@Param("ref") ref: string, @Body(zbody(PaymentBody)) body: z.infer<typeof PaymentBody>, @CurrentActor() actor: Actor) {
    return this.bookings.recordPayment(ref, body, actor)
  }

  @Post("payments/:id/verify")
  @RequirePermission("payment.record")
  @HttpCode(200)
  verify(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.bookings.verifyPayment(id, actor, ctx.id)
  }

  @Post("flight-requests/:ref/credit-override")
  @RequirePermission("ticket.record")
  creditOverride(@Param("ref") ref: string, @Body(zbody(z.object({ reason: z.string().min(5) }))) body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.bookings.requestCreditOverride(ref, body.reason, actor)
  }

  /** Owner approval (owner-only permission user.role.assign.privileged). */
  @Post("credit-overrides/:id/approve")
  @RequirePermission("user.role.assign.privileged")
  @HttpCode(200)
  approveOverride(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.bookings.approveCreditOverride(id, actor)
  }

  @Post("flight-requests/:ref/after-sales")
  @RequirePermission("flight_request.transition")
  afterSales(@Param("ref") ref: string, @Body(zbody(AfterSalesBody)) body: z.infer<typeof AfterSalesBody>, @CurrentActor() actor: Actor) {
    return this.bookings.createAfterSales(ref, body, actor, false)
  }

  @Post("after-sales/:ref/commands/:command")
  @RequirePermission("flight_request.transition")
  @HttpCode(200)
  afterSalesCommand(@Param("ref") ref: string, @Param("command", zbody(z.enum(["start", "request_info", "resolve", "reject"]))) command: "start" | "request_info" | "resolve" | "reject", @Body(zbody(z.object({ message: z.string().optional(), resolutionNote: z.string().optional(), ticketStatus: z.enum(["EXCHANGED", "REFUNDED", "VOIDED"]).optional() }))) body: { message?: string; resolutionNote?: string; ticketStatus?: "EXCHANGED" | "REFUNDED" | "VOIDED" }, @CurrentActor() actor: Actor) {
    return this.bookings.afterSalesCommand(ref, command, body, actor, false)
  }
}
