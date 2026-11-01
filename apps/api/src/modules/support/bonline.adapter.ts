import { createHmac } from "node:crypto"

import { Injectable } from "@nestjs/common"

import { type ClickToCallBody, TelephonyEvent } from "@unitravel/contracts"

import { constantTimeEqual } from "../../core/crypto"
import { AppError } from "../../core/errors"
import { VendorCredentialsService } from "../notifications/vendor-credentials.service"
import type { TelephonyPort } from "./telephony.port"

export const BONLINE_VENDOR = "telephony:bonline"
export const BONLINE_SIGNATURE_HEADER = "x-bonline-signature"

/** Hex HMAC-SHA256 of the raw body, as the `sha256=<hex>` header value. INFERRED scheme (ADR-0019), not Bonline's documented one. */
export function bonlineSignature(secret: string, rawBody: Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`
}

@Injectable()
export class BonlineAdapter implements TelephonyPort {
  readonly vendor = BONLINE_VENDOR

  constructor(private readonly creds: VendorCredentialsService) {}

  async webhookConfigured(): Promise<boolean> {
    return !!(await this.creds.get(BONLINE_VENDOR))?.webhookSecret
  }

  async verifyAndParse(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<TelephonyEvent> {
    const secret = (await this.creds.get(BONLINE_VENDOR))?.webhookSecret
    const given = headers[BONLINE_SIGNATURE_HEADER]
    // One answer for "not configured", "missing" and "wrong": a caller learns nothing about which it was.
    if (!secret || !given || !constantTimeEqual(bonlineSignature(secret, rawBody), given)) throw new AppError("SIGNATURE_INVALID", "Signature missing or invalid")
    let json: unknown
    try { json = JSON.parse(rawBody.toString("utf8")) } catch { throw new AppError("VALIDATION_FAILED", "The body is not JSON") }
    const parsed = TelephonyEvent.safeParse(json)
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", "The call event does not match the expected fields", parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message })))
    return parsed.data
  }

  async clickToCall(_input: ClickToCallBody, _agentUserId: string): Promise<{ callId: string }> {
    throw new AppError("NOT_CONFIGURED", "Click-to-call needs the Bonline API, which has not been supplied (ADR-0019)")
  }
}
