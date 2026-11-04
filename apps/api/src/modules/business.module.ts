import { Module, type Type } from "@nestjs/common"

import { ActivityService } from "./activity/activity.service"
import { AdminCustomerListController, MeActivityController } from "./activity/activity.controller"
import { BookingsService } from "./bookings/bookings.service"
import { AdminCargoController, CustomerCargoController, DevCargoController } from "./cargo/cargo.controller"
import { CargoService } from "./cargo/cargo.service"
import { ApifyIntegrationController, CatalogAdminController } from "./catalog/catalog-admin.controller"
import { CatalogAdminService } from "./catalog/catalog-admin.service"
import { CatalogReadController } from "./catalog/catalog-read.controller"
import { CatalogReadService } from "./catalog/catalog-read.service"
import { CatalogRefreshService } from "./catalog/catalog-refresh.service"
import { CatalogWriteService } from "./catalog/catalog-write.service"
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
import { AdminClubController, CustomerClubController } from "./loyalty/loyalty.controller"
import { LoyaltyService } from "./loyalty/loyalty.service"
import { AdminCmsController, PublicCmsController } from "./cms/cms.controller"
import { CmsService } from "./cms/cms.service"
import { BonlineAdapter } from "./support/bonline.adapter"
import { CallsService } from "./support/calls.service"
import { AdminCallsController, AdminSupportController, BonlineWebhookController, SupportTicketsController } from "./support/support.controller"
import { SupportService } from "./support/support.service"
import { TELEPHONY } from "./support/telephony.port"
import { AdminListingsController, PublicListingsController } from "./listings/listings.controller"
import { ListingsService } from "./listings/listings.service"
import { NotificationsModule } from "./notifications/notifications.module"
import { AdminAssignmentsController, AdminServiceRequestsController, CustomerServiceRequestsController } from "./services/services.controller"
import { ServicesService } from "./services/services.service"
import { AdminServicesCatalogController, PublicServicesCatalogController } from "./services-catalog/services-catalog.controller"
import { ServicesCatalogService } from "./services-catalog/services-catalog.service"
import { SiteController } from "./site/site.controller"
import { SiteService } from "./site/site.service"
import { TrackController } from "./track/track.controller"
import { TrackService } from "./track/track.service"
import { StaffEvents } from "./platform/staff-events"
import { TimersService } from "./platform/timers.service"
import { FlightLifecycle } from "./requests/flight-lifecycle"
import { QuotesService } from "./requests/quotes.service"
import { AdminFlightRequestsController, CustomerFlightRequestsController } from "./requests/requests.controllers"
import { DashboardService } from "./requests/dashboard.service"
import { RequestsService } from "./requests/requests.service"
import { SearchController, StaffSearchController } from "./search/search.controller"
import { SearchService } from "./search/search.service"
import { PageFetcher } from "./visa/page-fetcher"
import { AdminVisaController, DevVisaResearchController, PublicVisaController } from "./visa/visa.controller"
import { VisaResearchService } from "./visa/visa-research.service"
import { VisaService } from "./visa/visa.service"

/** Business modules (Figure 20.1 middle row) and their HTTP controllers, registered as each stage is built. */
export const BUSINESS_CONTROLLERS: Type[] = [
  DocumentsController, TravellersController, MyDetailsController, AdminCustomersController, AdminVerificationsController, ComplianceController, CustomerFlightRequestsController, AdminFlightRequestsController, SearchController, StaffSearchController,
  CustomerCargoController, AdminCargoController, DevCargoController, CustomerBillingController, AdminInvoicesController,
  CustomerPaymentsController, AdminPaymentsController, DevPaymentsController, StripeWebhookController, DevPaymentSinkController,
  CustomerServiceRequestsController, AdminServiceRequestsController, SiteController, TrackController, CustomerClubController, AdminClubController, PublicCmsController, AdminCmsController,
  MeActivityController, AdminCustomerListController, SupportTicketsController, AdminSupportController, AdminCallsController, BonlineWebhookController, AdminAssignmentsController, PublicListingsController, AdminListingsController,
  PublicVisaController, AdminVisaController, DevVisaResearchController,
  CatalogReadController, CatalogAdminController, ApifyIntegrationController,
  PublicServicesCatalogController, AdminServicesCatalogController,
]

export const BUSINESS_PROVIDERS = [DocumentsService, CustomersService, IdentityVerificationService, ComplianceService, TimersService, RequestsService, DashboardService, QuotesService, BookingsService, FlightLifecycle, SearchService, CargoService, StaffEvents, DocumentNumbersService, InvoicesService, PaymentsService, RefundsService, PaymentConfigService, ServicesService, SiteService, TrackService, LoyaltyService, CmsService, ActivityService, ListingsService, SupportService, ServicesCatalogService, CallsService, BonlineAdapter, { provide: TELEPHONY, useExisting: BonlineAdapter }, PageFetcher, VisaService, VisaResearchService, CatalogWriteService, CatalogRefreshService, CatalogReadService, CatalogAdminService]

@Module({ imports: [NotificationsModule], providers: BUSINESS_PROVIDERS, exports: BUSINESS_PROVIDERS })
export class BusinessModules {}
