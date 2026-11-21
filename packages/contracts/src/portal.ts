import { z } from "zod"

import { IsoDateTime, Money, Uuid } from "./common"
import { InboxItem } from "./notifications"
import { TrackItemKind } from "./services"
import { CustomerTicketSummary } from "./support"

// ADR-0040: customer portal. Every schema here is a customer view: no staff notes, costs, assignees or screening data.

export const PortalStepState = z.enum(["DONE", "CURRENT", "UPCOMING"])
/** One named stage of a purchase; `label` is already in the request language. */
export const PortalStep = z.object({ code: z.string(), label: z.string(), state: PortalStepState })
export type PortalStep = z.infer<typeof PortalStep>

/** A request or purchase as a dashboard row. `nextStep` is the next thing expected to happen, written out. */
export const PortalItem = z.object({
  kind: TrackItemKind,
  ref: z.string(),
  title: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  /** Closed requests (cancelled, declined, expired, completed) are `false` and carry no steps. */
  active: z.boolean(),
  steps: z.array(PortalStep),
  nextStep: z.string().nullable(),
  updatedAt: IsoDateTime,
})
export type PortalItem = z.infer<typeof PortalItem>

export const PendingActionKind = z.enum(["ACCEPT_QUOTE", "PAY_INVOICE", "PROVIDE_PASSPORT", "RESPOND", "SUPPORT_REPLY", "COMPLETE_PROFILE"])
export const PendingAction = z.object({
  kind: PendingActionKind,
  ref: z.string().nullable(),
  label: z.string(),
  /** Hard deadline when the server knows one (quote expiry, invoice due); never guessed. */
  dueAt: IsoDateTime.nullable(),
})
export type PendingAction = z.infer<typeof PendingAction>

export const PurchaseKind = z.enum(["INVOICE_PAID", "TICKET_ISSUED", "SERVICE_CONFIRMED", "CARGO_BOOKED"])
export const PurchaseItem = z.object({
  kind: PurchaseKind,
  ref: z.string(),
  title: z.string(),
  /** Only for paid invoices; other purchases carry no amount. */
  amount: Money.nullable(),
  at: IsoDateTime,
})
export type PurchaseItem = z.infer<typeof PurchaseItem>

export const TravelCardStatus = z.enum(["COMING_SOON", "ACTIVE"])

export const PortalOverview = z.object({
  profile: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    memberSince: IsoDateTime,
    /** Profile steps still to do: codes such as NAME, EMAIL, PHONE, PASSPORT. */
    missing: z.array(z.string()),
  }),
  counts: z.object({
    active: z.number().int(),
    previous: z.number().int(),
    pendingActions: z.number().int(),
    unreadInbox: z.number().int(),
    unreadSupport: z.number().int(),
    openSupport: z.number().int(),
  }),
  active: z.array(PortalItem),
  /** The latest closed items, newest first, at most 5. */
  previous: z.array(PortalItem),
  pendingActions: z.array(PendingAction),
  /** The latest purchases, newest first, at most 6. */
  purchases: z.array(PurchaseItem),
  /** The latest inbox items, newest first, at most 5. */
  notifications: z.array(InboxItem),
  support: z.array(CustomerTicketSummary),
  club: z
    .object({
      enabled: z.boolean(),
      member: z.object({ tierNameEn: z.string(), tierNameFa: z.string(), status: z.string() }).nullable(),
      creditBalance: z.array(Money),
      /** Null until the club exposes points (ADR-0039); never filled with a placeholder. */
      points: z.number().int().nullable(),
    })
    .nullable(),
  travelCard: z.object({ status: TravelCardStatus }),
})
export type PortalOverview = z.infer<typeof PortalOverview>

export const UnreadCounts = z.object({ inbox: z.number().int(), support: z.number().int() })
export type UnreadCounts = z.infer<typeof UnreadCounts>

export const InboxFilter = z.enum(["all", "unread", "important"])
export const InboxListQuery = z.object({
  filter: InboxFilter.default("all"),
  /** `createdAt` of the last item of the previous page. */
  before: IsoDateTime.optional(),
  /** Older name of `before`, kept so existing clients keep working; `before` wins when both are sent. */
  cursor: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  locale: z.enum(["en", "fa"]).optional(),
})
export type InboxListQuery = z.infer<typeof InboxListQuery>
export const InboxPage = z.object({
  items: z.array(InboxItem),
  nextBefore: IsoDateTime.nullable(),
  /** Same value as `nextBefore`, kept for clients that read the earlier shape. */
  nextCursor: IsoDateTime.nullable(),
  /** All unread items of the signed-in user, whatever the filter. */
  unread: z.number().int(),
})
export type InboxPage = z.infer<typeof InboxPage>

