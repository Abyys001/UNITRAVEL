import { Inject, Injectable } from "@nestjs/common"
import { and, eq } from "drizzle-orm"

import { type Db, type DbOrTx, vendorCredentials } from "@unitravel/db"

import { decryptField, encryptField } from "../../core/crypto"
import { env } from "../../core/env"
import { DB } from "../../core/infra.module"

/** Write-only credentials for SMS, push and email vendors: entered in the Developer Panel, never displayed again. */
@Injectable()
export class VendorCredentialsService {
  private cache = new Map<string, { at: number; value: Record<string, string> | null }>()

  constructor(@Inject(DB) private readonly db: Db) {}

  private envName(): "test" | "production" {
    return env().APP_ENV === "production" ? "production" : "test"
  }

  async get(vendor: string): Promise<Record<string, string> | null> {
    const hit = this.cache.get(vendor)
    if (hit && Date.now() - hit.at < 60_000) return hit.value
    const [row] = await this.db.select().from(vendorCredentials).where(and(eq(vendorCredentials.vendor, vendor), eq(vendorCredentials.environment, this.envName())))
    const value = row ? (JSON.parse(decryptField(row.ciphertext)) as Record<string, string>) : null
    this.cache.set(vendor, { at: Date.now(), value })
    return value
  }

  async set(tx: DbOrTx, vendor: string, values: Record<string, string>, actorId: string) {
    const enc = encryptField(JSON.stringify(values))
    await tx.insert(vendorCredentials).values({ vendor, environment: this.envName(), ciphertext: enc.ciphertext, keyId: enc.keyId, rotatedBy: actorId, rotatedAt: new Date() })
      .onConflictDoUpdate({ target: [vendorCredentials.vendor, vendorCredentials.environment], set: { ciphertext: enc.ciphertext, keyId: enc.keyId, rotatedBy: actorId, rotatedAt: new Date() } })
    this.cache.delete(vendor)
  }

  async meta(vendor: string) {
    const [row] = await this.db.select({ rotatedAt: vendorCredentials.rotatedAt, rotatedBy: vendorCredentials.rotatedBy }).from(vendorCredentials).where(and(eq(vendorCredentials.vendor, vendor), eq(vendorCredentials.environment, this.envName())))
    return row ?? null
  }
}
