import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"

import { createdAt, id, timestamps, tstz } from "./columns"
import { users } from "./identity"
import { requestType } from "./requests"

// Chapter 23.10 — notifications, documents, configuration and platform.
export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid().notNull().references(() => users.id),
  eventType: varchar({ length: 60 }).notNull(),
  eventId: uuid().notNull(),
  title: varchar({ length: 240 }).notNull(),
  body: text().notNull(),
  data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  critical: boolean().notNull().default(false),
  readAt: tstz(),
  dedupeKey: varchar({ length: 200 }).notNull().unique(),
  createdAt: createdAt(),
}, (t) => [index("notifications_inbox_idx").on(t.userId, t.readAt, t.createdAt)])

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: id(),
  notificationId: uuid().notNull().references(() => notifications.id),
  channel: text({ enum: ["INBOX", "PUSH", "SMS", "EMAIL"] }).notNull(),
  provider: varchar({ length: 40 }),
  destination: varchar({ length: 260 }),
  status: text({ enum: ["QUEUED", "SENT", "DELIVERED", "FAILED", "UNDELIVERABLE", "SKIPPED"] }).notNull().default("QUEUED"),
  providerMessageId: varchar({ length: 160 }),
  error: text(),
  attempts: integer().notNull().default(0),
  scheduledFor: tstz(),
  sentAt: tstz(),
  deliveredAt: tstz(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("deliveries_notification_channel_uq").on(t.notificationId, t.channel), index("deliveries_provider_idx").on(t.provider, t.createdAt)])

export const notificationTemplates = pgTable("notification_templates", {
  id: id(),
  eventType: varchar({ length: 60 }).notNull(),
  channel: text({ enum: ["INBOX", "PUSH", "SMS", "EMAIL"] }).notNull(),
  locale: text({ enum: ["en", "fa"] }).notNull(),
  title: varchar({ length: 240 }).notNull().default(""),
  body: text().notNull(),
  variables: text().array().notNull(),
  providerTemplateId: varchar({ length: 120 }),
  version: integer().notNull().default(1),
  active: boolean().notNull().default(true),
  updatedBy: uuid(),
  ...timestamps,
}, (t) => [uniqueIndex("templates_uq").on(t.eventType, t.channel, t.locale)])

/** +98 → Iranian providers; default → international (ch. 8.1). */
export const smsRoutes = pgTable("sms_routes", {
  id: id(),
  prefix: varchar({ length: 8 }).notNull().unique(),
  providers: jsonb().$type<string[]>().notNull(),
  enabled: boolean().notNull().default(true),
  ...timestamps,
})

export const documents = pgTable("documents", {
  id: id(),
  ownerUserId: uuid().references(() => users.id),
  requestType: requestType(),
  requestId: uuid(),
  type: varchar({ length: 40 }).notNull(),
  filename: varchar({ length: 200 }).notNull(),
  mime: varchar({ length: 100 }).notNull(),
  size: integer().notNull(),
  storageKey: varchar({ length: 300 }).notNull(),
  sha256: varchar({ length: 64 }),
  scanStatus: text({ enum: ["PENDING", "CLEAN", "INFECTED"] }).notNull().default("PENDING"),
  visibility: text({ enum: ["INTERNAL", "CUSTOMER"] }).notNull().default("INTERNAL"),
  uploadCompletedAt: tstz(),
  createdBy: uuid(),
  ...timestamps,
}, (t) => [index("documents_request_idx").on(t.requestType, t.requestId)])

export const documentLinks = pgTable("document_links", {
  id: id(),
  documentId: uuid().notNull().references(() => documents.id),
  entityType: varchar({ length: 40 }).notNull(),
  entityId: uuid().notNull(),
  createdAt: createdAt(),
})

export const settings = pgTable("settings", {
  key: varchar({ length: 80 }).primaryKey(),
  value: jsonb().notNull(),
  updatedBy: uuid(),
  ...timestamps,
})

export const featureFlags = pgTable("feature_flags", {
  key: varchar({ length: 80 }).primaryKey(),
  enabled: boolean().notNull(),
  owner: varchar({ length: 80 }).notNull(),
  removeBy: varchar({ length: 10 }),
  description: text(),
  updatedBy: uuid(),
  ...timestamps,
})

