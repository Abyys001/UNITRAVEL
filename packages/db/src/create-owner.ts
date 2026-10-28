import { and, eq, isNull, sql } from "drizzle-orm"

import { createDb } from "./index"
import * as s from "./schema"

/**
 * First-owner bootstrap for a deployed host (ADR-0017), where no demo users exist and the console never creates
 * accounts. Run once, as the owner role:
 *   docker compose ... run --rm seed node dist/create-owner.js --email owner@yourdomain --name "First Last"
 * Refuses when an active owner already exists (later staff are added in the Developer Panel, which audits it).
 * The owner then signs in on the Admin Panel with an email code and enrols an authenticator on first sign-in.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const email = arg("email")?.trim().toLowerCase()
  const name = arg("name")?.trim() || email?.split("@")[0]
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error('usage: create-owner --email owner@example.com [--name "First Last"]')
    process.exit(2)
  }
  const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL ?? "postgres://unitravel:unitravel@localhost:5462/unitravel"
  const { db, pool } = createDb(url)
  try {
    const result = await db.transaction(async (tx) => {
      const [ownerRole] = await tx.select().from(s.roles).where(eq(s.roles.key, "owner"))
      if (!ownerRole) throw new Error("Roles are missing: run the seed first")
      const owners = await tx.select({ id: s.users.id }).from(s.userRoles).innerJoin(s.users, eq(s.users.id, s.userRoles.userId))
        .where(and(eq(s.userRoles.roleId, ownerRole.id), eq(s.users.status, "ACTIVE")))
      if (owners.length > 0) throw new Error("An active owner already exists; add further staff in the Developer Panel")
      const [identity] = await tx.select().from(s.userIdentities).where(and(eq(s.userIdentities.type, "EMAIL"), eq(s.userIdentities.valueNormalised, email), isNull(s.userIdentities.revokedAt)))
      let userId = identity?.userId
      if (!userId) {
        const [u] = await tx.insert(s.users).values({ displayName: name!, preferredLocale: "en", calendar: "GREGORIAN", timezone: "Europe/London" }).returning()
        userId = u!.id
        await tx.insert(s.userIdentities).values({ userId, type: "EMAIL", valueNormalised: email, verifiedAt: new Date(), isPrimary: true })
      }
      await tx.insert(s.userRoles).values({ userId, roleId: ownerRole.id }).onConflictDoNothing()
      // Any token issued before the promotion is refused on its next request (ch. 10.5).
      await tx.update(s.users).set({ permVersion: sql`${s.users.permVersion} + 1`, status: "ACTIVE" }).where(eq(s.users.id, userId))
      return { userId, created: !identity }
    })
    console.log(`owner ${result.created ? "created" : "granted"}: ${email} (${result.userId}). Sign in on the Admin Panel with an email code, then enrol an authenticator.`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

void main()
