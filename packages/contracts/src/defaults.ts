import type { AppSettings, AuthConfig, EngineRules, HubsConfig, NotificationMatrix, WorkflowConfig } from "./config"

// Defaults are the booklet's proposals (Table 22.1, ch. 13.5, 16.2, 17.2, 36.2). They seed version 1 of each
// configuration domain; operations tune them in the Developer Panel.

export const ENGINE_VERSION = "engine-1.0.0"

export const DEFAULT_ENGINE_RULES: EngineRules = {
  global: {
    selfTransferMinMin: 180,
    protectedMinBufferMin: 0,
    preferredLayover: [240, 360],
    maxLayoverMin: 720,
    allowOvernight: true,
    maxOvernightMin: 1200,
    airportChanges: [],
    maxSeparateTickets: 2,
    maxStops: 2,
    maxTotalDurationMin: 2160,
    maxDurationFactor: 2.5,
    selfTransferRequiresEntry: true,
    blocked: false,
    nightWindow: [0, 6],
  },
  overrides: [
    {
      id: "airport-IST", level: "AIRPORT", airport: "IST",
      fields: {
        airportChanges: [{ to: "SAW", transferMin: 150 }],
        entryAdvisory: { en: "Self-transfer in Istanbul means entering Türkiye: passport control, collect bags, check in again. Entry rules depend on your passport; our team confirms them before quoting.", fa: "ترانزیت با بلیت جداگانه در استانبول یعنی ورود به ترکیه: کنترل گذرنامه، تحویل بار و پذیرش دوباره. قوانین ورود به گذرنامه شما بستگی دارد و تیم ما پیش از ارسال پیشنهاد آن را تأیید می‌کند." },
      },
    },
    { id: "airport-SAW", level: "AIRPORT", airport: "SAW", fields: { airportChanges: [{ to: "IST", transferMin: 150 }] } },
    {
      id: "airport-LHR", level: "AIRPORT", airport: "LHR",
      fields: { airportChanges: [{ to: "LGW", transferMin: 180 }] },
    },
    { id: "airport-LGW", level: "AIRPORT", airport: "LGW", fields: { airportChanges: [{ to: "LHR", transferMin: 180 }] } },
    {
      id: "airport-MCT", level: "AIRPORT", airport: "MCT",
      fields: { entryAdvisory: { en: "Self-transfer in Muscat requires entering Oman. Visa rules depend on your passport; our team confirms them.", fa: "ترانزیت با بلیت جداگانه در مسقط نیازمند ورود به عمان است. قوانین روادید به گذرنامه شما بستگی دارد و تیم ما آن را تأیید می‌کند." } },
    },
    {
      id: "airport-NJF", level: "AIRPORT", airport: "NJF",
      fields: { selfTransferMinMin: 240, entryAdvisory: { en: "Self-transfer in Najaf requires entering Iraq. Our team confirms entry requirements.", fa: "ترانزیت با بلیت جداگانه در نجف نیازمند ورود به عراق است. تیم ما شرایط ورود را تأیید می‌کند." } },
    },
    {
      id: "airport-EVN", level: "AIRPORT", airport: "EVN",
      fields: { entryAdvisory: { en: "Connections in Yerevan on separate tickets mean entering Armenia.", fa: "اتصال با بلیت جداگانه در ایروان یعنی ورود به ارمنستان." } },
    },
  ],
  weights: { price: 0.35, duration: 0.2, layoverFit: 0.15, risk: 0.2, stops: 0.05, timeOfDay: 0.05 },
  routeWeights: [],
  preferredCarriers: [],
  limits: {
    maxSupplierCalls: 24, maxHubs: 4, maxOffersPerLeg: 25, maxResults: 60, maxFlexDates: 7,
    maxSameFirstFlight: 3, maxSameLastFlight: 3, singleTicketPreferenceWithinPct: 15,
  },
  cache: { legTtlSeconds: 600 },
  deadlines: { firstWaveMs: 12000, totalMs: 25000 },
}

