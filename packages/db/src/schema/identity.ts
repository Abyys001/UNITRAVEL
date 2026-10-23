import { sql } from "drizzle-orm"
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"

import { createdAt, id, timestamps, tstz } from "./columns"

export const userStatus = pgEnum("user_status", ["ACTIVE", "SUSPENDED", "DELETED"])
export const identityType = pgEnum("identity_type", ["PHONE", "EMAIL"])
export const otpPurpose = pgEnum("otp_purpose", ["SIGN_IN", "VERIFY_PHONE", "VERIFY_EMAIL", "STEP_UP"])
export const clientKind = pgEnum("client_kind", ["WEB", "CONSOLE", "MOBILE"])

// Chapter 23.3 — identity and access.
export const users = pgTable("users", {
  id: id(),
  status: userStatus().notNull().default("ACTIVE"),
  displayName: varchar({ length: 120 }).notNull(),
  preferredLocale: text({ enum: ["en", "fa"] }).notNull().default("en"),
  calendar: text({ enum: ["GREGORIAN", "JALALI"] }).notNull().default("GREGORIAN"),
  timezone: varchar({ length: 64 }).notNull().default("Europe/London"),
  permVersion: integer().notNull().default(1),
  notificationPrefs: jsonb().$type<Record<string, boolean>>().notNull().default({}),
  onDuty: boolean().notNull().default(false),
  lastActiveAt: tstz(),
  mergedInto: uuid(),
  ...timestamps,
})

export const userIdentities = pgTable("user_identities", {
  id: id(),
  userId: uuid().notNull().references(() => users.id),
  type: identityType().notNull(),
  valueNormalised: varchar({ length: 254 }).notNull(),
  verifiedAt: tstz(),
  isPrimary: boolean().notNull().default(false),
  revokedAt: tstz(),
  ...timestamps,
}, (t) => [
  uniqueIndex("user_identities_value_uq").on(t.type, t.valueNormalised).where(sql`revoked_at is null`),
  index("user_identities_user_idx").on(t.userId),
])

export const otpChallenges = pgTable("otp_challenges", {
  id: id(),
  identityValue: varchar({ length: 254 }).notNull(),
  identityType: identityType().notNull(),
  purpose: otpPurpose().notNull(),
  userId: uuid(),
  codeHash: varchar({ length: 128 }).notNull(),
  expiresAt: tstz().notNull(),
  attempts: integer().notNull().default(0),
  maxAttempts: integer().notNull(),
  route: varchar({ length: 40 }),
  deliveryStatus: text({ enum: ["QUEUED", "SENT", "DELIVERED", "FAILED", "UNDELIVERABLE"] }).notNull().default("QUEUED"),
  providerMessageId: varchar({ length: 120 }),
  ip: varchar({ length: 64 }),
  ipPrefix: varchar({ length: 64 }),
  deviceId: varchar({ length: 128 }).notNull(),
  voice: boolean().notNull().default(false),
  consumedAt: tstz(),
  lockedAt: tstz(),
  createdAt: createdAt(),
}, (t) => [index("otp_identity_idx").on(t.identityValue, t.createdAt)])

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid().notNull().references(() => users.id),
  deviceId: varchar({ length: 128 }),
  client: clientKind().notNull(),
  ip: varchar({ length: 64 }),
  userAgent: varchar({ length: 400 }),
  mfaLevel: integer().notNull().default(0),
  mfaVerifiedAt: tstz(),
  absoluteExpiresAt: tstz().notNull(),
  lastSeenAt: tstz().notNull().defaultNow(),
  revokedAt: tstz(),
  revokedReason: varchar({ length: 80 }),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)])

export const refreshTokens = pgTable("refresh_tokens", {
  id: id(),
  sessionId: uuid().notNull().references(() => sessions.id),
  tokenHash: varchar({ length: 128 }).notNull().unique(),
  familyId: uuid().notNull(),
  expiresAt: tstz().notNull(),
  rotatedAt: tstz(),
  revokedAt: tstz(),
  createdAt: createdAt(),
}, (t) => [index("refresh_family_idx").on(t.familyId)])

export const devices = pgTable("devices", {
  id: id(),
  userId: uuid().notNull().references(() => users.id),
  platform: text({ enum: ["IOS", "ANDROID", "WEB"] }).notNull(),
  pushProvider: text({ enum: ["EXPO", "PUSHY", "WEBPUSH"] }).notNull(),
  pushToken: varchar({ length: 4096 }).notNull(),
  lastSuccessAt: tstz(),
  appVersion: varchar({ length: 40 }),
  disabledAt: tstz(),
  ...timestamps,
}, (t) => [uniqueIndex("devices_token_uq").on(t.pushProvider, t.pushToken)])

export const mfaFactors = pgTable("mfa_factors", {
  id: id(),
  userId: uuid().notNull().references(() => users.id),
  type: text({ enum: ["TOTP", "WEBAUTHN"] }).notNull(),
  secretCiphertext: text(),
  credentialId: varchar({ length: 512 }),
  publicKey: text(),
  counter: integer().notNull().default(0),
  confirmedAt: tstz(),
  lastUsedAt: tstz(),
  createdAt: createdAt(),
})

export const roles = pgTable("roles", {
  id: id(),
  key: varchar({ length: 40 }).notNull().unique(),
  name: varchar({ length: 80 }).notNull(),
  builtIn: boolean().notNull().default(false),
  privileged: boolean().notNull().default(false),
  ...timestamps,
})

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid().notNull().references(() => roles.id, { onDelete: "cascade" }),
  permission: varchar({ length: 80 }).notNull(),
}, (t) => [primaryKey({ columns: [t.roleId, t.permission] })])

export const userRoles = pgTable("user_roles", {
  userId: uuid().notNull().references(() => users.id),
  roleId: uuid().notNull().references(() => roles.id),
  grantedBy: uuid(),
  grantedAt: tstz().notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })])

/** Two-person staff-assisted account recovery (ch. 25.4). */
export const recoveryRequests = pgTable("recovery_requests", {
  id: id(),
  userId: uuid().notNull().references(() => users.id),
  newPhone: varchar({ length: 32 }).notNull(),
  evidenceNote: text().notNull(),
  requestedBy: uuid().notNull(),
  approvedBy: uuid(),
  status: text({ enum: ["PENDING", "APPROVED", "REJECTED", "COMPLETED"] }).notNull().default("PENDING"),
  ...timestamps,
})
