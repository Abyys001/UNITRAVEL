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
  /** ADR-0020: any SMTP relay. Values arrive as strings from the Developer Panel, so the port and the TLS switch are strings here. */
  "email:smtp": z.strictObject({
    host: z.string().min(3).max(253).regex(/^[A-Za-z0-9.-]+$/, "A host name such as smtp.example.com"),
    port: z.string().regex(/^\d{2,5}$/, "A port number such as 587"),
    user: secret, pass: secret,
    secure: z.enum(["true", "false"]).optional(),
    from: z.string().max(254).optional(),
  }),
  /** ADR-0019: Bonline call tracking. The webhook secret signs incoming call events; the API fields stay empty until Bonline's documentation is supplied (UNKNOWN). */
  "telephony:bonline": z.strictObject({ webhookSecret: z.string().min(16).max(4096), apiKey: optionalSecret, baseUrl: z.string().url().startsWith("https://").optional() }),
} as const

export type VendorId = keyof typeof VENDOR_CREDENTIAL_SCHEMAS
export const VENDOR_IDS = Object.keys(VENDOR_CREDENTIAL_SCHEMAS) as VendorId[]
export const isVendorId = (v: string): v is VendorId => v in VENDOR_CREDENTIAL_SCHEMAS
