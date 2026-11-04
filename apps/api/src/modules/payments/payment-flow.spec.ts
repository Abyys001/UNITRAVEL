import { describe, expect, it, vi } from "vitest"

import { compareSession, type DriftSession } from "./payment-drift"
import type { PaymentProvider, ProviderSession } from "./payment-port"
import { PaymentsService } from "./payments.service"

// Stubs only: no database, no Stripe, no network. The adapter is a mock that cannot move money.
const remote = (o: Partial<ProviderSession> = {}): ProviderSession => ({ id: "cs_test_1", status: "open", paymentStatus: "unpaid", clientSecret: null, amountTotal: 5000, currency: "GBP", paymentIntentId: null, expiresAt: null, payerName: null, ...o })
const local = (o: Partial<DriftSession> = {}): DriftSession => ({ status: "OPEN", amountMinor: 5000, currency: "GBP", ...o })

/** A drizzle-like query: awaiting it yields the rows; `.for()` and the builder steps return the same thenable. */
const query = (rows: unknown[]) => {
  const q: Record<string, unknown> = { then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) }
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit", "for"]) q[m] = () => q
  return q
}
/** `select()` hands out the queued row sets in call order; `update`/`insert` calls are recorded. */
function fakeTx(selects: unknown[][], insertReturning: unknown[][] = []) {
  const updates: unknown[] = []
  const inserts: unknown[] = []
  const tx = {
    select: () => query(selects.shift() ?? []),
    update: () => ({ set: (v: unknown) => { updates.push(v); return query([]) } }),
    insert: () => ({ values: (v: unknown) => { inserts.push(v); return { onConflictDoUpdate: () => ({ returning: async () => insertReturning.shift() ?? [] }), onConflictDoNothing: () => query([]) } } }),
  }
  return { tx, updates, inserts }
}

function service(over: { flag?: boolean; adapter?: Partial<PaymentProvider> | null; rows?: unknown[]; tx?: unknown } = {}) {
  const outbox = { add: vi.fn(async () => undefined) }
  const audit = { record: vi.fn(async () => undefined) }
  const invoices = { markPaid: vi.fn(), markRefunded: vi.fn() }
  const db = { select: () => query(over.rows ?? []) }
  const svc = new PaymentsService(
    db as never, {} as never, { run: async (fn: (tx: unknown) => unknown) => fn(over.tx ?? {}) } as never, audit as never, outbox as never,
    { flag: () => over.flag ?? true } as never, invoices as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  )
  const adapter = over.adapter === undefined ? { id: "STRIPE" as const, retrieveSession: vi.fn(async () => remote()) } : over.adapter
  vi.spyOn(svc, "provider").mockResolvedValue({ id: "STRIPE", adapter: adapter as PaymentProvider | null })
  return { svc, outbox, audit, invoices, adapter }
}

describe("compareSession (drift rules)", () => {
  it("matches an open session that is still open with the same amount", () => {
    expect(compareSession(local(), remote())).toBeNull()
    expect(compareSession(local({ status: "EXPIRED" }), remote({ status: "expired" }))).toBeNull()
  })
  it("flags a missing, paid, mis-sized and wrongly-open/closed session", () => {
    expect(compareSession(local(), null)).toBe("MISSING_AT_PROVIDER")
    expect(compareSession(local(), remote({ status: "complete", paymentStatus: "paid" }))).toBe("PAID_AT_PROVIDER")
    expect(compareSession(local(), remote({ amountTotal: 4000 }))).toBe("AMOUNT_MISMATCH")
    expect(compareSession(local(), remote({ currency: "EUR" }))).toBe("AMOUNT_MISMATCH")
    expect(compareSession(local(), remote({ status: "expired" }))).toBe("OPEN_EXPIRED_AT_PROVIDER")
    expect(compareSession(local({ status: "FAILED" }), remote({ status: "open" }))).toBe("CLOSED_OPEN_AT_PROVIDER")
  })
})

