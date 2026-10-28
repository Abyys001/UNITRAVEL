import { createHash } from "node:crypto"
import { Socket } from "node:net"

import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, eq, inArray, isNull, lt } from "drizzle-orm"

import { IDENTITY_DOCUMENT_TYPES } from "@unitravel/contracts"
import { type Db, type DbOrTx, documents } from "@unitravel/db"

import { env } from "../../core/env"
import { AppError } from "../../core/errors"
import { DB } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { ObjectStorage } from "../../core/storage"
import { WorkerRegistry } from "../../core/workers"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { stripImageMetadata, UnsupportedImageError } from "./image-sanitise"
import { safeError } from "../../core/safe-error"
import { OutboxService } from "../platform/outbox.service"

export const UPLOAD_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"], "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"],
}
/** Identity scans are images only: a PDF can carry metadata and active content a lossless stripper cannot vouch for (ADR-0005 V6). */
export const IDENTITY_UPLOAD_TYPES: Record<string, string[]> = { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] }
/** Magic bytes for the accepted upload types. */
export function matchesDeclaredType(body: Buffer, mime: string): boolean {
  if (mime === "application/pdf") return body.subarray(0, 1024).includes("%PDF-")
  if (mime === "image/png") return body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mime === "image/jpeg") return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
  return false
}

