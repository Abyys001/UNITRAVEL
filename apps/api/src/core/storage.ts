import { gzipSync } from "node:zlib"

import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
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
  }

  presignPut(key: string, contentType: string, maxBytes: number, expiresIn = 300) {
    return getSignedUrl(this.publicClient, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: undefined }), { expiresIn, signableHeaders: new Set(["content-type"]) }).then((url) => ({ url, maxBytes }))
  }

  /** 5-minute download URLs with Content-Disposition: attachment (ch. 28.3, 28.1 malicious uploads). */
  presignGet(key: string, filename: string, expiresIn = 300) {
    return getSignedUrl(this.publicClient, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"` }), { expiresIn })
  }

  async get(key: string, bucket = this.bucket): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return Buffer.from(await r.Body!.transformToByteArray())
  }

  async put(key: string, body: Buffer, contentType: string, bucket = this.bucket) {
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
  }

  async delete(key: string, bucket = this.bucket) {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  }

  /** Supplier call payloads: compressed, personal data removed, 14-day retention by the maintenance job. */
  async putCallPayload(key: string, payload: unknown) {
    await this.put(key, gzipSync(Buffer.from(JSON.stringify(payload))), "application/gzip", this.callsBucket).catch((err) => this.log.warn({ err: String(err) }, "call payload not stored"))
  }
}
