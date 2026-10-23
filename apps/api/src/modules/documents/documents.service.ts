import { createHash } from "node:crypto"
import { Socket } from "node:net"

import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, eq, inArray } from "drizzle-orm"

import { type Db, type DbOrTx, documents } from "@unitravel/db"

import { env } from "../../core/env"
import { AppError } from "../../core/errors"
import { DB } from "../../core/infra.module"
import { ObjectStorage } from "../../core/storage"
import { WorkerRegistry } from "../../core/workers"
import { OutboxService } from "../platform/outbox.service"

export const UPLOAD_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"], "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"],
}
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"

/** clamd INSTREAM over TCP (ch. 30.3 ClamAV container). */
async function clamScan(host: string, port: number, body: Buffer): Promise<{ clean: boolean; detail: string }> {
  return new Promise((resolve, reject) => {
    const sock = new Socket()
    let out = ""
    sock.setTimeout(30_000)
    sock.connect(port, host, () => {
      sock.write("zINSTREAM\0")
      for (let i = 0; i < body.length; i += 64 * 1024) {
        const chunk = body.subarray(i, i + 64 * 1024)
        const len = Buffer.alloc(4)
        len.writeUInt32BE(chunk.length)
        sock.write(Buffer.concat([len, chunk]))
      }
      sock.write(Buffer.alloc(4))
    })
    sock.on("data", (d) => (out += d.toString()))
    sock.on("end", () => resolve({ clean: /OK\0?$/.test(out.trim()), detail: out.replace(/\0/g, "").trim() }))
    sock.on("timeout", () => { sock.destroy(); reject(new Error("clamd timeout")) })
    sock.on("error", reject)
  })
}

/**
 * Uploads through short-lived pre-signed URLs, virus-scanned before availability, linked to a request with a type
 * and published to the customer explicitly (ch. 14.9, 28.1). Downloads use 5-minute signed URLs.
 */
