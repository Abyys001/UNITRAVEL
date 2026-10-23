import { Redis } from "ioredis"
import { Client } from "pg"

/** Local e2e runs start from clean rate-limit windows (the limits themselves are covered by the tests). */
export default async function setup() {
  const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6390")
  for (const pattern of ["rl:*", "pow:*", "mfa:totp:*"]) {
    const keys = await r.keys(pattern)
    if (keys.length) await r.del(...keys)
  }
  r.disconnect()
  // Demo staff sign in on every run; clear their previous challenges so the resend cooldown starts fresh.
  const c = new Client({ connectionString: process.env.DATABASE_MIGRATE_URL ?? "postgres://unitravel:unitravel@localhost:5462/unitravel" })
  await c.connect()
  await c.query("delete from otp_challenges where identity_value like '+447700900%'")
  await c.end()
}
