import { Body, Controller, Get, HttpCode, Param, Post, Put, Patch, Req } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request } from "express"
import { z } from "zod"

import { PaymentBody, PaymentConfigPatchBody, PaymentPageView, RefundRejectBody, RefundRequestBody, StripeCredentialsBody, StripeInvoiceView, StripeModeRequestBody } from "@unitravel/contracts"
import { isLocal } from "../../core/env"

import { AppError } from "../../core/errors"
import { type Actor, CurrentActor, DevSurface, Idempotent, Public, RateLimit, RequirePermission, StaffOnly, StepUp } from "../../core/http/decorators"
import { ApiZodResponse, zbody } from "../../core/http/zod"
import { BookingsService } from "../bookings/bookings.service"
import { InvoicesService } from "../invoices/invoices.service"
import type { FakeEventKind } from "./fake-payment.adapter"
import { PaymentConfigService } from "./payment-config.service"
import { PaymentsService } from "./payments.service"
import { RefundsService } from "./refunds.service"
import { StripeInvoicesService } from "./stripe-invoices.service"

const OWN = ["flight_request.read.own", "cargo_request.read.own"] as const

/** Online payment for the signed-in customer: own invoices only, 404 otherwise (ADR-0007). */
@ApiTags("billing")
@Controller("v1/billing/invoices")
export class CustomerPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Everything the payment page shows: invoice, issuer, due date, lines, pay link or offline instructions, PDF link (ADR-0020). */
  @Get(":number/payment-page")
  @RequirePermission(...OWN)
  @ApiZodResponse(200, PaymentPageView)
  page(@Param("number") number: string, @CurrentActor() actor: Actor) {
    return this.payments.paymentPage(number, actor)
  }

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
  constructor(private readonly payments: PaymentsService, private readonly refunds: RefundsService, private readonly invoices: InvoicesService, private readonly bookings: BookingsService, private readonly stripeInvoices: StripeInvoicesService) {}

  /** ADR-0039 D4: the Stripe invoice that collects this invoice (status, hosted page, PDF, errors, eligibility). */
  @Get("invoices/:id/stripe")
  @RequirePermission(...READ)
  @ApiZodResponse(200, StripeInvoiceView)
  async stripeView(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    await this.invoices.staffById(id, actor)
    return this.stripeInvoices.view(id)
  }

  /** Creates the Stripe invoice now (or retries a failed attempt). Server-side only; amounts come from the issued invoice. */
  @Post("invoices/:id/stripe")
  @RequirePermission("commercial_document.issue")
  @HttpCode(200)
  @RateLimit({ name: "stripe-invoice-create", limit: 20, windowSeconds: 600, key: "user" })
  @ApiZodResponse(200, StripeInvoiceView)
  async stripeCreate(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    await this.invoices.staffById(id, actor)
    return this.stripeInvoices.ensure(id, { userId: actor.userId, ip: actor.ip })
  }

  /** Re-reads the Stripe invoice (status, amounts, payment) when a webhook may have been missed. */
  @Post("invoices/:id/stripe/sync")
  @RequirePermission("commercial_document.issue")
  @HttpCode(200)
  @RateLimit({ name: "stripe-invoice-sync", limit: 30, windowSeconds: 600, key: "user" })
  @ApiZodResponse(200, StripeInvoiceView)
  async stripeSync(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    await this.invoices.staffById(id, actor)
    return this.stripeInvoices.sync(id)
  }

  /** Offline money on a service invoice (ADR-0028 D9); flight and cargo payments stay on their request routes. */
  @Post("invoices/:id/payments")
  @RequirePermission("payment.record")
  @Idempotent()
  recordOffline(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(PaymentBody)) body: z.infer<typeof PaymentBody>, @CurrentActor() actor: Actor) {
    return this.bookings.recordServiceInvoicePayment(id, body, actor)
  }

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
const SimulateInvoiceBody = z.object({ kind: z.enum(["paid", "payment_failed"]), amountMinor: z.number().int().min(1).optional(), eventId: z.string().min(4).max(120).optional() })

/** Local only (FAKE provider): signs `invoice.paid` / `invoice.payment_failed` for a FAKE Stripe invoice and runs it through the real webhook handler. */
@ApiTags("dev-sink")
@Controller("v1/dev-sink/stripe-invoices")
export class DevStripeInvoiceSinkController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":providerInvoiceId/deliver")
  @Public()
  @HttpCode(200)
  async deliver(@Param("providerInvoiceId") id: string, @Body(zbody(SimulateInvoiceBody)) body: z.infer<typeof SimulateInvoiceBody>) {
    if (!isLocal()) throw new AppError("NOT_FOUND")
    const fake = await this.payments.fake()
    if (!fake) throw new AppError("NOT_FOUND")
    const event = await fake.simulateInvoice(id, body.kind, body)
    return { eventId: event.eventId, ...(await this.payments.handleWebhook(Buffer.from(event.payload), event.signature)) }
  }
}

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
