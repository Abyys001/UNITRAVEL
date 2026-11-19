import { createHash } from "node:crypto"

import { S3Client } from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import { ObjectStorage } from "../../core/storage"
import { DocumentsService } from "../documents/documents.service"
import { TicketDocumentsService } from "./ticket-documents.service"

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")
const BYTES = Buffer.from("%PDF-1.7 provider boarding pass")

/**
 * Customer file route (ADR-0038): the signed URL carries `response-content-disposition`, which the store echoes as the
 * Content-Disposition header. The real presigner and DocumentsService.downloadUrl run; only the database and object reads are doubles.
 */
function harness() {
  const storage = Object.create(ObjectStorage.prototype) as ObjectStorage
  const publicClient = new S3Client({ region: "eu-west-2", endpoint: "http://localhost:9010", forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test-secret" } })
  Object.assign(storage, { publicClient, bucket: "b", get: vi.fn(async () => BYTES) })
  const doc = { id: "doc-1", storageKey: "tickets/original/2026-11/a.pdf", storageBucket: null, scanStatus: "CLEAN", erasedAt: null, sha256: sha(BYTES), filename: "boarding pass.pdf", type: "TICKET_ORIGINAL" }
  const docs = Object.assign(Object.create(DocumentsService.prototype) as DocumentsService, { storage, get: vi.fn(async () => doc) })
  const row = { td: { id: "td-1", requestId: "r-1", status: "ISSUED", originalDocumentId: "doc-1", originalSha256: sha(BYTES), brandedDocumentId: null, brandedSha256: null }, ref: "UT-F-ABC123", customerUserId: "cust-1" }
  const chain = { from: () => chain, innerJoin: () => chain, where: async () => [row] }
  const record = vi.fn(async () => undefined)
  const db = { select: () => chain, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) }
  const svc = new TicketDocumentsService(db as never, {} as never, docs as never, storage as never, { record } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  return { svc, record }
}

const actor = { userId: "cust-1", ip: "127.0.0.1" } as never
const dispositionOf = (url: string) => new URL(url).searchParams.get("response-content-disposition")

describe("customer ticket file disposition (ADR-0038)", () => {
  it("defaults to attachment", async () => {
    const { svc } = harness()
    const { url } = await svc.customerFile("td-1", "original", actor, "req-1")
    expect(dispositionOf(url)).toBe('attachment; filename="boarding_pass.pdf"')
  })

  it("is inline only when asked, and the download audit records it", async () => {
    const { svc, record } = harness()
    const { url } = await svc.customerFile("td-1", "original", actor, "req-1", "inline")
    expect(dispositionOf(url)).toBe('inline; filename="boarding_pass.pdf"')
    expect(record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ticket_document.downloaded", after: expect.objectContaining({ disposition: "inline" }) }))
  })

  it("another customer gets 404 and no URL", async () => {
    const { svc } = harness()
    await expect(svc.customerFile("td-1", "original", { userId: "someone-else", ip: null } as never, "req-1", "inline")).rejects.toMatchObject({ status: 404 })
  })
})
