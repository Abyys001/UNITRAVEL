import { z } from "zod"

import { CarrierCode, CountryCode, Iata, LocalisedText } from "./common"
import { AtolMode, Channel, FlightRequestStatus, CargoStatus } from "./enums"
import { CommercialDocumentSettings } from "./invoices"

// Chapter 22.3, Table 22.1 — one connection rule. Every field is optional except at the global level, where
// defaults fill everything; more specific levels override only what they define.
export const ConnectionRuleFields = z.object({
  selfTransferMinMin: z.number().int().min(0),
  protectedMinBufferMin: z.number().int().min(0),
  preferredLayover: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  maxLayoverMin: z.number().int().min(0),
  allowOvernight: z.boolean(),
  maxOvernightMin: z.number().int().min(0),
  airportChanges: z.array(z.object({ to: Iata, transferMin: z.number().int().min(0) })),
  maxSeparateTickets: z.number().int().min(1).max(3),
  maxStops: z.number().int().min(0).max(4),
  maxTotalDurationMin: z.number().int().min(60),
  maxDurationFactor: z.number().min(1),
  selfTransferRequiresEntry: z.boolean(),
  entryAdvisory: LocalisedText.optional(),
  blocked: z.boolean(),
  nightWindow: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]),
})
export type ConnectionRuleFields = z.infer<typeof ConnectionRuleFields>

export const RuleOverride = z.object({
  id: z.string().min(1),
  level: z.enum(["CARRIER_PAIR", "AIRPORT", "ROUTE"]),
  airport: Iata.optional(),
  inboundCarrier: CarrierCode.optional(),
  outboundCarrier: CarrierCode.optional(),
  origin: Iata.optional(),
  destination: Iata.optional(),
  fields: ConnectionRuleFields.partial(),
  note: z.string().optional(),
})
export type RuleOverride = z.infer<typeof RuleOverride>

export const ScoringWeights = z.object({
  price: z.number().min(0), duration: z.number().min(0), layoverFit: z.number().min(0),
  risk: z.number().min(0), stops: z.number().min(0), timeOfDay: z.number().min(0),
})
export type ScoringWeights = z.infer<typeof ScoringWeights>

export const EngineRules = z.object({
  global: ConnectionRuleFields,
  overrides: z.array(RuleOverride),
  weights: ScoringWeights,
  routeWeights: z.array(z.object({ origin: Iata, destination: Iata, weights: ScoringWeights })).default([]),
  preferredCarriers: z.array(z.object({ carrier: CarrierCode, bonus: z.number().min(0).max(0.05) })).default([]),
  limits: z.object({
    maxSupplierCalls: z.number().int().min(1),
    maxHubs: z.number().int().min(0),
    maxOffersPerLeg: z.number().int().min(1),
    maxResults: z.number().int().min(1),
    maxFlexDates: z.number().int().min(1),
    maxSameFirstFlight: z.number().int().min(1),
    maxSameLastFlight: z.number().int().min(1),
    singleTicketPreferenceWithinPct: z.number().min(0),
  }),
  cache: z.object({ legTtlSeconds: z.number().int().min(0) }),
  deadlines: z.object({ firstWaveMs: z.number().int().min(1000), totalMs: z.number().int().min(1000) }),
})
export type EngineRules = z.infer<typeof EngineRules>

export const HubTable = z.object({
  fromRegion: z.string(),
  toRegion: z.string(),
  candidates: z.array(z.object({ iata: Iata, weight: z.number().min(0).max(1), active: z.boolean().default(true), note: z.string().optional() })),
})

export const Gateway = z.object({
  iata: Iata,
  dayOffset: z.number().int().min(0).max(3),
  active: z.boolean().default(true),
  access: LocalisedText,
})
export type Gateway = z.infer<typeof Gateway>

export const HubsConfig = z.object({
  hubs: z.array(HubTable),
  restrictedOrigins: z.array(z.object({ country: CountryCode, gateways: z.array(Gateway) })),
})
export type HubsConfig = z.infer<typeof HubsConfig>

// Chapter 16.2 §5 — request workflow configuration.
const BusinessHours = z.object({
  team: z.string(),
  timezone: z.string(),
  days: z.array(z.number().int().min(0).max(6)),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})
export const WorkflowConfig = z.object({
  sla: z.object({
    unassignedMinutes: z.number().int().min(1),
    unassignedEscalateMinutes: z.number().int().min(1),
    firstContactMinutes: z.number().int().min(1),
    awaitingCustomerReminderHours: z.array(z.number().int().min(1)),
    quoteReminderBeforeHours: z.number().int().min(1),
    ticketingDeadlineAlertHours: z.array(z.number().int().min(1)),
    ticketingDeadlineOwnerHours: z.number().int().min(1),
    urgentWithinHours: z.number().int().min(1),
  }),
  businessHours: z.array(BusinessHours),
  quoteDefaultValidityHours: z.number().int().min(1),
  quoteMaxOptions: z.number().int().min(1).max(5),
  declineReasons: z.array(z.object({ code: z.string(), label: LocalisedText })),
  cancellationReasons: z.array(z.object({ code: z.string(), label: LocalisedText })),
  autoAssignment: z.enum(["OFF", "ROUND_ROBIN", "BY_LANGUAGE"]),
  paymentFourEyesThresholdMinor: z.number().int().min(0),
  atolMode: AtolMode,
  atolHolder: z.object({ name: z.string(), number: z.string() }).optional(),
  statusLabels: z.object({
    flight: z.record(FlightRequestStatus, LocalisedText),
    cargo: z.record(CargoStatus, LocalisedText),
  }),
  cargo: z.object({ reweighTolerancePct: z.number().min(0), availabilityStaleDays: z.number().int().min(1), highValueThresholdMinor: z.number().int().min(0) }),
})
export type WorkflowConfig = z.infer<typeof WorkflowConfig>

