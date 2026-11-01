import type { ClickToCallBody, TelephonyEvent } from "@unitravel/contracts"

/**
 * What the platform needs from a telephony vendor (ADR-0019). The manual call log does not depend on it. Bonline's own API
 * documentation is UNKNOWN, so the only adapter implements the verification scheme below as an INFERRED generic HMAC and
 * refuses click-to-call.
 */
export interface TelephonyPort {
  readonly vendor: string
  /** True when the credentials needed to accept webhooks exist. */
  webhookConfigured(): Promise<boolean>
  /** Verifies the signature over the raw body and returns the vendor event in our shape; throws SIGNATURE_INVALID or VALIDATION_FAILED. */
  verifyAndParse(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<TelephonyEvent>
  /** Starts a call from the agent's phone to a number. Throws NOT_CONFIGURED until the vendor API is implemented. */
  clickToCall(input: ClickToCallBody, agentUserId: string): Promise<{ callId: string }>
}
export const TELEPHONY = Symbol("TELEPHONY")