describe("PaymentsService.driftSweep (mocked adapter)", () => {
  const row = (n: string, s: string) => ({ s: { id: `row-${s}`, invoiceId: `inv-${n}`, providerSessionId: s, status: "OPEN", amountMinor: 5000, currency: "GBP" }, number: n })

  it("skips without touching the provider when online payments are off", async () => {
    const { svc, adapter, audit } = service({ flag: false })
    expect(await svc.driftSweep()).toEqual({ skipped: "FLAG_OFF" })
    expect((adapter as { retrieveSession: ReturnType<typeof vi.fn> }).retrieveSession).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })
  it("skips when there are no provider credentials (no adapter)", async () => {
    const { svc, audit } = service({ adapter: null })
    expect(await svc.driftSweep()).toEqual({ skipped: "NO_PROVIDER" })
    expect(audit.record).not.toHaveBeenCalled()
  })
  it("reports a clean run without findings and changes no state", async () => {
    const { svc, audit, outbox, invoices } = service({ rows: [row("INV-1", "cs_1")] })
    expect(await svc.driftSweep()).toEqual({ checked: 1, errors: 0, mismatches: [] })
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(outbox.add).not.toHaveBeenCalled()
    expect(invoices.markPaid).not.toHaveBeenCalled()
  })
  it("records mismatches in the audit entry only, and counts provider errors without logging their message", async () => {
    const retrieve = vi.fn()
      .mockResolvedValueOnce(remote({ status: "complete", paymentStatus: "paid" }))
      .mockRejectedValueOnce(new Error("secret sk_test_should_not_leak"))
      .mockResolvedValueOnce(null)
    const { svc, audit, outbox, invoices } = service({ adapter: { id: "STRIPE", retrieveSession: retrieve }, rows: [row("INV-1", "cs_1"), row("INV-2", "cs_2"), row("INV-3", "cs_3")] })
    const report = await svc.driftSweep()
    expect(report).toMatchObject({ checked: 3, errors: 1, mismatches: [{ invoice: "INV-1", kind: "PAID_AT_PROVIDER" }, { invoice: "INV-3", kind: "MISSING_AT_PROVIDER" }] })
    const entry = (audit.record.mock.calls as unknown as [unknown, { action: string; after: unknown }][])[0]![1]
    expect(entry.action).toBe("payment.drift_report")
    expect(JSON.stringify(entry.after)).not.toContain("sk_test")
    expect(outbox.add).not.toHaveBeenCalled()
    expect(invoices.markPaid).not.toHaveBeenCalled()
  })
})

describe("webhook idempotency and ordering", () => {
  const closed = (svc: PaymentsService, tx: unknown, command: "fail" | "expire") => (svc as unknown as { onSessionClosed(tx: unknown, o: { id: string }, c: string): Promise<string> }).onSessionClosed(tx, { id: "cs_1" }, command)
  const sess = (status: string) => ({ id: "s1", invoiceId: "i1", provider: "STRIPE", status, expiresAt: new Date() })
  const inv = (status: string) => ({ id: "i1", number: "INV-1", requestRef: "UT-1", customerUserId: "u1", status, requestType: "FLIGHT" })

  it("a failed payment on an open session fails the session, keeps the invoice ISSUED and tells the customer once", async () => {
    const { tx, updates } = fakeTx([[sess("OPEN")], [inv("ISSUED")]])
    const { svc, outbox } = service()
    expect(await closed(svc, tx, "fail")).toBe("PROCESSED")
    expect(updates).toEqual([{ status: "FAILED" }])
    expect(outbox.add).toHaveBeenCalledTimes(1)
    expect((outbox.add.mock.calls as unknown as [unknown, { eventType: string }][])[0]![1].eventType).toBe("payment.failed")
  })
  it("a failed or expired event arriving after the session completed changes nothing and sends nothing", async () => {
    for (const command of ["fail", "expire"] as const) {
      const { tx, updates } = fakeTx([[sess("COMPLETE")], [inv("PAID")]])
      const { svc, outbox, invoices } = service()
      expect(await closed(svc, tx, command)).toBe("PROCESSED")
      expect(updates).toEqual([])
      expect(outbox.add).not.toHaveBeenCalled()
      expect(invoices.markPaid).not.toHaveBeenCalled()
    }
  })
  it("a failed event for an invoice that was paid another way closes the session but sends no failure notice", async () => {
    const { tx } = fakeTx([[sess("OPEN")], [inv("PAID")]])
    const { svc, outbox } = service()
    await closed(svc, tx, "fail")
    expect(outbox.add).not.toHaveBeenCalled()
  })
  it("an abandoned (expired) session sends no customer notice", async () => {
    const { tx } = fakeTx([[sess("OPEN")], [inv("ISSUED")]])
    const { svc, outbox } = service()
    await closed(svc, tx, "expire")
    expect(outbox.add).not.toHaveBeenCalled()
  })
  it("replaying a processed event is a no-op: nothing is dispatched", async () => {
    // The first insert returns the claimed row; the replay returns no row (conflict on a PROCESSED event).
    const event = { id: "evt_1", type: "checkout.session.async_payment_failed", livemode: false, data: { object: { id: "cs_1" } } }
    const { svc, outbox } = service({ adapter: { id: "STRIPE", verifyWebhook: () => event as never } })
    const dispatch = vi.spyOn(svc as unknown as { dispatch: () => Promise<string> }, "dispatch").mockResolvedValue("PROCESSED")
    const first = fakeTx([], [[{ id: "evt_1" }]])
    ;(svc as unknown as { uow: unknown }).uow = { run: async (fn: (tx: unknown) => unknown) => fn(first.tx) }
    expect(await svc.handleWebhook(Buffer.from("{}"), "sig")).toEqual({ received: true })
    const replay = fakeTx([], [[]])
    ;(svc as unknown as { uow: unknown }).uow = { run: async (fn: (tx: unknown) => unknown) => fn(replay.tx) }
    expect(await svc.handleWebhook(Buffer.from("{}"), "sig")).toEqual({ received: true, duplicate: true })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(outbox.add).not.toHaveBeenCalled()
  })
})
