import { describe, expect, it } from "vitest"

import { BONLINE_SIGNATURE_HEADER, BonlineAdapter, bonlineSignature } from "./bonline.adapter"
import type { VendorCredentialsService } from "../notifications/vendor-credentials.service"

const SECRET = "a-long-enough-webhook-secret"
const adapter = (creds: Record<string, string> | null) => new BonlineAdapter({ get: async () => creds } as unknown as VendorCredentialsService)
const event = { callId: "c-1", direction: "INBOUND", fromNumber: "+447700900123", toNumber: "+442000000000", durationSeconds: 42, status: "ANSWERED", startedAt: "2026-11-01T10:00:00Z" }
const raw = Buffer.from(JSON.stringify(event))

describe("Bonline webhook verification (ADR-0019, INFERRED scheme)", () => {
  it("accepts a correctly signed event and returns it in our shape", async () => {
    const ev = await adapter({ webhookSecret: SECRET }).verifyAndParse(raw, { [BONLINE_SIGNATURE_HEADER]: bonlineSignature(SECRET, raw) })
    expect(ev).toMatchObject({ callId: "c-1", direction: "INBOUND", durationSeconds: 42 })
  })
  it("refuses a missing, wrong or unconfigured signature with the same error", async () => {
    for (const [creds, header] of [[{ webhookSecret: SECRET }, undefined], [{ webhookSecret: SECRET }, "sha256=00"], [{ webhookSecret: SECRET }, bonlineSignature("another-secret-of-length", raw)], [null, bonlineSignature(SECRET, raw)]] as const) {
      await expect(adapter(creds as Record<string, string> | null).verifyAndParse(raw, { [BONLINE_SIGNATURE_HEADER]: header })).rejects.toMatchObject({ code: "SIGNATURE_INVALID" })
    }
  })
  it("a valid signature over a body that is not a call event is a validation error, not a stored row", async () => {
    const bad = Buffer.from(JSON.stringify({ callId: "x" }))
    await expect(adapter({ webhookSecret: SECRET }).verifyAndParse(bad, { [BONLINE_SIGNATURE_HEADER]: bonlineSignature(SECRET, bad) })).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
  })
  it("click-to-call is NOT_CONFIGURED until the vendor API is implemented", async () => {
    await expect(adapter({ webhookSecret: SECRET }).clickToCall({ toNumber: "+447700900123" }, "u1")).rejects.toMatchObject({ code: "NOT_CONFIGURED", status: 501 })
  })
})