@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly log = new Logger("Documents")

  constructor(@Inject(DB) private readonly db: Db, private readonly storage: ObjectStorage, private readonly outbox: OutboxService, private readonly workers: WorkerRegistry) {}

  onModuleInit() {
    this.workers.register("documents.scan", (job) => this.scan((job.data as { payload: { documentId: string } }).payload.documentId), 3)
  }

  async createUpload(input: { ownerUserId: string | null; filename: string; mime: string; size: number; type: string; requestType?: "FLIGHT" | "CARGO" | "AFTER_SALES"; requestId?: string; visibility?: "INTERNAL" | "CUSTOMER"; createdBy: string }) {
    const ext = input.filename.toLowerCase().slice(input.filename.lastIndexOf("."))
    if (!UPLOAD_TYPES[input.mime]?.includes(ext)) throw new AppError("VALIDATION_FAILED", "Only PDF, JPG and PNG files are accepted", [{ path: "mime", code: "TYPE_NOT_ALLOWED" }])
    if (input.size <= 0 || input.size > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION_FAILED", "Files must be 10 MB or smaller", [{ path: "size", code: "TOO_LARGE" }])
    const storageKey = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${ext}`
    const [doc] = await this.db.insert(documents).values({ ownerUserId: input.ownerUserId, requestType: input.requestType, requestId: input.requestId, type: input.type, filename: input.filename.slice(0, 200), mime: input.mime, size: input.size, storageKey, visibility: input.visibility ?? "INTERNAL", createdBy: input.createdBy }).returning()
    const { url } = await this.storage.presignPut(storageKey, input.mime, MAX_UPLOAD_BYTES)
    return { documentId: doc!.id, uploadUrl: url, method: "PUT", headers: { "content-type": input.mime }, expiresInSeconds: 300 }
  }

  async complete(documentId: string, userId: string) {
    const [doc] = await this.db.select().from(documents).where(eq(documents.id, documentId))
    if (!doc || (doc.createdBy !== userId)) throw new AppError("NOT_FOUND")
    await this.db.update(documents).set({ uploadCompletedAt: new Date() }).where(eq(documents.id, documentId))
    await this.outbox.add(this.db, { aggregateType: "document", aggregateId: documentId, eventType: "document.uploaded", payload: { documentId } })
    return { documentId, scanStatus: "PENDING" }
  }

  /** Server-generated documents (quote PDF, receipts, ATOL certificate) are clean by construction. */
  async storeGenerated(tx: DbOrTx, input: { ownerUserId: string; requestType: "FLIGHT" | "CARGO"; requestId: string; type: string; filename: string; body: Buffer; createdBy: string; visibility: "INTERNAL" | "CUSTOMER" }) {
    const storageKey = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.pdf`
    await this.storage.put(storageKey, input.body, "application/pdf")
    const [doc] = await tx.insert(documents).values({ ownerUserId: input.ownerUserId, requestType: input.requestType, requestId: input.requestId, type: input.type, filename: input.filename, mime: "application/pdf", size: input.body.length, storageKey, sha256: createHash("sha256").update(input.body).digest("hex"), scanStatus: "CLEAN", visibility: input.visibility, uploadCompletedAt: new Date(), createdBy: input.createdBy }).returning()
    return doc!
  }

  async scan(documentId: string) {
    const [doc] = await this.db.select().from(documents).where(eq(documents.id, documentId))
    if (!doc || doc.scanStatus !== "PENDING") return
    const body = await this.storage.get(doc.storageKey)
    const sha256 = createHash("sha256").update(body).digest("hex")
    let clean: boolean
    let engine: string
    if (env().CLAMAV_HOST) {
      const r = await clamScan(env().CLAMAV_HOST!, env().CLAMAV_PORT, body)
      clean = r.clean
      engine = `clamav: ${r.detail}`
    } else {
      // Without ClamAV only non-production may proceed, using the EICAR test signature as a smoke check.
      if (env().APP_ENV === "production") throw new Error("CLAMAV_HOST is required in production")
      clean = !body.toString("latin1").includes(EICAR)
      engine = "dev-signature-check"
    }
    await this.db.update(documents).set({ scanStatus: clean ? "CLEAN" : "INFECTED", sha256, size: body.length }).where(eq(documents.id, documentId))
    if (!clean) await this.storage.delete(doc.storageKey).catch(() => undefined)
    this.log.log({ documentId, clean, engine }, "document scanned")
    return { clean, engine }
  }

  async get(id: string) {
    const [d] = await this.db.select().from(documents).where(eq(documents.id, id))
    return d
  }

  async forRequest(requestType: "FLIGHT" | "CARGO" | "AFTER_SALES", requestId: string, customerView: boolean) {
    const rows = await this.db.select().from(documents).where(and(eq(documents.requestType, requestType), eq(documents.requestId, requestId)))
    return rows.filter((d) => d.scanStatus === "CLEAN" && d.uploadCompletedAt && (!customerView || d.visibility === "CUSTOMER" || d.ownerUserId === d.createdBy))
  }

  async attach(tx: DbOrTx, ids: string[], requestType: "FLIGHT" | "CARGO" | "AFTER_SALES", requestId: string, userId: string) {
    if (!ids.length) return
    const rows = await tx.select().from(documents).where(inArray(documents.id, ids))
    if (rows.length !== ids.length || rows.some((r) => r.createdBy !== userId && r.ownerUserId !== userId)) throw new AppError("NOT_FOUND", "Document not found")
    await tx.update(documents).set({ requestType, requestId }).where(inArray(documents.id, ids))
  }

  async publish(tx: DbOrTx, id: string) {
    await tx.update(documents).set({ visibility: "CUSTOMER" }).where(eq(documents.id, id))
  }

  async downloadUrl(d: typeof documents.$inferSelect) {
    if (d.scanStatus !== "CLEAN") throw new AppError("VALIDATION_FAILED", d.scanStatus === "PENDING" ? "The file is still being checked" : "The file failed the virus check")
    return { url: await this.storage.presignGet(d.storageKey, d.filename), expiresInSeconds: 300 }
  }
}
