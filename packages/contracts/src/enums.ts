import { z } from "zod"

// Chapter 12.9 — ticket and fare variants.
export const TripType = z.enum(["ONE_WAY", "RETURN", "OPEN_JAW", "MULTI_CITY"])
export const Cabin = z.enum(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"])
export const PassengerType = z.enum(["ADT", "CHD", "INF", "INS", "YTH", "STU"])
export const TicketingModel = z.enum(["SINGLE_TICKET", "SEPARATE_TICKETS"])
export const ProductType = z.enum(["FLIGHT", "CARGO"])
export const Construction = z.enum(["THROUGH", "SELF_TRANSFER", "GATEWAY"])
export const Rung = z.enum(["CACHED_OFFER", "LIVE_OFFER", "PRICED_OFFER", "MANUAL"])
export const ResultTab = z.enum(["BEST", "CHEAPEST", "FASTEST", "SINGLE_TICKET"])
export const RiskFlag = z.enum([
  "SEPARATE_TICKETS", "AIRPORT_CHANGE", "OVERNIGHT", "TIGHT", "TERMINAL_CHANGE", "TERMINAL_UNKNOWN", "ENTRY_REQUIRED",
])

// Chapter 13.2 — flight request fulfilment and payment status.
export const FlightRequestStatus = z.enum([
  "SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED",
  "ACCEPTED", "RESERVED", "TICKETED", "COMPLETED", "DECLINED", "CANCELLED", "EXPIRED",
])
export const PaymentStatus = z.enum(["NONE", "PARTIAL", "PAID", "REFUND_PENDING", "REFUNDED"])
export const FlightRequestKind = z.enum(["ITINERARY", "MANUAL"])

// Chapter 14.5 — cargo.
export const CargoStatus = z.enum([
  "SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "BOOKED",
  "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED",
  "EXCEPTION", "DECLINED", "CANCELLED", "EXPIRED",
])
export const CargoService = z.enum(["DOCUMENTS", "PARCEL", "EXCESS_BAGGAGE", "AIR_FREIGHT"])
export const CargoPurpose = z.enum(["PERSONAL_EFFECTS", "GIFT", "DOCUMENTS", "SALE", "SAMPLE", "RETURN"])
export const GoodsCategory = z.enum([
  "DOCUMENTS", "CLOTHING", "PERSONAL_EFFECTS", "BOOKS", "FOOD_NON_PERISHABLE", "COSMETICS", "MEDICINES",
  "MEDICAL_DEVICES", "ELECTRONICS", "LITHIUM_BATTERIES", "AIRCRAFT_VEHICLE_INDUSTRIAL_PARTS", "JEWELLERY_ART",
  "WEAPONS", "AMMUNITION", "EXPLOSIVES", "NARCOTICS", "COUNTERFEIT", "CASH_BEARER_INSTRUMENTS", "DANGEROUS_GOODS", "OTHER",
])
export const ScreeningOutcome = z.enum(["ALLOWED", "REVIEW", "PROHIBITED"])
export const PartnerType = z.enum(["COURIER", "CONSOLIDATOR", "FORWARDER", "BAGGAGE_SHIPPER"])
export const IntegrationLevel = z.enum(["MANUAL", "EMAIL", "API"])
export const AvailabilityStatus = z.enum(["AVAILABLE", "SUSPENDED", "UNKNOWN"])
export const HandoverMode = z.enum(["PICKUP", "DROP_OFF"])
export const Incoterm = z.enum(["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"])

// Chapter 13.6–13.8 — quotes, records, after-sales.
export const QuoteStatus = z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "SUPERSEDED"])
export const QuoteOptionSource = z.enum(["SNAPSHOT", "STAFF_SEARCH", "MANUAL"])
export const ReservationSystem = z.enum(["AMADEUS_TERMINAL", "DUFFEL_API", "PARTNER", "AIRLINE_DIRECT"])
export const ReservationStatus = z.enum(["HELD", "CONFIRMED", "CANCELLED", "LAPSED"])
export const TicketStatus = z.enum(["ISSUED", "VOIDED", "EXCHANGED", "REFUNDED"])
export const PaymentMethod = z.enum(["BANK_TRANSFER", "CASH", "CARD_TERMINAL", "OTHER", "CARD_ONLINE"])
export const PaymentRecordStatus = z.enum(["RECORDED", "VERIFIED", "REJECTED", "REFUNDED"])
export const AfterSalesType = z.enum(["CHANGE", "REFUND", "CANCEL"])
export const AfterSalesStatus = z.enum(["OPEN", "IN_PROGRESS", "AWAITING_CUSTOMER", "RESOLVED", "REJECTED"])
export const ContactOutcome = z.enum(["REACHED", "NO_ANSWER", "BUSY", "WRONG_NUMBER", "CALL_BACK_REQUESTED"])
export const ContactChannel = z.enum(["PHONE", "SMS_TEMPLATE"])
export const RequestType = z.enum(["FLIGHT", "CARGO", "AFTER_SALES", "SERVICE"])
export const AtolMode = z.enum(["PAY_ON_TICKETING", "AGENT_FOR_ATOL_HOLDER", "OWN_ATOL"])

