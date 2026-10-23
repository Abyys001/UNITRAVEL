import { Module, type Type } from "@nestjs/common"

import { BookingsService } from "./bookings/bookings.service"
import { AdminCargoController, CustomerCargoController, DevCargoController } from "./cargo/cargo.controller"
import { CargoService } from "./cargo/cargo.service"
import { ComplianceController } from "./compliance/compliance.controller"
import { ComplianceService } from "./compliance/compliance.service"
import { AdminCustomersController, TravellersController } from "./customers/customers.controller"
import { CustomersService } from "./customers/customers.service"
import { DocumentsController } from "./documents/documents.controller"
import { DocumentsService } from "./documents/documents.service"
import { NotificationsModule } from "./notifications/notifications.module"
import { StaffEvents } from "./platform/staff-events"
import { TimersService } from "./platform/timers.service"
import { FlightLifecycle } from "./requests/flight-lifecycle"
import { QuotesService } from "./requests/quotes.service"
import { AdminFlightRequestsController, CustomerFlightRequestsController } from "./requests/requests.controllers"
import { RequestsService } from "./requests/requests.service"
import { SearchController, StaffSearchController } from "./search/search.controller"
import { SearchService } from "./search/search.service"

/** Business modules (Figure 20.1 middle row) and their HTTP controllers, registered as each stage is built. */
export const BUSINESS_CONTROLLERS: Type[] = [
  DocumentsController, TravellersController, AdminCustomersController, ComplianceController, CustomerFlightRequestsController, AdminFlightRequestsController, SearchController, StaffSearchController,
  CustomerCargoController, AdminCargoController, DevCargoController,
]

export const BUSINESS_PROVIDERS = [DocumentsService, CustomersService, ComplianceService, TimersService, RequestsService, QuotesService, BookingsService, FlightLifecycle, SearchService, CargoService, StaffEvents]

@Module({ imports: [NotificationsModule], providers: BUSINESS_PROVIDERS, exports: BUSINESS_PROVIDERS })
export class BusinessModules {}
