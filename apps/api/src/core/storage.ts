import { gzipSync } from "node:zlib"

import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutBucketCorsCommand, PutBucketEncryptionCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common"

import { env } from "./env"

/** S3-compatible object storage (RustFS locally, an EU bucket in production); access only via short-lived URLs. */
@Injectable()
export class ObjectStorage implements OnModuleInit {
  private readonly log = new Logger("Storage")
  private readonly client: S3Client
  private readonly publicClient: S3Client
  readonly bucket = env().OBJECT_STORAGE_BUCKET
  readonly callsBucket = `${env().OBJECT_STORAGE_BUCKET}-calls`
  /** Identity scans: separate bucket, SSE-S3 requested on every write (ADR-0005 V6). */
  readonly identityBucket = `${env().OBJECT_STORAGE_BUCKET}-identity`

  constructor() {
    const base = { region: env().OBJECT_STORAGE_REGION, forcePathStyle: true, credentials: { accessKeyId: env().OBJECT_STORAGE_ACCESS_KEY, secretAccessKey: env().OBJECT_STORAGE_SECRET_KEY } }
    this.client = new S3Client({ ...base, endpoint: env().OBJECT_STORAGE_ENDPOINT })
    // Pre-signed URLs must use the host the browser can reach.
    this.publicClient = new S3Client({ ...base, endpoint: env().OBJECT_STORAGE_PUBLIC_ENDPOINT ?? env().OBJECT_STORAGE_ENDPOINT })
  }

  async onModuleInit() {
    for (const b of [this.bucket, this.callsBucket]) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: b }))
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: b })).catch((err) => this.log.warn({ err: String(err), bucket: b }, "bucket create failed"))
      }
    }
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.identityBucket }))
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.identityBucket })).catch((err) => this.log.warn({ err: String(err), bucket: this.identityBucket }, "bucket create failed"))
    }
    // Browsers PUT straight to the store with pre-signed URLs, so the store must allow our origins and the SSE header cross-origin.
    const origins = [env().PUBLIC_WEB_URL, env().PUBLIC_MOBILE_WEB_URL, env().PUBLIC_CONSOLE_ADMIN_URL].map((u) => new URL(u).origin)
    for (const b of [this.bucket, this.identityBucket]) {
      await this.client.send(new PutBucketCorsCommand({ Bucket: b, CORSConfiguration: { CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ["PUT"], AllowedHeaders: ["content-type", "x-amz-server-side-encryption"], MaxAgeSeconds: 600 }] } }))
        .catch((err) => this.log.warn({ err: String(err), bucket: b }, "bucket CORS not set; browser uploads will fail"))
    }
    // Default encryption as a second line behind the per-request header; a store that cannot do it fails writes loudly, never silently.
    await this.client.send(new PutBucketEncryptionCommand({ Bucket: this.identityBucket, ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] } }))
      .catch((err) => this.log.warn({ err: String(err), bucket: this.identityBucket }, "bucket default encryption not set"))
  }

  private sse(bucket: string) {
    return bucket === this.identityBucket ? { ServerSideEncryption: "AES256" as const } : {}
  }

  /** The store's own statement of how the object is encrypted at rest (undefined when it is not). */
  async encryptionOf(key: string, bucket: string): Promise<string | undefined> {
    return (await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).ServerSideEncryption
  }

  /**
   * Upload URL for exactly `size` bytes of `contentType`: both headers are signed, so the store refuses a different type
   * or a larger body (the 10 MB limit is enforced by the signature, not by the client's honesty).
   */
  presignPut(key: string, contentType: string, size: number, expiresIn = 300, bucket = this.bucket) {
    return getSignedUrl(this.publicClient, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: size, ...this.sse(bucket) }), { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) }).then((url) => ({ url, size }))
  }

  /** Stored size in bytes, or undefined when the object does not exist. */
  async sizeOf(key: string, bucket = this.bucket): Promise<number | undefined> {
    try {
      return (await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).ContentLength
    } catch {
      return undefined
    }
  }

  /** 5-minute download URLs with Content-Disposition: attachment (ch. 28.3, 28.1 malicious uploads). */
  presignGet(key: string, filename: string, expiresIn = 300, bucket = this.bucket) {
    return getSignedUrl(this.publicClient, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"` }), { expiresIn })
  }

  async get(key: string, bucket = this.bucket): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return Buffer.from(await r.Body!.transformToByteArray())
  }

  async put(key: string, body: Buffer, contentType: string, bucket = this.bucket) {
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ...this.sse(bucket) }))
  }

  async delete(key: string, bucket = this.bucket) {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  }

  /** Supplier call payloads: compressed, personal data removed, 14-day retention by the maintenance job. */
  async putCallPayload(key: string, payload: unknown) {
    await this.put(key, gzipSync(Buffer.from(JSON.stringify(payload))), "application/gzip", this.callsBucket).catch((err) => this.log.warn({ err: String(err) }, "call payload not stored"))
  }
}
