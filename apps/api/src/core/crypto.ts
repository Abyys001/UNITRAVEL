import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { env, isLocal } from "./env"

// Local development falls back to fixed, clearly non-secret keys; production refuses to start without real ones.
const DEV_MASTER = "dev-master-key-not-for-production-use-0000"
const DEV_PEPPER = "dev-otp-pepper-not-for-production"

function masterKey(): Buffer {
  const raw = env().MASTER_ENCRYPTION_KEY ?? (isLocal() ? DEV_MASTER : undefined)
  if (!raw) throw new Error("MASTER_ENCRYPTION_KEY missing")
  return createHash("sha256").update(raw).digest()
}

export const MASTER_KEY_ID = "mk1"

function gcmEncrypt(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".")
}

function gcmDecrypt(key: Buffer, token: string): Buffer {
  const [iv, tag, ct] = token.split(".").map((p) => Buffer.from(p, "base64url"))
  if (!iv || !tag || !ct) throw new Error("Malformed ciphertext")
  const d = createDecipheriv("aes-256-gcm", key, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()])
}

/**
 * Envelope encryption (ch. 28.2): a random data key encrypts the value; the master key (never in the database)
 * encrypts the data key. Output: "v1:<wrapped data key>:<ciphertext>".
 */
export function encryptField(plaintext: string): { ciphertext: string; keyId: string } {
  const dataKey = randomBytes(32)
  const wrapped = gcmEncrypt(masterKey(), dataKey)
  return { ciphertext: `v1:${wrapped}:${gcmEncrypt(dataKey, Buffer.from(plaintext, "utf8"))}`, keyId: MASTER_KEY_ID }
}

export function decryptField(ciphertext: string): string {
  const [v, wrapped, body] = ciphertext.split(":")
  if (v !== "v1" || !wrapped || !body) throw new Error("Unsupported ciphertext version")
  const dataKey = gcmDecrypt(masterKey(), wrapped)
  return gcmDecrypt(dataKey, body).toString("utf8")
}

/** OTP codes are stored as HMAC-SHA-256(code, pepper) — never in clear (ch. 25.1). */
export function otpHash(code: string, challengeId: string): string {
  const pepper = env().OTP_PEPPER ?? (isLocal() ? DEV_PEPPER : undefined)
  if (!pepper) throw new Error("OTP_PEPPER missing")
  return createHmac("sha256", pepper).update(`${challengeId}:${code}`).digest("hex")
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex")
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

/** Cryptographically random numeric code (ch. 25.1). */
export function randomDigits(length: number): string {
  let out = ""
  while (out.length < length) {
    const b = randomBytes(1)[0]!
    if (b < 250) out += String(b % 10)
  }
  return out
}

export function hmacSign(value: string, purpose: string): string {
  return createHmac("sha256", masterKey()).update(`${purpose}:${value}`).digest("base64url")
}

/** Keyed hash (hex, 64 chars) that binds a confirmation or a decision to exact values; unlike a plain hash it cannot be brute-forced from the database alone. */
export function keyedHash(value: string, purpose: string): string {
  return createHmac("sha256", masterKey()).update(`${purpose}:${value}`).digest("hex")
}