/** Published rows are immutable; a new version supersedes the old one (ch. 16.3). */
export const configVersions = pgTable("config_versions", {
  id: id(),
  domain: text({ enum: ["ENGINE_RULES", "HUBS", "WORKFLOW", "NOTIFICATION_MATRIX", "AUTH"] }).notNull(),
  version: integer().notNull(),
  status: text({ enum: ["DRAFT", "PUBLISHED", "SUPERSEDED"] }).notNull(),
  payload: jsonb().notNull(),
  changeNote: text(),
  createdBy: uuid(),
  publishedBy: uuid(),
  publishedAt: tstz(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("config_versions_uq").on(t.domain, t.version)])

/** Append-only, monthly partitions (migration), optional hash chain (ch. 28.5). */
export const auditLog = pgTable("audit_log", {
  id: bigint({ mode: "number" }).generatedAlwaysAsIdentity(),
  occurredAt: tstz().notNull().defaultNow(),
  actorUserId: uuid(),
  actorKind: text({ enum: ["CUSTOMER", "STAFF", "SYSTEM", "ANONYMOUS"] }).notNull(),
  action: varchar({ length: 80 }).notNull(),
  entityType: varchar({ length: 60 }).notNull(),
  entityId: varchar({ length: 80 }),
  contextRef: varchar({ length: 40 }),
  before: jsonb(),
  after: jsonb(),
  ip: varchar({ length: 64 }),
  userAgent: varchar({ length: 400 }),
  requestId: varchar({ length: 128 }),
  prevHash: varchar({ length: 64 }).notNull(),
  hash: varchar({ length: 64 }).notNull(),
}, (t) => [primaryKey({ columns: [t.id, t.occurredAt] }), index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_actor_idx").on(t.actorUserId, t.occurredAt), index("audit_ref_idx").on(t.contextRef)])

export const outboxEvents = pgTable("outbox_events", {
  id: id(),
  aggregateType: varchar({ length: 40 }).notNull(),
  aggregateId: varchar({ length: 80 }).notNull(),
  eventType: varchar({ length: 60 }).notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  dedupeKey: varchar({ length: 200 }).notNull().unique(),
  createdAt: createdAt(),
  dispatchedAt: tstz(),
  attempts: integer().notNull().default(0),
  lastError: text(),
}, (t) => [index("outbox_pending_idx").on(t.dispatchedAt, t.createdAt)])

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: varchar({ length: 128 }).notNull(),
  userId: varchar({ length: 80 }).notNull(),
  route: varchar({ length: 200 }).notNull(),
  bodyHash: varchar({ length: 64 }).notNull(),
  statusCode: integer(),
  response: jsonb(),
  expiresAt: tstz().notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.key, t.userId, t.route] })])

export const jobRuns = pgTable("job_runs", {
  id: id(),
  queue: varchar({ length: 60 }).notNull(),
  name: varchar({ length: 80 }).notNull(),
  status: text({ enum: ["OK", "FAILED"] }).notNull(),
  durationMs: integer().notNull(),
  detail: jsonb(),
  createdAt: createdAt(),
})

/** Heartbeats so the diagnostics page shows which config version each process runs (ch. 16.3 step 4). */
export const processHeartbeats = pgTable("process_heartbeats", {
  id: varchar({ length: 80 }).primaryKey(),
  role: text({ enum: ["api", "worker"] }).notNull(),
  configVersions: jsonb().$type<Record<string, number>>().notNull(),
  appVersion: varchar({ length: 40 }).notNull(),
  lastHeartbeat: tstz().notNull().defaultNow(),
  ...timestamps,
})

export const shortLinks = pgTable("short_links", {
  code: varchar({ length: 12 }).primaryKey(),
  target: varchar({ length: 200 }).notNull(),
  createdAt: createdAt(),
  expiresAt: tstz(),
})

/** Messaging and other non-flight vendor credentials (SMS, push, email), envelope-encrypted like provider ones. */
export const vendorCredentials = pgTable("vendor_credentials", {
  vendor: varchar({ length: 40 }).notNull(),
  environment: text({ enum: ["test", "production"] }).notNull(),
  ciphertext: text().notNull(),
  keyId: varchar({ length: 40 }).notNull(),
  rotatedAt: tstz().notNull().defaultNow(),
  rotatedBy: uuid(),
}, (t) => [primaryKey({ columns: [t.vendor, t.environment] })])
