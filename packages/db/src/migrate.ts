import path from "node:path"

import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Client } from "pg"

/** Tables the application role may only INSERT into and SELECT from (ch. 23.2). */
export const IMMUTABLE_TABLES = ["offer_snapshots", "request_status_history", "compliance_decisions", "audit_log"]
/** Tables app_ro may not read: secrets and encrypted personal data. */
const SENSITIVE_TABLES = ["provider_credentials", "traveller_documents", "mfa_factors", "otp_challenges", "refresh_tokens", "sessions"]

async function main() {
  const ownerUrl = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL ?? "postgres://unitravel:unitravel@localhost:5462/unitravel"
  const client = new Client({ connectionString: ownerUrl })
  await client.connect()
  await migrate(drizzle(client), { migrationsFolder: path.join(__dirname, "..", "migrations") })

  // Role passwords come from the app/ro URLs so no secret lives in a migration file.
  for (const [role, url] of [["app_rw", process.env.DATABASE_APP_URL], ["app_ro", process.env.DATABASE_RO_URL]] as const) {
    if (url) {
      const pw = decodeURIComponent(new URL(url).password)
      await client.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${pw.replace(/'/g, "''")}'`)
    }
  }
  const { rows } = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '%\\_20%' AND tablename NOT LIKE '%\\_default'")
  await client.query("GRANT USAGE ON SCHEMA public TO app_rw, app_ro")
  for (const { tablename } of rows) {
    if (IMMUTABLE_TABLES.includes(tablename)) {
      await client.query(`REVOKE ALL ON "${tablename}" FROM app_rw; GRANT SELECT, INSERT ON "${tablename}" TO app_rw`)
    } else {
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${tablename}" TO app_rw`)
    }
    if (!SENSITIVE_TABLES.includes(tablename)) await client.query(`GRANT SELECT ON "${tablename}" TO app_ro`)
  }
  await client.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw")
  // Diagnostics show the migration status (ch. 16.2 §9).
  await client.query("GRANT USAGE ON SCHEMA drizzle TO app_rw, app_ro; GRANT SELECT ON drizzle.__drizzle_migrations TO app_rw, app_ro")
  await client.query("SELECT ensure_monthly_partitions('audit_log'); SELECT ensure_monthly_partitions('provider_calls')")
  await client.end()
  console.log("migrations applied; roles and grants refreshed")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
