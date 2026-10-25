import { Module, type Type } from "@nestjs/common"

import { BookingsService } from "./bookings/bookings.service"
import { AdminCargoController, CustomerCargoController, DevCargoController } from "./cargo/cargo.controller"
import { CargoService } from "./cargo/cargo.service"
import { ComplianceController } from "./compliance/compliance.controller"
import { ComplianceService } from "./compliance/compliance.service"
import { AdminCustomersController, AdminVerificationsController, MyDetailsController, TravellersController } from "./customers/customers.controller"
import { CustomersService } from "./customers/customers.service"
import { IdentityVerificationService } from "./customers/identity-verification.service"
import { DocumentsController } from "./documents/documents.controller"
import { DocumentsService } from "./documents/documents.service"
import { DocumentNumbersService } from "./invoices/document-numbers.service"
import { AdminInvoicesController, CustomerBillingController } from "./invoices/invoices.controller"
import { InvoicesService } from "./invoices/invoices.service"
import { PaymentConfigService } from "./payments/payment-config.service"
import { AdminPaymentsController, CustomerPaymentsController, DevPaymentSinkController, DevPaymentsController, StripeWebhookController } from "./payments/payments.controller"
import { PaymentsService } from "./payments/payments.service"
import { RefundsService } from "./payments/refunds.service"
import { NotificationsModule } from "./notifications/notifications.module"
import { StaffEvents } from "./platform/staff-events"
import { TimersService } from "./platform/timers.service"
import { FlightLifecycle } from "./requests/flight-lifecycle"
import { QuotesService } from "./requests/quotes.service"
import { AdminFlightRequestsController, CustomerFlightRequestsController } from "./requests/requests.controllers"
import { DashboardService } from "./requests/dashboard.service"
import { RequestsService } from "./requests/requests.service"
import { SearchController, StaffSearchController } from "./search/search.controller"
import { SearchService } from "./search/search.service"

/** Business modules (Figure 20.1 middle row) and their HTTP controllers, registered as each stage is built. */
export const BUSINESS_CONTROLLERS: Type[] = [
  DocumentsController, TravellersController, MyDetailsController, AdminCustomersController, AdminVerificationsController, ComplianceController, CustomerFlightRequestsController, AdminFlightRequestsController, SearchController, StaffSearchController,
  CustomerCargoController, AdminCargoController, DevCargoController, CustomerBillingController, AdminInvoicesController,
  CustomerPaymentsController, AdminPaymentsController, DevPaymentsController, StripeWebhookController, DevPaymentSinkController,
]

export const BUSINESS_PROVIDERS = [DocumentsService, CustomersService, IdentityVerificationService, ComplianceService, TimersService, RequestsService, DashboardService, QuotesService, BookingsService, FlightLifecycle, SearchService, CargoService, StaffEvents, DocumentNumbersService, InvoicesService, PaymentsService, RefundsService, PaymentConfigService]

@Module({ imports: [NotificationsModule], providers: BUSINESS_PROVIDERS, exports: BUSINESS_PROVIDERS })
export class BusinessModules {}