// Chapter 17.2 — event × channel matrix.
export const NotificationRule = z.object({
  event: z.string(),
  audience: z.enum(["CUSTOMER", "ASSIGNEE", "ON_DUTY_ADMINS", "COMPLIANCE", "OWNERS", "DEVELOPERS"]),
  channels: z.array(Channel),
  sms: z.enum(["NONE", "IMMEDIATE", "ESCALATING"]),
  escalateAfterMinutes: z.number().int().min(0).optional(),
  critical: z.boolean(),
  locked: z.boolean().default(false),
})
export type NotificationRule = z.infer<typeof NotificationRule>

export const NotificationMatrix = z.object({
  rules: z.array(NotificationRule),
  quietHours: z.object({ start: z.string(), end: z.string() }),
  smsDailyCap: z.number().int().min(0),
  escalationThrottleMinutes: z.number().int().min(0),
  pushTokenFreshDays: z.number().int().min(1),
  routeAlertThresholdPct: z.number().min(0).max(100),
})
export type NotificationMatrix = z.infer<typeof NotificationMatrix>

// Chapter 16.2 §7 — authentication settings.
export const AuthConfig = z.object({
  otpLength: z.number().int().min(4).max(8),
  otpTtlSeconds: z.number().int().min(60),
  otpMaxAttempts: z.number().int().min(1),
  resendCooldownSeconds: z.number().int().min(10),
  maxPerHour: z.number().int().min(1),
  maxPerDay: z.number().int().min(1),
  allowedCountries: z.array(CountryCode),
  challengeAfterRequestsPerIp10Min: z.number().int().min(0),
  emailSignIn: z.boolean(),
  requireVerifiedPhoneForRequests: z.boolean(),
  accessTtlSeconds: z.number().int().min(60),
  refreshTtlDays: z.number().int().min(1),
  staffSessionHours: z.number().int().min(1),
  staffIdleMinutes: z.number().int().min(1),
  staffSecondFactor: z.boolean(),
  stepUpWindowMinutes: z.number().int().min(1),
  ipAllowlistDev: z.array(z.string()).default([]),
  verifyIpLimitPer10Min: z.number().int().min(1),
})
export type AuthConfig = z.infer<typeof AuthConfig>

export const CONFIG_SCHEMAS = {
  ENGINE_RULES: EngineRules,
  HUBS: HubsConfig,
  WORKFLOW: WorkflowConfig,
  NOTIFICATION_MATRIX: NotificationMatrix,
  AUTH: AuthConfig,
} as const

// Chapter 16.2 §10 — feature flags with owners and removal dates.
export const FEATURE_FLAGS = [
  "cargo.enabled", "search.gateways.enabled", "seatmaps.enabled", "payments.online.enabled", "search.self_transfer.enabled",
  "sms.free_text.enabled", "push.pushy_pilot.enabled", "maintenance.enabled",
] as const
export type FeatureFlag = (typeof FEATURE_FLAGS)[number]
export const DEFAULT_FLAGS: Record<FeatureFlag, boolean> = {
  "cargo.enabled": true,
  "search.gateways.enabled": true,
  "seatmaps.enabled": false,
  "payments.online.enabled": false,
  "search.self_transfer.enabled": true,
  "sms.free_text.enabled": false,
  "push.pushy_pilot.enabled": false,
  "maintenance.enabled": false,
}

export const AppSettings = z.object({
  company: z.object({ name: z.string(), address: z.string(), phone: z.string(), email: z.string(), registration: z.string() }),
  supportedLanguages: z.array(z.enum(["en", "fa"])),
  displayCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)),
  legal: z.object({ termsVersion: z.string(), privacyVersion: z.string() }),
  maintenanceBanner: LocalisedText,
  requestsRevalidateOnSubmit: z.boolean(),
  freeTextSmsRoles: z.array(z.string()).default([]),
  /** Days a passport scan is kept after upload; null = UNKNOWN, scans are kept until erased (ADR-0005 V9, DPIA). */
  identityScanRetentionDays: z.number().int().min(1).max(3650).nullable().default(null),
  /** ADR-0006: numbering and the company particulars printed on quotations and invoices (UNKNOWN = null). */
  commercialDocuments: CommercialDocumentSettings.default(CommercialDocumentSettings.parse({})),
})
export type AppSettings = z.infer<typeof AppSettings>