export const isIdentityType = (type: string) => (IDENTITY_DOCUMENT_TYPES as readonly string[]).includes(type)
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

  constructor(@Inject(DB) private readonly db: Db, private readonly storage: ObjectStorage, private readonly outbox: OutboxService, private readonly workers: WorkerRegistry, private readonly config: ConfigService, private readonly queues: Queues, private readonly audit: AuditService) {}

  async onModuleInit() {
    this.workers.register("documents.scan", (job) => this.scan((job.data as { payload: { documentId: string } }).payload.documentId), 3)
    this.workers.registerJob("maintenance", "identity.scan-retention", () => this.purgeExpiredScans())
    await this.queues.get("maintenance").upsertJobScheduler("identity-scan-retention-daily", { every: 24 * 3600_000 }, { name: "identity.scan-retention" }).catch(() => undefined)
  }

  private bucketOf(d: { storageBucket: string | null }) {
    return d.storageBucket ?? this.storage.bucket
  }

  async createUpload(input: { ownerUserId: string | null; filename: string; mime: string; size: number; type: string; requestType?: "FLIGHT" | "CARGO" | "AFTER_SALES" | "SERVICE"; requestId?: string; visibility?: "INTERNAL" | "CUSTOMER"; createdBy: string }) {
    const ext = input.filename.toLowerCase().slice(input.filename.lastIndexOf("."))
    const identity = isIdentityType(input.type)
    if (identity) {
      if (!IDENTITY_UPLOAD_TYPES[input.mime]?.includes(ext)) throw new AppError("VALIDATION_FAILED", "Passport scans must be JPG or PNG images", [{ path: "mime", code: "TYPE_NOT_ALLOWED" }])
    } else if (!UPLOAD_TYPES[input.mime]?.includes(ext)) throw new AppError("VALIDATION_FAILED", "Only PDF, JPG and PNG files are accepted", [{ path: "mime", code: "TYPE_NOT_ALLOWED" }])
    if (input.size <= 0 || input.size > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION_FAILED", "Files must be 10 MB or smaller", [{ path: "size", code: "TOO_LARGE" }])
    const storageKey = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${ext}`
    const storageBucket = identity ? this.storage.identityBucket : null
    const [doc] = await this.db.insert(documents).values({ ownerUserId: input.ownerUserId, requestType: input.requestType, requestId: input.requestId, type: input.type, filename: input.filename.slice(0, 200), mime: input.mime, size: input.size, storageKey, storageBucket, visibility: identity ? "INTERNAL" : input.visibility ?? "INTERNAL", createdBy: input.createdBy }).returning()
    const { url } = await this.storage.presignPut(storageKey, input.mime, input.size, 300, storageBucket ?? this.storage.bucket)
    return { documentId: doc!.id, uploadUrl: url, method: "PUT", headers: { "content-type": input.mime, ...(identity ? { "x-amz-server-side-encryption": "AES256" } : {}) }, expiresInSeconds: 300 }
  }

  async complete(documentId: string, userId: string) {
    const [doc] = await this.db.select().from(documents).where(eq(documents.id, documentId))
    if (!doc || (doc.createdBy !== userId)) throw new AppError("NOT_FOUND")
    // The stored object must be the one announced: present, and exactly the declared size (never above the limit).
    const stored = await this.storage.sizeOf(doc.storageKey, this.bucketOf(doc))
    if (stored === undefined) throw new AppError("VALIDATION_FAILED", "Upload the file before completing", [{ path: "documentId", code: "NOT_UPLOADED" }])
    if (stored !== doc.size || stored > MAX_UPLOAD_BYTES) {
      await this.storage.delete(doc.storageKey, this.bucketOf(doc)).catch(() => undefined)
      throw new AppError("VALIDATION_FAILED", "Files must be 10 MB or smaller", [{ path: "size", code: "TOO_LARGE" }])
    }
    await this.db.update(documents).set({ uploadCompletedAt: new Date() }).where(eq(documents.id, documentId))
    await this.outbox.add(this.db, { aggregateType: "document", aggregateId: documentId, eventType: "document.uploaded", payload: { documentId } })
    return { documentId, scanStatus: "PENDING" }
  }

  /** Server-generated documents (quote PDF, receipts, ATOL certificate) are clean by construction. */
  async storeGenerated(tx: DbOrTx, input: { ownerUserId: string; requestType: "FLIGHT" | "CARGO" | "SERVICE"; requestId: string; type: string; filename: string; body: Buffer; createdBy: string; visibility: "INTERNAL" | "CUSTOMER" }) {
    const storageKey = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.pdf`
    await this.storage.put(storageKey, input.body, "application/pdf")
    const [doc] = await tx.insert(documents).values({ ownerUserId: input.ownerUserId, requestType: input.requestType, requestId: input.requestId, type: input.type, filename: input.filename, mime: "application/pdf", size: input.body.length, storageKey, sha256: createHash("sha256").update(input.body).digest("hex"), scanStatus: "CLEAN", visibility: input.visibility, uploadCompletedAt: new Date(), createdBy: input.createdBy }).returning()
    return doc!
  }

  async scan(documentId: string) {
    const [doc] = await this.db.select().from(documents).where(eq(documents.id, documentId))
    if (!doc || doc.scanStatus !== "PENDING") return
    const bucket = this.bucketOf(doc)
    let body = await this.storage.get(doc.storageKey, bucket)
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
    // The bytes must be what the declared type says (a renamed executable or HTML page is refused, ch. 28.1).
    if (clean && !matchesDeclaredType(body, doc.mime)) {
      clean = false
      engine += "; content does not match the declared file type"
    }
    let finalSha = sha256
    if (clean && isIdentityType(doc.type)) {
      // Metadata is removed before the scan becomes available; an image that cannot be parsed is refused (ADR-0005 V7).
      try {
        const stripped = stripImageMetadata(body)
        await this.storage.put(doc.storageKey, stripped.body, stripped.mime, bucket)
        if ((await this.storage.encryptionOf(doc.storageKey, bucket)) !== "AES256") throw new Error("identity bucket did not confirm server-side encryption")
        body = stripped.body
        finalSha = createHash("sha256").update(body).digest("hex")
        engine += "; metadata stripped"
      } catch (err) {
        if (!(err instanceof UnsupportedImageError)) throw err
        clean = false
        engine += `; ${err.message}`
      }
    }
    await this.db.update(documents).set({ scanStatus: clean ? "CLEAN" : "INFECTED", sha256: finalSha, size: body.length }).where(eq(documents.id, documentId))
    if (!clean) await this.storage.delete(doc.storageKey, bucket).catch(() => undefined)
    this.log.log({ documentId, clean, engine }, "document scanned")
    return { clean, engine }
  }

  async get(id: string) {
    const [d] = await this.db.select().from(documents).where(eq(documents.id, id))
    return d
  }

  async forRequest(requestType: "FLIGHT" | "CARGO" | "AFTER_SALES" | "SERVICE", requestId: string, customerView: boolean) {
    const rows = await this.db.select().from(documents).where(and(eq(documents.requestType, requestType), eq(documents.requestId, requestId)))
    return rows.filter((d) => d.scanStatus === "CLEAN" && d.uploadCompletedAt && (!customerView || d.visibility === "CUSTOMER" || d.ownerUserId === d.createdBy))
  }

  async attach(tx: DbOrTx, ids: string[], requestType: "FLIGHT" | "CARGO" | "AFTER_SALES" | "SERVICE", requestId: string, userId: string) {
    if (!ids.length) return
    const rows = await tx.select().from(documents).where(inArray(documents.id, ids))
    if (rows.length !== ids.length || rows.some((r) => r.createdBy !== userId && r.ownerUserId !== userId)) throw new AppError("NOT_FOUND", "Document not found")
    await tx.update(documents).set({ requestType, requestId }).where(inArray(documents.id, ids))
  }

  /**
   * A document staff hand to a request (message attachment, ticket receipt, payment evidence) must already belong to
   * that request, to its customer, or be an unattached upload by the same staff member. Identity scans never move.
   * Anything else answers 404, so an id copied from another customer's file cannot be re-owned or published.
   */
  async claimForRequest(tx: DbOrTx, id: string, scope: { requestType: "FLIGHT" | "CARGO" | "AFTER_SALES" | "SERVICE"; requestId: string; customerUserId: string; staffUserId: string }) {
    const [d] = await tx.select().from(documents).where(eq(documents.id, id))
    const onRequest = !!d && d.requestType === scope.requestType && d.requestId === scope.requestId
    const ownUpload = !!d && d.createdBy === scope.staffUserId && !d.requestId
    const customers = !!d && d.ownerUserId === scope.customerUserId
    if (!d || d.erasedAt || isIdentityType(d.type) || !(onRequest || ownUpload || customers)) throw new AppError("NOT_FOUND", "Document not found")
    if (!d.requestId) await tx.update(documents).set({ requestType: scope.requestType, requestId: scope.requestId }).where(eq(documents.id, id))
    return d
  }

  async publish(tx: DbOrTx, id: string, scope: Parameters<DocumentsService["claimForRequest"]>[2]) {
    await this.claimForRequest(tx, id, scope)
    await tx.update(documents).set({ visibility: "CUSTOMER" }).where(eq(documents.id, id))
  }

  /** Deletes the stored object and keeps the row (and its audit trail) marked as erased. */
  async erase(tx: DbOrTx, d: typeof documents.$inferSelect) {
    await tx.update(documents).set({ erasedAt: new Date() }).where(eq(documents.id, d.id))
    await this.storage.delete(d.storageKey, this.bucketOf(d)).catch((err) => this.log.warn({ err: safeError(err), documentId: d.id }, "object delete failed"))
  }

  /** ADR-0005 V9: only when the retention setting is configured; unset (UNKNOWN) keeps scans until the customer or an account deletion erases them. */
  async purgeExpiredScans() {
    const days = this.config.settings().identityScanRetentionDays
    if (!days) return { purged: 0, retentionDays: null }
    const cutoff = new Date(Date.now() - days * 86400_000)
    const rows = await this.db.select().from(documents).where(and(inArray(documents.type, [...IDENTITY_DOCUMENT_TYPES]), isNull(documents.erasedAt), lt(documents.createdAt, cutoff)))
    for (const d of rows) await this.erase(this.db, d)
    return { purged: rows.length, retentionDays: days }
  }

  /** Written before the URL is issued, so a failed audit write means no download (ADR-0005 V8). */
  async auditStaffDownload(d: typeof documents.$inferSelect, staffUserId: string, ip: string | undefined, requestId: string) {
    await this.db.transaction((tx) => this.audit.record(tx, { actorUserId: staffUserId, actorKind: "STAFF", action: "document.downloaded", entityType: "document", entityId: d.id, contextRef: d.requestId ?? null, after: { type: d.type, ownerUserId: d.ownerUserId }, ip, requestId }))
  }

  /** Bytes of an available document for same-origin inline viewing by staff (the console CSP only allows blob: images). */
  async readBytes(d: typeof documents.$inferSelect) {
    if (d.erasedAt) throw new AppError("NOT_FOUND")
    if (d.scanStatus !== "CLEAN") throw new AppError("VALIDATION_FAILED", "The file is not available")
    return this.storage.get(d.storageKey, this.bucketOf(d))
  }

  async downloadUrl(d: typeof documents.$inferSelect) {
    if (d.erasedAt) throw new AppError("NOT_FOUND")
    if (d.scanStatus !== "CLEAN") throw new AppError("VALIDATION_FAILED", d.scanStatus === "PENDING" ? "The file is still being checked" : "The file failed the virus check")
    return { url: await this.storage.presignGet(d.storageKey, d.filename, 300, this.bucketOf(d)), expiresInSeconds: 300 }
  }
}