export const DEFAULT_HUBS: HubsConfig = {
  hubs: [
    {
      fromRegion: "IR", toRegion: "EUROPE",
      candidates: [
        { iata: "MCT", weight: 0.9, active: true },
        { iata: "NJF", weight: 0.5, active: true },
        { iata: "IST", weight: 1.0, active: false, note: "No Iran flights by Turkish carriers before Mar 2027" },
      ],
    },
    {
      fromRegion: "IR", toRegion: "UK",
      candidates: [
        { iata: "MCT", weight: 0.9, active: true },
        { iata: "NJF", weight: 0.5, active: true },
        { iata: "IST", weight: 1.0, active: false, note: "No Iran flights by Turkish carriers before Mar 2027" },
      ],
    },
    { fromRegion: "TR", toRegion: "UK", candidates: [{ iata: "IST", weight: 1.0, active: true }, { iata: "SAW", weight: 0.8, active: true }] },
    { fromRegion: "TR", toRegion: "EUROPE", candidates: [{ iata: "IST", weight: 1.0, active: true }, { iata: "SAW", weight: 0.8, active: true }] },
    { fromRegion: "AM", toRegion: "UK", candidates: [{ iata: "VIE", weight: 0.9, active: true }, { iata: "WAW", weight: 0.7, active: true }, { iata: "ATH", weight: 0.6, active: true }] },
    { fromRegion: "AM", toRegion: "EUROPE", candidates: [{ iata: "VIE", weight: 0.9, active: true }, { iata: "WAW", weight: 0.7, active: true }] },
  ],
  restrictedOrigins: [
    {
      country: "IR",
      gateways: [
        { iata: "EVN", dayOffset: 1, active: true, access: { en: "Overland via the Nurduz–Agarak border crossing", fa: "سفر زمینی از طریق مرز نوردوز–آگارک" } },
        { iata: "VAN", dayOffset: 1, active: true, access: { en: "Overland via the Razi–Kapıköy border crossing", fa: "سفر زمینی از طریق مرز رازی–کاپی‌کوی" } },
        { iata: "ERZ", dayOffset: 1, active: true, access: { en: "Overland via the Bazargan–Gürbulak border crossing", fa: "سفر زمینی از طریق مرز بازرگان–گوربولاغ" } },
      ],
    },
  ],
}

const L = (en: string, fa: string) => ({ en, fa })

