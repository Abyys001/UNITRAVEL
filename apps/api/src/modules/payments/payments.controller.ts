import { Body, Controller, Get, HttpCode, Param, Post, Put, Patch, Req } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request } from "express"
import { z } from "zod"

import { PaymentConfigPatchBody, RefundRejectBody, RefundRequestBody, StripeCredentialsBody, StripeModeRequestBody } from "@unitravel/contracts"
import { isLocal } from "../../core/env"

import { AppError } from "../../core/errors"
import { type Actor, CurrentActor, DevSurface, Public, RateLimit, RequirePermission, StaffOnly, StepUp } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { InvoicesService } from "../invoices/invoices.service"
import type { FakeEventKind } from "./fake-payment.adapter"
import { PaymentConfigService } from "./payment-config.service"
import { PaymentsService } from "./payments.service"
import { RefundsService } from "./refunds.service"

const OWN = ["flight_request.read.own", "cargo_request.read.own"] as const

/** Online payment for the signed-in customer: own invoices only, 404 otherwise (ADR-0007). */
@ApiTags("billing")
@Controller("v1/billing/invoices")
export class CustomerPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Read from our database. The return page uses this; a redirect from the provider is never proof of payment. */
  @Get(":number/payment")
  @RequirePermission(...OWN)
  state(@Param("number") number: string, @CurrentActor() actor: Actor) {
    return this.payments.state(number, actor)
  }

  /** Creates (or returns) the single open Checkout Session; amount and currency come from the invoice. */
  @Post(":number/checkout-session")
  @RequirePermission(...OWN)
  @HttpCode(200)
  @RateLimit({ name: "checkout-session", limit: 20, windowSeconds: 600, key: "user" })
  checkout(@Param("number") number: string, @CurrentActor() actor: Actor) {
    return this.payments.checkout(number, actor)
  }
}

const READ = ["flight_request.read.any", "cargo_request.read.any", "commercial_document.issue"] as const

@ApiTags("admin-payments")
@Controller("v1/admin")
@StaffOnly()
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService, private readonly refunds: RefundsService, private readonly invoices: InvoicesService) {}

  @Get("invoices/:id/payments")
  @RequirePermission(...READ)
  async view(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    await this.invoices.staffById(id, actor) // same product-line scoping as the invoice itself
    return this.refunds.staffView(id, actor)
  }

  @Post("invoices/:id/payment-link/resend")
  @RequirePermission("commercial_document.issue")
  @HttpCode(200)
  @RateLimit({ name: "payment-link-resend", limit: 10, windowSeconds: 600, key: "user" })
  resend(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.payments.resendLink(id, actor)
  }

  @Post("invoices/:id/refunds")
  @RequirePermission("payment.refund.request")
  @HttpCode(201)
  requestRefund(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(RefundRequestBody)) body: z.infer<typeof RefundRequestBody>, @CurrentActor() actor: Actor) {
    return this.refunds.request(id, body, actor)
  }

  @Post("refunds/:id/approve")
  @RequirePermission("payment.refund.approve")
  @StepUp()
  @HttpCode(200)
  approve(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.refunds.approve(id, actor)
  }

  @Post("refunds/:id/reject")
  @RequirePermission("payment.refund.approve")
  @HttpCode(200)
  reject(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(RefundRejectBody)) body: z.infer<typeof RefundRejectBody>, @CurrentActor() actor: Actor) {
    return this.refunds.reject(id, body, actor)
  }
}

/** Developer Panel: Stripe configuration (ADR-0007 P1, P2, P13). Secrets are write-only and never returned. */
@ApiTags("dev")
@Controller("v1/dev/payments")
@DevSurface()
@StaffOnly()
export class DevPaymentsController {
  constructor(private readonly config: PaymentConfigService) {}

  @Get()
  @RequirePermission("provider.config.read")
  view() {
    return this.config.view()
  }

  @Put("credentials")
  @RequirePermission("payments.configure")
  @StepUp()
  credentials(@Body(zbody(StripeCredentialsBody)) body: StripeCredentialsBody, @CurrentActor() actor: Actor) {
    return this.config.setCredentials(body, actor)
  }

  @Patch("config")
  @RequirePermission("payments.configure")
  @StepUp()
  provider(@Body(zbody(PaymentConfigPatchBody)) body: z.infer<typeof PaymentConfigPatchBody>, @CurrentActor() actor: Actor) {
    return this.config.setProvider(body.provider, actor)
  }

  @Post("mode-requests")
  @RequirePermission("payments.configure")
  @StepUp()
  @HttpCode(202)
  requestMode(@Body(zbody(StripeModeRequestBody)) body: z.infer<typeof StripeModeRequestBody>, @CurrentActor() actor: Actor) {
    return this.config.requestMode(body.mode, actor)
  }

  @Post("mode-requests/approve")
  @RequirePermission("payments.mode.approve")
  @StepUp()
  @HttpCode(200)
  approveMode(@CurrentActor() actor: Actor) {
    return this.config.approveMode(actor)
  }

  @Post("health-check")
  @RequirePermission("provider.config.read")
  @HttpCode(200)
  health() {
    return this.config.health()
  }
}

/** The Stripe webhook: no session, the signature on the raw body is the authentication (ADR-0007 P6). */
@ApiTags("webhooks")
@Controller("v1/webhooks")
export class StripeWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("stripe")
  @Public()
  @HttpCode(200)
  stripe(@Req() req: Request & { rawBody?: Buffer }) {
    if (!req.rawBody) throw new AppError("SIGNATURE_INVALID", "The raw request body is unavailable")
    return this.payments.handleWebhook(req.rawBody, req.header("stripe-signature"))
  }
}

const SimulateBody = z.object({
  kind: z.enum(["paid", "async_pending", "async_succeeded", "async_failed", "expired", "refunded", "dispute"]),
  amountMinor: z.number().int().min(1).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  eventId: z.string().min(4).max(120).optional(),
})

/**
 * Local only (APP_ENV=local, FAKE provider): there is no card form to fill in, so this endpoint builds the signed
 * Stripe-shaped event a payment would produce. `deliver` runs it through the real webhook handler; `sign` hands the
 * signed payload back so a test can POST it to /v1/webhooks/stripe like Stripe would.
 */
@ApiTags("dev-sink")
@Controller("v1/dev-sink/payments")
export class DevPaymentSinkController {
  constructor(private readonly payments: PaymentsService) {}

  private async build(sessionId: string, body: z.infer<typeof SimulateBody>) {
    if (!isLocal()) throw new AppError("NOT_FOUND")
    const fake = await this.payments.fake()
    if (!fake) throw new AppError("NOT_FOUND")
    return { fake, event: await fake.simulate(sessionId, body.kind as FakeEventKind, body) }
  }

  @Post(":sessionId/deliver")
  @Public()
  @HttpCode(200)
  async deliver(@Param("sessionId") sessionId: string, @Body(zbody(SimulateBody)) body: z.infer<typeof SimulateBody>) {
    const { event } = await this.build(sessionId, body)
    return { eventId: event.eventId, ...(await this.payments.handleWebhook(Buffer.from(event.payload), event.signature)) }
  }

  @Post(":sessionId/sign")
  @Public()
  @HttpCode(200)
  async sign(@Param("sessionId") sessionId: string, @Body(zbody(SimulateBody)) body: z.infer<typeof SimulateBody>) {
    return (await this.build(sessionId, body)).event
  }
}
