import { randomBytes } from "node:crypto"

import Stripe from "stripe"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppError } from "../../core/errors"
import { FakePaymentAdapter } from "./fake-payment.adapter"
import { StripeAdapter, verifyStripeSignature } from "./stripe.adapter"

// No real keys anywhere: the secret is generated here and only ever signs a local payload (ADR-0007 P13).
const secret = `whsec_${randomBytes(24).toString("hex")}`
const payload = JSON.stringify({ id: "evt_unit_1", object: "event", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_test_unit" } } })
const sign = (body: string, s = secret, timestamp = Math.floor(Date.now() / 1000)) => Stripe.webhooks.generateTestHeaderString({ payload: body, secret: s, timestamp })

describe("Stripe webhook signature verification (raw body)", () => {
  it("accepts the exact bytes that were signed", () => {
    expect(verifyStripeSignature(Buffer.from(payload), sign(payload), secret).id).toBe("evt_unit_1")
  })
  it("rejects a tampered body, a wrong secret, a stale timestamp and a missing header with SIGNATURE_INVALID", () => {
    const code = (fn: () => unknown) => { try { fn(); return "ok" } catch (e) { return e instanceof AppError ? e.code : "other" } }
    expect(code(() => verifyStripeSignature(Buffer.from(payload.replace("cs_test_unit", "cs_test_evil")), sign(payload), secret))).toBe("SIGNATURE_INVALID")
    expect(code(() => verifyStripeSignature(Buffer.from(payload), sign(payload, "whsec_other_secret_value"), secret))).toBe("SIGNATURE_INVALID")
    expect(code(() => verifyStripeSignature(Buffer.from(payload), sign(payload, secret, Math.floor(Date.now() / 1000) - 3600), secret))).toBe("SIGNATURE_INVALID")
    expect(code(() => verifyStripeSignature(Buffer.from(payload), undefined, secret))).toBe("SIGNATURE_INVALID")
  })
  it("verifies over raw bytes: re-serialised JSON with different whitespace fails", () => {
    const pretty = JSON.stringify(JSON.parse(payload), null, 2)
    expect(() => verifyStripeSignature(Buffer.from(pretty), sign(payload), secret)).toThrow()
  })
})

describe("adapters are gated (ADR-0007 P1, P12)", () => {
  afterEach(() => vi.unstubAllEnvs())
  it("a live Stripe secret key is refused at construction", () => {
    expect(() => new StripeAdapter({ secretKey: "sk_live_" + "x".repeat(24), publishableKey: null, webhookSecret: secret })).toThrowError(/Live Stripe keys are blocked/)
  })
  it("a test key constructs", () => {
    expect(new StripeAdapter({ secretKey: "sk_test_" + "x".repeat(24), publishableKey: "pk_test_" + "y".repeat(24), webhookSecret: secret }).id).toBe("STRIPE")
  })
  it("the FAKE adapter refuses to run in production, like the FAKE flight adapter", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(() => new FakePaymentAdapter({} as never)).toThrowError(/blocked in production/)
  })
  it("FAKE events are signed in Stripe's format and verify through the same code", async () => {
    const store = new Map<string, string>()
    const redis = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); return "OK" } }
    const fake = new FakePaymentAdapter(redis as never)
    const s = await fake.createSession({ invoiceId: "i1", invoiceNumber: "INV-2026-000001", amountMinor: 12_345, currency: "GBP", expiresAt: new Date(Date.now() + 3600_000), returnUrl: "http://x", idempotencyKey: "inv-i1-1" })
    expect(s.clientSecret).toContain("_secret_")
    expect((await fake.createSession({ invoiceId: "i1", invoiceNumber: "INV-2026-000001", amountMinor: 12_345, currency: "GBP", expiresAt: new Date(Date.now() + 3600_000), returnUrl: "http://x", idempotencyKey: "inv-i1-1" })).id).toBe(s.id)
    const e = await fake.simulate(s.id, "paid", { amountMinor: 12_345 })
    const event = fake.verifyWebhook(Buffer.from(e.payload), e.signature)
    expect(event.type).toBe("checkout.session.completed")
    expect(() => fake.verifyWebhook(Buffer.from(e.payload + " "), e.signature)).toThrow()
    expect((await fake.retrieveSession(s.id))).toMatchObject({ status: "complete", paymentStatus: "paid", amountTotal: 12_345, currency: "GBP" })
  })
})