export const DEFAULT_WORKFLOW: WorkflowConfig = {
  sla: {
    unassignedMinutes: 30, unassignedEscalateMinutes: 120, firstContactMinutes: 120, awaitingCustomerReminderHours: [24, 72],
    quoteReminderBeforeHours: 6, ticketingDeadlineAlertHours: [24, 4], ticketingDeadlineOwnerHours: 2, urgentWithinHours: 72,
  },
  businessHours: [
    { team: "london", timezone: "Europe/London", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
    { team: "tehran", timezone: "Asia/Tehran", days: [6, 0, 1, 2, 3], start: "09:00", end: "17:00" },
  ],
  quoteDefaultValidityHours: 24,
  quoteMaxOptions: 5,
  declineReasons: [
    { code: "NO_AVAILABILITY", label: L("No suitable availability", "صندلی مناسبی موجود نیست") },
    { code: "COMPLIANCE", label: L("We are unable to arrange this request", "امکان انجام این درخواست برای ما وجود ندارد") },
    { code: "CUSTOMER_UNREACHABLE", label: L("We could not reach you", "نتوانستیم با شما تماس بگیریم") },
    { code: "OUT_OF_SCOPE", label: L("Outside the services we offer", "خارج از خدمات ما") },
  ],
  cancellationReasons: [
    { code: "CUSTOMER_REQUEST", label: L("Cancelled at your request", "به درخواست شما لغو شد") },
    { code: "DUPLICATE", label: L("Duplicate request", "درخواست تکراری") },
    { code: "PLANS_CHANGED", label: L("Travel plans changed", "تغییر برنامهٔ سفر") },
  ],
  autoAssignment: "OFF",
  paymentFourEyesThresholdMinor: 100000,
  atolMode: "PAY_ON_TICKETING",
  statusLabels: {
    flight: {
      SUBMITTED: L("Received", "دریافت شد"), COMPLIANCE_HOLD: L("Being reviewed", "در حال بررسی"), NEW: L("Received", "دریافت شد"),
      IN_REVIEW: L("Being reviewed", "در حال بررسی"), AWAITING_CUSTOMER: L("Action needed", "نیاز به اقدام شما"), QUOTED: L("Options sent", "گزینه‌ها ارسال شد"),
      ACCEPTED: L("Reserving your seats", "در حال رزرو صندلی"), RESERVED: L("Awaiting payment", "در انتظار پرداخت"), TICKETED: L("Ticket issued", "بلیت صادر شد"),
      COMPLETED: L("Completed", "تکمیل شد"), DECLINED: L("Unable to arrange", "امکان‌پذیر نیست"), CANCELLED: L("Cancelled", "لغو شد"), EXPIRED: L("Expired", "منقضی شد"),
    },
    cargo: {
      SUBMITTED: L("Received", "دریافت شد"), COMPLIANCE_HOLD: L("Being reviewed", "در حال بررسی"), NEW: L("Received", "دریافت شد"),
      IN_REVIEW: L("Being reviewed", "در حال بررسی"), AWAITING_CUSTOMER: L("Action needed", "نیاز به اقدام شما"), QUOTED: L("Quote sent", "پیشنهاد قیمت ارسال شد"),
      ACCEPTED: L("Booking with carrier", "در حال رزرو با حمل‌کننده"), BOOKED: L("Booked", "رزرو شد"), AWAITING_HANDOVER: L("Awaiting pickup / drop-off", "در انتظار تحویل محموله"),
      RECEIVED: L("Received by us", "توسط ما دریافت شد"), IN_TRANSIT: L("In transit", "در حال حمل"), AT_CUSTOMS: L("In customs", "در گمرک"),
      OUT_FOR_DELIVERY: L("Out for delivery", "در حال تحویل"), DELIVERED: L("Delivered", "تحویل داده شد"), COMPLETED: L("Completed", "تکمیل شد"),
      EXCEPTION: L("Problem with shipment", "مشکل در محموله"), DECLINED: L("Unable to arrange", "امکان‌پذیر نیست"), CANCELLED: L("Cancelled", "لغو شد"), EXPIRED: L("Expired", "منقضی شد"),
    },
  },
  cargo: { reweighTolerancePct: 5, availabilityStaleDays: 30, highValueThresholdMinor: 200000 },
}

export const RESERVED_AWAITING_PAYMENT = L("Awaiting payment", "در انتظار پرداخت")
export const RESERVED_ISSUING = L("Issuing ticket", "در حال صدور بلیت")

export const DEFAULT_NOTIFICATION_MATRIX: NotificationMatrix = {
  rules: [
    { event: "auth.otp", audience: "CUSTOMER", channels: ["SMS"], sms: "IMMEDIATE", critical: true, locked: true },
    { event: "request.submitted", audience: "CUSTOMER", channels: ["INBOX", "SMS"], sms: "IMMEDIATE", critical: true, locked: false },
    { event: "request.submitted", audience: "ON_DUTY_ADMINS", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "request.assigned", audience: "ASSIGNEE", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "request.info_requested", audience: "CUSTOMER", channels: ["INBOX", "PUSH", "SMS"], sms: "ESCALATING", escalateAfterMinutes: 30, critical: true, locked: false },
    { event: "request.message_from_staff", audience: "CUSTOMER", channels: ["INBOX", "PUSH", "SMS"], sms: "ESCALATING", escalateAfterMinutes: 120, critical: false, locked: false },
    { event: "request.message_from_customer", audience: "ASSIGNEE", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "request.declined", audience: "CUSTOMER", channels: ["INBOX", "PUSH", "SMS"], sms: "IMMEDIATE", critical: true, locked: false },
    { event: "request.cancelled", audience: "ASSIGNEE", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "request.status_changed", audience: "CUSTOMER", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "quote.sent", audience: "CUSTOMER", channels: ["INBOX", "PUSH", "SMS"], sms: "IMMEDIATE", critical: true, locked: false },
    { event: "quote.expiring", audience: "CUSTOMER", channels: ["INBOX", "PUSH", "SMS"], sms: "IMMEDIATE", critical: true, locked: false },
    { event: "quote.expiring", audience: "ASSIGNEE", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "quote.accepted", audience: "CUSTOMER", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "quote.accepted", audience: "ASSIGNEE", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "quote.expired", audience: "CUSTOMER", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "reservation.recorded", audience: "CUSTOMER", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "reservation.deadline_approaching", audience: "ASSIGNEE", channels: ["INBOX", "PUSH", "EMAIL"], sms: "NONE", critical: true, locked: false },
    { event: "reservation.deadline_approaching", audience: "OWNERS", channels: ["INBOX", "PUSH", "EMAIL"], sms: "NONE", critical: true, locked: false },
    { event: "ticket.issued", audience: "CUSTOMER", channels: ["INBOX", "PUSH", "SMS", "EMAIL"], sms: "IMMEDIATE", critical: true, locked: false },
    { event: "sla.unassigned", audience: "ON_DUTY_ADMINS", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "sla.unassigned", audience: "OWNERS", channels: ["INBOX", "EMAIL"], sms: "NONE", critical: false, locked: false },
    { event: "sla.first_contact_due", audience: "ASSIGNEE", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "sla.awaiting_customer_reminder", audience: "CUSTOMER", channels: ["INBOX", "PUSH", "SMS"], sms: "ESCALATING", escalateAfterMinutes: 60, critical: false, locked: false },
    { event: "cargo.submitted", audience: "CUSTOMER", channels: ["INBOX", "SMS"], sms: "IMMEDIATE", critical: true, locked: false },
    { event: "cargo.submitted", audience: "ON_DUTY_ADMINS", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "cargo.status_changed", audience: "CUSTOMER", channels: ["INBOX", "PUSH", "SMS"], sms: "IMMEDIATE", critical: false, locked: false },
    { event: "compliance.hold_created", audience: "COMPLIANCE", channels: ["INBOX", "PUSH", "EMAIL"], sms: "NONE", critical: true, locked: false },
    { event: "compliance.case_decided", audience: "ON_DUTY_ADMINS", channels: ["INBOX", "PUSH"], sms: "NONE", critical: false, locked: false },
    { event: "security.new_sign_in", audience: "CUSTOMER", channels: ["INBOX", "PUSH", "EMAIL"], sms: "NONE", critical: true, locked: true },
    { event: "security.role_changed", audience: "CUSTOMER", channels: ["INBOX", "PUSH", "EMAIL"], sms: "NONE", critical: true, locked: true },
    { event: "security.role_changed", audience: "OWNERS", channels: ["INBOX", "PUSH", "EMAIL"], sms: "NONE", critical: true, locked: true },
    { event: "provider.degraded", audience: "DEVELOPERS", channels: ["INBOX", "EMAIL"], sms: "NONE", critical: false, locked: false },
    { event: "notification.route_degraded", audience: "DEVELOPERS", channels: ["INBOX", "EMAIL"], sms: "NONE", critical: false, locked: false },
  ],
  quietHours: { start: "22:00", end: "08:00" },
  smsDailyCap: 6,
  escalationThrottleMinutes: 60,
  pushTokenFreshDays: 30,
  routeAlertThresholdPct: 80,
}

/** Only these cargo statuses send an SMS (ch. 17.2 cargo.status_changed). */
export const CARGO_SMS_STATUSES = ["AWAITING_HANDOVER", "AT_CUSTOMS", "DELIVERED", "EXCEPTION"] as const

export const EU_EEA = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"]

export const DEFAULT_AUTH: AuthConfig = {
  otpLength: 6, otpTtlSeconds: 300, otpMaxAttempts: 5, resendCooldownSeconds: 60, maxPerHour: 5, maxPerDay: 10,
  allowedCountries: ["IR", "GB", ...EU_EEA, "TR", "AM", "GE", "AE"],
  challengeAfterRequestsPerIp10Min: 3, emailSignIn: true, requireVerifiedPhoneForRequests: true,
  accessTtlSeconds: 600, refreshTtlDays: 30, staffSessionHours: 12, staffIdleMinutes: 30, staffSecondFactor: true,
  stepUpWindowMinutes: 10, ipAllowlistDev: [], verifyIpLimitPer10Min: 10,
}

export const DEFAULT_SETTINGS: AppSettings = {
  company: { name: "Uni Travel Ltd", address: "London, United Kingdom", phone: "+44 20 0000 0000", email: "help@unitravel.example", registration: "Registered in England and Wales" },
  supportedLanguages: ["en", "fa"],
  displayCurrencies: ["GBP", "EUR"],
  legal: { termsVersion: "2026-10-22", privacyVersion: "2026-10-22" },
  maintenanceBanner: { en: "We are carrying out maintenance. Requests you have already sent are safe.", fa: "در حال انجام کارهای نگهداری هستیم. درخواست‌های ارسال‌شدهٔ شما محفوظ است." },
  requestsRevalidateOnSubmit: true,
  freeTextSmsRoles: [],
}
