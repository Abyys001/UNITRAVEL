import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { AppError } from "../../core/errors"
import { TicketDocumentsService } from "./ticket-documents.service"

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")

function harness(stored: Buffer, recorded: string) {
  const record = vi.fn(async () => undefined)
  const db = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) }
  const docs = { get: vi.fn(async () => ({ id: "doc-1", storageKey: "tickets/original/2026-11/a.pdf", scanStatus: "CLEAN", erasedAt: null, sha256: recorded, filename: "a.pdf", type: "TICKET_ORIGINAL" })) }
  const storage = { get: vi.fn(async () => stored) }
  const svc = new TicketDocumentsService(db as never, {} as never, docs as never, storage as never, { record } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  return { svc, record }
}

describe("original integrity (ADR-0038 D2)", () => {
  const td = (originalSha256: string) => ({ id: "td-1", requestId: "r-1", originalDocumentId: "doc-1", originalSha256 })

  it("serves the original when the stored bytes still hash to the recorded sha256", async () => {
    const bytes = Buffer.from("%PDF-1.7 original")
    const { svc, record } = harness(bytes, sha(bytes))
    await expect(svc.readOriginal(td(sha(bytes)), "u1")).resolves.toEqual(bytes)
    expect(record).not.toHaveBeenCalled()
  })

  it("fails closed on a mismatch: no bytes, 409 INTEGRITY_ALERT, and an audited alert", async () => {
    const bytes = Buffer.from("%PDF-1.7 original")
    const { svc, record } = harness(Buffer.from("%PDF-1.7 tampered"), sha(bytes))
    const err = await svc.readOriginal(td(sha(bytes)), "u1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect(err).toMatchObject({ code: "INTEGRITY_ALERT", status: 409 })
    expect(record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ticket_document.integrity_alert", entityId: "td-1", after: expect.objectContaining({ which: "original", expected: sha(bytes) }) }))
  })

  it("fails closed when the document row and the version disagree on the hash", async () => {
    const bytes = Buffer.from("%PDF-1.7 original")
    const { svc } = harness(bytes, "f".repeat(64))
    await expect(svc.readOriginal(td(sha(bytes)), null)).rejects.toMatchObject({ code: "INTEGRITY_ALERT" })
  })
})