// Chapter 23.3 — identity.
export const UserStatus = z.enum(["ACTIVE", "SUSPENDED", "DELETED"])
export const Locale = z.enum(["en", "fa"])
export const CalendarPref = z.enum(["GREGORIAN", "JALALI"])
export const IdentityType = z.enum(["PHONE", "EMAIL"])
export const OtpPurpose = z.enum(["SIGN_IN", "VERIFY_PHONE", "VERIFY_EMAIL", "STEP_UP"])
export const ClientKind = z.enum(["WEB", "CONSOLE", "MOBILE"])
export const DevicePlatform = z.enum(["IOS", "ANDROID", "WEB"])
export const PushProvider = z.enum(["EXPO", "PUSHY", "WEBPUSH"])
export const MfaType = z.enum(["TOTP", "WEBAUTHN"])
export const ActorKind = z.enum(["CUSTOMER", "STAFF", "SYSTEM", "ANONYMOUS"])
export const TravellerRelationship = z.enum(["SELF", "FAMILY", "OTHER"])
export const DocumentKind = z.enum(["PASSPORT", "NATIONAL_ID"])
/** ADR-0005 V1. */
export const VerificationStatus = z.enum(["UNVERIFIED", "SUBMITTED", "VERIFIED", "REJECTED", "CORRECTION_REQUIRED"])
export const VerificationDecision = z.enum(["VERIFIED", "REJECTED", "CORRECTION_REQUIRED"])
export const VerificationReasonCode = z.enum(["UNREADABLE_SCAN", "NAME_MISMATCH", "NUMBER_MISMATCH", "DOB_MISMATCH", "NATIONALITY_MISMATCH", "EXPIRY_MISMATCH", "EXPIRED_DOCUMENT", "NOT_A_PASSPORT", "SCAN_INCOMPLETE", "OTHER"])
export const Gender = z.enum(["M", "F", "X"])
export const Title = z.enum(["MR", "MRS", "MS", "MISS", "MSTR", "DR"])

