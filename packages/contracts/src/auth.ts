import { z } from "zod"

import { IsoDateTime, Uuid } from "./common"
import { CalendarPref, ClientKind, DevicePlatform, IdentityType, Locale, OtpPurpose, PushProvider } from "./enums"
import { PERMISSIONS } from "./permissions"

// Chapter 24.3 / 25.1 — OTP sign-in.
export const OtpRequestBody = z.object({
  channel: IdentityType,
  /** Phone in any format (local Iranian 0912… accepted) or an email address; normalised server-side. */
  value: z.string().min(3).max(254),
  purpose: OtpPurpose.default("SIGN_IN"),
  defaultCountry: z.string().regex(/^[A-Z]{2}$/).optional(),
  deviceId: z.string().min(8).max(128),
  client: ClientKind,
  /** Proof-of-work solution (ALTCHA-compatible payload, base64) when the server asked for one. */
  challenge: z.string().max(4096).optional(),
  voice: z.boolean().default(false),
})
export type OtpRequestBody = z.infer<typeof OtpRequestBody>

export const OtpRequestResult = z.object({
  challengeId: Uuid,
  resendAfterSeconds: z.number().int(),
  expiresAt: IsoDateTime,
  normalised: z.string(),
  voiceAvailable: z.boolean(),
})

export const PowChallenge = z.object({ algorithm: z.literal("SHA-256"), challenge: z.string(), salt: z.string(), maxnumber: z.number().int(), signature: z.string() })
export type PowChallenge = z.infer<typeof PowChallenge>

export const OtpVerifyBody = z.object({
  challengeId: Uuid,
  code: z.string().regex(/^[0-9۰-۹٠-٩]{4,8}$/),
  deviceId: z.string().min(8).max(128),
  client: ClientKind,
  /** Asked for only when a new account is created (ch. 11.2 step 3). */
  profile: z
    .object({ givenNamesLatin: z.string().min(1).max(80), surnameLatin: z.string().min(1).max(80), nameFa: z.string().max(120).optional() })
    .optional(),
})
export type OtpVerifyBody = z.infer<typeof OtpVerifyBody>

export const TokenPair = z.object({
  accessToken: z.string(),
  accessExpiresAt: IsoDateTime,
  refreshToken: z.string(),
  refreshExpiresAt: IsoDateTime,
})

export const VerifyResult = z.object({
  isNewUser: z.boolean(),
  needsProfile: z.boolean(),
  mfaRequired: z.boolean(),
  mfaEnrolmentRequired: z.boolean(),
  /** Only for bearer clients (mobile); web/console receive HTTP-only cookies instead. */
  tokens: TokenPair.optional(),
})
export type VerifyResult = z.infer<typeof VerifyResult>

export const RefreshBody = z.object({ refreshToken: z.string().optional() })

export const MfaVerifyBody = z.object({ type: z.enum(["TOTP"]), code: z.string().regex(/^\d{6}$/) })
export const TotpEnrolment = z.object({ factorId: Uuid, secret: z.string(), otpauthUrl: z.string() })
export const WebAuthnOptionsResult = z.object({ options: z.record(z.string(), z.unknown()) })
export const WebAuthnVerifyBody = z.object({ response: z.record(z.string(), z.unknown()) })

export const Identity = z.object({
  id: Uuid,
  type: IdentityType,
  value: z.string(),
  verifiedAt: IsoDateTime.nullable(),
  isPrimary: z.boolean(),
})
export type Identity = z.infer<typeof Identity>

export const Me = z.object({
  id: Uuid,
  displayName: z.string(),
  status: z.string(),
  preferredLocale: Locale,
  calendar: CalendarPref,
  timezone: z.string(),
  identities: z.array(Identity),
  roles: z.array(z.string()),
  permissions: z.array(z.enum(PERMISSIONS)),
  flags: z.record(z.string(), z.boolean()),
  permVersion: z.number().int(),
  profile: z
    .object({ givenNamesLatin: z.string().nullable(), surnameLatin: z.string().nullable(), nameFa: z.string().nullable(), contactTimePref: z.string().nullable() })
    .nullable(),
  notificationPrefs: z.record(z.string(), z.boolean()),
  mfa: z.object({ level: z.number().int(), enrolled: z.array(z.string()), stepUpValidUntil: IsoDateTime.nullable() }),
  onDuty: z.boolean(),
  surfaces: z.object({ customer: z.boolean(), admin: z.boolean(), developer: z.boolean() }),
})
export type Me = z.infer<typeof Me>

export const UpdateMeBody = z
  .object({
    displayName: z.string().min(1).max(120),
    preferredLocale: Locale,
    calendar: CalendarPref,
    timezone: z.string().min(3).max(64),
    givenNamesLatin: z.string().min(1).max(80),
    surnameLatin: z.string().min(1).max(80),
    nameFa: z.string().max(120).nullable(),
    contactTimePref: z.string().max(80).nullable(),
    notificationPrefs: z.record(z.string(), z.boolean()),
    onDuty: z.boolean(),
  })
  .partial()
  .strict()

export const AddIdentityBody = z.object({ type: IdentityType, value: z.string().min(3).max(254), defaultCountry: z.string().length(2).optional(), deviceId: z.string().min(8) })

export const DeviceBody = z.object({
  platform: DevicePlatform,
  pushProvider: PushProvider,
  pushToken: z.string().min(8).max(4096),
  appVersion: z.string().max(40).optional(),
})

export const SessionView = z.object({
  id: Uuid,
  client: ClientKind,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  current: z.boolean(),
  mfaLevel: z.number().int(),
})
