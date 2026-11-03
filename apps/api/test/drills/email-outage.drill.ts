import { spawn } from "node:child_process"
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { dbQuery, randomPhone, Session, signIn } from "../client"

/**
 * Email outage drill (not part of unit or e2e runs): `pnpm --filter @unitravel/api drill:email`.
 * With the email provider down the notification delivery is retried by the queue (notify.email: 5 attempts, exponential
 * backoff from 2 s) and, once the provider is back, sent exactly once. Runs against an ISOLATED stack only:
 *   DRILL_ENV_FILE  env file of that stack's API/worker (never printed)
 *   DRILL_RUN_DIR   directory holding worker.pid and worker.log for that stack
 *   API_URL, DATABASE_MIGRATE_URL, REDIS_URL  point at the same isolated stack
 *   MAILPIT_URL     the mail sink the stack sends to (read only here)
 * Only the worker is restarted; the SMTP override is a command-line environment value, no file is changed.
 */
const ENV_FILE = process.env.DRILL_ENV_FILE
const RUN_DIR = process.env.DRILL_RUN_DIR
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8035"
const DEAD_SMTP = "smtp://127.0.0.1:1"
const apiDir = resolve(__dirname, "../..")

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function startWorker(env: Record<string, string>) {
  const log = openSync(`${RUN_DIR}/worker.log`, "a")
  const child = spawn("node", [`--env-file=${ENV_FILE}`, "dist/main.worker.js"], { cwd: apiDir, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", log, log] })
  child.unref()
  closeSync(log)
  writeFileSync(`${RUN_DIR}/worker.pid`, String(child.pid))
}

async function stopWorker() {
  const pid = Number(readFileSync(`${RUN_DIR}/worker.pid`, "utf8"))
  try { process.kill(pid, "SIGTERM") } catch { return }
  for (let i = 0; i < 50; i++) {
    try { process.kill(pid, 0) } catch { return }
    await wait(200)
  }
  throw new Error(`worker ${pid} did not stop`)
}

async function mailTo(to: string) {
  const r = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages?: { Subject: string }[] }
  return r.messages ?? []
}

describe.skipIf(!ENV_FILE || !RUN_DIR)("email outage drill", () => {
  it("retries a failing email delivery and sends it once when the provider is back", async () => {
    const phone = randomPhone("+4477009")
    const email = `drill-outage-${Date.now().toString(36)}@student.example`
    const t0 = Date.now()
    const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`
    const trace: string[] = []

    // A returning customer with a verified email: a sign-in from a new device raises security.new_sign_in (critical, EMAIL).
    await signIn(new Session("WEB"), phone, { givenNamesLatin: "Drill", surnameLatin: "Outage" })
    const [u] = await dbQuery<{ user_id: string }>("select user_id from user_identities where type = 'PHONE' and value_normalised = $1", [phone])
    await dbQuery("insert into user_identities (id, user_id, type, value_normalised, verified_at) values (gen_random_uuid(), $1, 'EMAIL', $2, now())", [u!.user_id, email])

    await stopWorker()
    startWorker({ SMTP_URL: DEAD_SMTP })
    try {
      trace.push(`${at()} worker restarted with SMTP_URL=${DEAD_SMTP}`)
      await wait(6_000)
      expect(await mailTo(email)).toHaveLength(0)

      await dbQuery("delete from otp_challenges where identity_value = $1", [phone]) // the resend cooldown is per identity
      await signIn(new Session("WEB"), phone)
      trace.push(`${at()} second sign-in (new device) done`)

      const delivery = async () => (await dbQuery<{ status: string; attempts: number; error: string | null }>(
        "select d.status, d.attempts, d.error from notification_deliveries d join notifications n on n.id = d.notification_id where n.user_id = $1 and d.channel = 'EMAIL' and n.event_type = 'security.new_sign_in'", [u!.user_id]))[0]
      let last = -1
      let row = await delivery()
      for (let i = 0; i < 160 && (row?.attempts ?? 0) < 2; i++) {
        await wait(250)
        row = await delivery()
        if (row && row.attempts !== last) { last = row.attempts; trace.push(`${at()} attempts=${row.attempts} status=${row.status} error=${(row.error ?? "").slice(0, 80)}`) }
      }
      expect(row?.attempts, "at least two failed attempts while the provider is down").toBeGreaterThanOrEqual(2)
      expect(row?.status).toBe("FAILED")
      expect(await mailTo(email)).toHaveLength(0)

      await stopWorker()
      startWorker({})
      trace.push(`${at()} worker restarted with the normal SMTP_URL`)

      for (let i = 0; i < 160 && row?.status !== "SENT"; i++) {
        await wait(250)
        const next = await delivery()
        if (next && (next.attempts !== last || next.status !== row?.status)) { last = next.attempts; trace.push(`${at()} attempts=${next.attempts} status=${next.status}`) }
        row = next
      }
      expect(row?.status).toBe("SENT")
      await wait(10_000) // a duplicate, if there were one, would arrive within the remaining backoff window
      const sent = await mailTo(email)
      trace.push(`${at()} mailpit messages to ${email}: ${sent.length} (${sent.map((m) => m.Subject).join(" | ")})`)
      console.log(trace.join("\n"))
      expect(sent).toHaveLength(1)
      expect((await delivery())?.status).toBe("SENT")
    } finally {
      // Whatever happened, leave the stack with a worker on its normal SMTP configuration.
      await stopWorker()
      startWorker({})
    }
  }, 180_000)
})
