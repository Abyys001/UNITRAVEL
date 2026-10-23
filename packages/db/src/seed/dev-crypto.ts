import { createCipheriv, createHash, randomBytes } from "node:crypto"

/**
 * Local-only mirror of the API's envelope encryption, used to seed demo staff with a known TOTP secret so the
 * developer workflow and end-to-end tests can sign in. Refuses to run outside APP_ENV=local.
 */
const DEV_MASTER = "dev-master-key-not-for-production-use-0000"

function gcm(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([c.update(plaintext), c.final()])
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".")
}

export function devEncrypt(plaintext: string): string {
  if ((process.env.APP_ENV ?? "local") !== "local" || process.env.MASTER_ENCRYPTION_KEY) throw new Error("devEncrypt is for local seeding only")
  const master = createHash("sha256").update(DEV_MASTER).digest()
  const dataKey = randomBytes(32)
  return `v1:${gcm(master, dataKey)}:${gcm(dataKey, Buffer.from(plaintext, "utf8"))}`
}

/** Base32 "KVXGSVDSMF3GK3CEMVWW6VCPKRIDEMBSGY" — documented in docs/LOCAL-DEV.md; local demo data only. */
export const DEMO_TOTP_SECRET_HEX = Buffer.from("UniTravelDemoTOTP2026").toString("hex")
