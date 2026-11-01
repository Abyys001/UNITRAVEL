import { z } from "zod"

import { IsoDateTime, page, Uuid } from "./common"

// ADR-0018: customer activity telemetry. Screen names only (a fixed allow-list), never content; 90-day retention.

/** The only screen names a client may report. A new screen is a code change here, on purpose. */
export const ACTIVITY_SCREENS = [
  "home", "search", "results", "itinerary", "flights", "hotels", "stays", "trains", "buses", "visa", "tours", "cip", "insurance", "cargo", "shipments",
  "request_new", "requests", "request_detail", "track", "account", "details", "travellers", "billing", "invoice", "pay", "inbox", "support", "support_ticket",
  "club", "settings", "faq", "guides", "blog", "glossary", "sign_in",
] as const
export const ActivityScreen = z.enum(ACTIVITY_SCREENS)
export type ActivityScreen = z.infer<typeof ActivityScreen>

export const ACTIVITY_KINDS = ["SIGN_IN", "SIGN_OUT", "SCREEN_VIEW"] as const
export const ActivityKind = z.enum(ACTIVITY_KINDS)
export type ActivityKind = z.infer<typeof ActivityKind>
export const ACTIVITY_CLIENTS = ["WEB", "MOBILE", "CONSOLE"] as const

/** A request or invoice reference or an invoice number; never free text. */
export const ActivityRef = z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/)

export const ActivityBody = z.strictObject({ screen: ActivityScreen, ref: ActivityRef.optional() })
export type ActivityBody = z.infer<typeof ActivityBody>

/** A customer counts as online when seen within this many minutes. */
export const ONLINE_WINDOW_MINUTES = 5
export const ACTIVITY_RETENTION_DAYS = 90

export const CustomerListQuery = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]).optional(),
  verified: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  seenFrom: z.iso.datetime({ offset: true }).optional(),
  seenTo: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
})
export type CustomerListQuery = z.infer<typeof CustomerListQuery>

/** PII is masked here; the full contact is on the customer page behind customer.read.pii. */
export const CustomerListItem = z.object({
  id: Uuid,
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  verified: z.boolean(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]),
  createdAt: IsoDateTime,
  lastActiveAt: IsoDateTime.nullable(),
  online: z.boolean(),
  lastScreen: ActivityScreen.nullable(),
  openRequests: z.number().int(),
  signInCount: z.number().int(),
})
export type CustomerListItem = z.infer<typeof CustomerListItem>
export const CustomerListPage = page(CustomerListItem)
export type CustomerListPage = z.infer<typeof CustomerListPage>

export const CustomerActivityEntry = z.object({
  id: Uuid, kind: ActivityKind, screen: ActivityScreen.nullable(), ref: z.string().nullable(), client: z.enum(ACTIVITY_CLIENTS).nullable(), network: z.string().nullable(), occurredAt: IsoDateTime,
})
export const CustomerSessionSummary = z.object({
  id: Uuid, client: z.enum(ACTIVITY_CLIENTS), createdAt: IsoDateTime, lastSeenAt: IsoDateTime, active: z.boolean(), revokedReason: z.string().nullable(),
})
export const CustomerActivityView = z.object({
  customerId: Uuid,
  retentionDays: z.number().int(),
  trackingEnabled: z.boolean(),
  sessions: z.object({ active: z.number().int(), total: z.number().int(), recent: z.array(CustomerSessionSummary) }),
  activity: page(CustomerActivityEntry),
})
export type CustomerActivityView = z.infer<typeof CustomerActivityView>