// Chapter 23.9 — compliance.
export const SanctionListId = z.enum(["UK", "OFAC_SDN", "OFAC_NON_SDN", "EU"])
export const SanctionEntryType = z.enum(["PERSON", "ENTITY", "VESSEL", "AIRCRAFT"])
export const ScreeningSubject = z.enum(["CUSTOMER", "TRAVELLER", "PAYER", "SHIPPER", "CONSIGNEE", "PARTNER", "CARRIER", "GOODS"])
export const ScreeningResult = z.enum(["CLEAR", "POSSIBLE_MATCH", "MATCH"])
export const PolicyType = z.enum(["CARRIER", "AIRPORT", "COUNTRY_ROUTE", "GOODS_CATEGORY", "KEYWORD", "LANE", "ONLINE_PAYMENT", "SERVICE"])
export const PolicyAction = z.enum(["BLOCK", "REVIEW", "ALLOW"])
export const CaseTrigger = z.enum(["SCREENING", "POLICY", "LANE", "GOODS"])
export const CaseStatus = z.enum(["OPEN", "RELEASED", "DECLINED", "ESCALATED"])
export const CaseDecision = z.enum(["RELEASE", "DECLINE", "ESCALATE", "OVERRIDE"])

// Chapter 23.10 — notifications, documents, config.
export const Channel = z.enum(["INBOX", "PUSH", "SMS", "EMAIL"])
export const DeliveryStatus = z.enum(["QUEUED", "SENT", "DELIVERED", "FAILED", "UNDELIVERABLE", "SKIPPED"])
export const ScanStatus = z.enum(["PENDING", "CLEAN", "INFECTED"])
export const DocumentVisibility = z.enum(["INTERNAL", "CUSTOMER"])
export const DocumentType = z.enum([
  "E_TICKET_RECEIPT", "ITINERARY", "INVOICE", "RECEIPT", "QUOTE_PDF", "COMMERCIAL_INVOICE", "PACKING_LIST", "ID", "PASSPORT_SCAN",
  "CONTENT_PHOTO", "PAYMENT_EVIDENCE", "SHIPMENT_SUMMARY", "EXPORT_LICENCE", "OTHER",
])
/** Document types that identify a person: staff need `customer.read.documents` to open them and the scan is metadata-stripped (ADR-0005). */
export const IDENTITY_DOCUMENT_TYPES: readonly z.infer<typeof DocumentType>[] = ["PASSPORT_SCAN", "ID"]
export const ConfigDomain = z.enum(["ENGINE_RULES", "HUBS", "WORKFLOW", "NOTIFICATION_MATRIX", "AUTH"])
export const ConfigVersionStatus = z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED"])
export const ProviderEnv = z.enum(["test", "production"])
export const ProviderId = z.enum(["fake", "duffel", "amadeus-enterprise", "manual"])

export type TripType = z.infer<typeof TripType>
export type Cabin = z.infer<typeof Cabin>
export type PassengerType = z.infer<typeof PassengerType>
export type TicketingModel = z.infer<typeof TicketingModel>
export type Construction = z.infer<typeof Construction>
export type Rung = z.infer<typeof Rung>
export type ResultTab = z.infer<typeof ResultTab>
export type RiskFlag = z.infer<typeof RiskFlag>
export type FlightRequestStatus = z.infer<typeof FlightRequestStatus>
export type PaymentStatus = z.infer<typeof PaymentStatus>
export type CargoStatus = z.infer<typeof CargoStatus>
export type CargoService = z.infer<typeof CargoService>
export type GoodsCategory = z.infer<typeof GoodsCategory>
export type ScreeningOutcome = z.infer<typeof ScreeningOutcome>
export type QuoteStatus = z.infer<typeof QuoteStatus>
export type AfterSalesStatus = z.infer<typeof AfterSalesStatus>
export type AtolMode = z.infer<typeof AtolMode>
export type Locale = z.infer<typeof Locale>
export type ProviderId = z.infer<typeof ProviderId>
export type ConfigDomain = z.infer<typeof ConfigDomain>
export type Channel = z.infer<typeof Channel>
export type PolicyAction = z.infer<typeof PolicyAction>
export type ScreeningResult = z.infer<typeof ScreeningResult>
export type RequestType = z.infer<typeof RequestType>
export type VerificationStatus = z.infer<typeof VerificationStatus>
export type VerificationDecision = z.infer<typeof VerificationDecision>
export type VerificationReasonCode = z.infer<typeof VerificationReasonCode>
