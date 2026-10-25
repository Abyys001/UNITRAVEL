import { z } from "zod"

const secret = z.string().min(1).max(4096)
const optionalSecret = secret.optional()

/** Credential fields each vendor needs, matching what channels.ts reads. Unknown fields and empty objects are refused, so a rotation can never store nothing. */
export const VENDOR_CREDENTIAL_SCHEMAS = {
  "sms:kavenegar": z.strictObject({ apiKey: secret, sender: optionalSecret }),
  "sms:smsir": z.strictObject({ apiKey: secret, lineNumber: z.string().regex(/^\d{3,20}$/) }),
  "sms:sinch": z.strictObject({ servicePlanId: secret, apiToken: secret, sender: secret, region: z.enum(["us", "eu", "au", "br", "ca"]).optional() }),
  "sms:infobip": z.strictObject({ baseUrl: z.string().regex(/^[a-z0-9.-]+\.infobip\.com$/i, "Use the host from your Infobip account, such as xxxx.api.infobip.com"), apiKey: secret, sender: secret, webhookSecret: optionalSecret }),
  "push:expo": z.strictObject({ accessToken: secret }),
  "push:pushy": z.strictObject({ secretApiKey: secret }),
  "email:brevo": z.strictObject({ smtpUser: secret, smtpKey: secret }),
} as const

export type VendorId = keyof typeof VENDOR_CREDENTIAL_SCHEMAS
export const VENDOR_IDS = Object.keys(VENDOR_CREDENTIAL_SCHEMAS) as VendorId[]
export const isVendorId = (v: string): v is VendorId => v in VENDOR_CREDENTIAL_SCHEMAS