// ---- track a purchase (D4, D5) ----
export const CarrierTrackingState = z.enum(["NOT_CONFIGURED", "PENDING", "ACTIVE", "UNAVAILABLE"])
export const TrackEventSource = z.enum(["UNITRAVEL", "CARRIER"])
export const TrackEvent = z.object({
  id: z.string(),
  at: IsoDateTime,
  label: z.string(),
  location: z.string().nullable(),
  description: z.string().nullable(),
  source: TrackEventSource,
  corrected: z.boolean(),
})
export type TrackEvent = z.infer<typeof TrackEvent>

export const TrackDocumentKind = z.enum(["QUOTATION", "INVOICE", "E_TICKET", "BOARDING_PASS", "CARGO_DOCUMENT"])
export const TrackDocument = z.object({
  kind: TrackDocumentKind,
  label: z.string(),
  /**
   * Same-origin path; access is checked again there. `/billing/...` is a portal page. A path under `/v1/` is an API route to call with the
   * session: `documents/:id/download` answers `{ url, expiresInSeconds }` (short-lived signed link), `ticket-documents/:id/files/:which` streams the PDF.
   */
  href: z.string(),
})

export type TrackDocument = z.infer<typeof TrackDocument>

export const ShipmentTracking = z.object({
  awbNumber: z.string().nullable(),
  origin: z.string(),
  destination: z.string(),
  service: z.string(),
  pieces: z.number().int().nullable(),
  chargeableWeightKg: z.number().nullable(),
  estimatedDeliveryAt: IsoDateTime.nullable(),
  carrier: z.object({
    state: CarrierTrackingState,
    provider: z.literal("TRACKINGMORE").nullable(),
    airline: z.string().nullable(),
    lastSyncedAt: IsoDateTime.nullable(),
  }),
})
export type ShipmentTracking = z.infer<typeof ShipmentTracking>

export const TrackDetail = z.object({
  kind: TrackItemKind,
  ref: z.string(),
  title: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  active: z.boolean(),
  steps: z.array(PortalStep),
  nextStep: z.string().nullable(),
  /** Newest first. */
  events: z.array(TrackEvent),
  documents: z.array(TrackDocument),
  shipment: ShipmentTracking.nullable(),
  /** Customer page with the full request (quotes, messages). */
  detailHref: z.string(),
})
export type TrackDetail = z.infer<typeof TrackDetail>

export const TrackSearchQuery = z.object({ q: z.string().trim().min(3).max(40) })
export const TrackSearchResult = z.object({ ref: z.string().nullable() })
export type TrackSearchResult = z.infer<typeof TrackSearchResult>

// ---- TrackingMore (Developer Panel) ----
export const CargoTrackingSettingsView = z.object({
  provider: z.literal("TRACKINGMORE"),
  enabled: z.boolean(),
  keyConfigured: z.boolean(),
  /** Deployed hosts (APP_ENV staging or production) stay off until the DPIA lists the processor and this is switched on (ADR-0040 D5). */
  dpiaApproved: z.boolean(),
  blockedReason: z.string().nullable(),
  lastSyncAt: IsoDateTime.nullable(),
  lastError: z.string().nullable(),
})
export type CargoTrackingSettingsView = z.infer<typeof CargoTrackingSettingsView>
export const CargoTrackingSettingsBody = z.object({
  enabled: z.boolean(),
  /** Write-only: stored encrypted, never returned. */
  apiKey: z.string().trim().min(8).max(200).optional(),
  dpiaApproved: z.boolean().optional(),
})
export type CargoTrackingSettingsBody = z.infer<typeof CargoTrackingSettingsBody>
export const CargoTrackingSyncResult = z.object({ shipmentRef: z.string(), added: z.number().int(), state: CarrierTrackingState, at: IsoDateTime, id: Uuid.optional() })
export type CargoTrackingSyncResult = z.infer<typeof CargoTrackingSyncResult>
