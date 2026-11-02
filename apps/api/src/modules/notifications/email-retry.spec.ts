import { describe, expect, it, vi } from "vitest"

import { QUEUE_DEFAULTS } from "../../core/queues"
import { NotificationsService } from "./notifications.service"

const query = (rows: unknown[]) => {
  const q: Record<string, unknown> = { then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) }
  for (const m of ["from", "where"]) q[m] = () => q
  return q
}

/** Each processEmail attempt reads: delivery, notification, user, identities, templates (in this order). */
function harness(send: ReturnType<typeof vi.fn>) {
  const sets: Record<string, unknown>[] = []
  const attempt = () => [
    [{ id: "d1", notificationId: "n1", status: sets.at(-1)?.status === "SENT" ? "SENT" : "FAILED" }],
    [{ id: "n1", userId: "u1", eventType: "invoice.issued", title: "t", body: "b", data: { vars: { number: "INV-1" } } }],
    [{ id: "u1", status: "ACTIVE", preferredLocale: "en", timezone: "UTC", calendar: "GREGORIAN", notificationPrefs: {} }],
    [{ type: "EMAIL", verifiedAt: new Date(), valueNormalised: "a@example.test", revokedAt: null }],
    [{ locale: "en", title: "Invoice {number}", body: "Invoice {number}" }],
  ]
  let queue: unknown[][] = []
  const db = {
    select: () => { if (!queue.length) queue = attempt(); return query(queue.shift()!) },
    update: () => ({ set: (v: Record<string, unknown>) => { sets.push(v); queue = []; return query([]) } }),
  }
  const svc = new NotificationsService(db as never, {} as never, {} as never, {} as never, {} as never, {} as never, { send } as never, {} as never)
  return { svc, sets }
}

describe("invoice email delivery when the email provider is down", () => {
  it("marks the delivery FAILED and rethrows so the queue retries; the retry then sends and marks SENT", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("SMTP connection refused")).mockResolvedValueOnce({ provider: "smtp", messageId: "m1" })
    const { svc, sets } = harness(send)
    await expect(svc.processEmail("d1")).rejects.toThrow("SMTP connection refused")
    expect(sets.at(-1)).toMatchObject({ status: "FAILED" })
    await svc.processEmail("d1")
    expect(sets.at(-1)).toMatchObject({ status: "SENT", provider: "smtp" })
    expect(send).toHaveBeenCalledTimes(2)
  })
  it("is retried by the queue: five attempts with exponential backoff, failures kept", () => {
    expect(QUEUE_DEFAULTS["notify.email"]).toMatchObject({ attempts: 5, backoff: { type: "exponential" }, removeOnFail: false })
  })
})
