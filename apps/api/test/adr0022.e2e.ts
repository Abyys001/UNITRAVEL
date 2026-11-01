import { randomUUID } from "node:crypto"

import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, DEV_HOST, Session } from "./client"

const ORIGIN = `http://${ADMIN_HOST}`
const device = { origin: ORIGIN, "x-ut-device": "1" }
const db = new Client({ connectionString: process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL ?? "postgres://unitravel:unitravel@localhost:5462/unitravel" })

const signedIn = async (email = "sara@unitravel.example", host = ADMIN_HOST) => {
  const s = new Session("CONSOLE", host)
  const r = await s.post("/v1/auth/test-sign-in", { email, deviceId: s.deviceId, client: "CONSOLE" })
  expect(r.status).toBe(200)
  expect(s.cookies.get("ut_dt")).toBeTruthy()
  return s
}
const sid = async (s: Session) => (await s.get<{ id: string; current: boolean }[]>("/v1/me/sessions")).body.find((x) => x.current)!.id
const age = (id: string, minutes: number) => db.query(`UPDATE sessions SET last_seen_at = now() - make_interval(mins => $1) WHERE id = $2`, [minutes, id])
const dropCaches = async (id: string) => { const { Redis } = await import("ioredis"); const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6390"); await r.del(`sess:${id}:meta`, `sess:${id}:touch`); r.disconnect() }
const expireAccess = (s: Session) => s.cookies.delete("ut_at")
const resume = (s: Session, extra: Record<string, string> = device) => s.post("/v1/auth/device/resume", {}, extra)

describe("ADR-0022 session limits and remembered devices", () => {
  beforeAll(() => db.connect())
  afterAll(() => db.end())

  it("the remembered-device cookie is HttpOnly, SameSite=Strict and scoped to the device routes", async () => {
    const s = new Session("CONSOLE", ADMIN_HOST)
    const r = await s.post("/v1/auth/test-sign-in", { email: "sara@unitravel.example", deviceId: s.deviceId, client: "CONSOLE" })
    const c = r.headers.getSetCookie().find((x) => x.startsWith("ut_dt="))!
    expect(c).toMatch(/HttpOnly/)
    expect(c).toMatch(/SameSite=Strict/)
    expect(c).toMatch(/Path=\/api\/v1\/auth\/device/)
    expect(c).not.toMatch(/Domain=/)
  })

  it("no device is remembered before the second factor, nor for website or mobile sessions", async () => {
    const web = new Session("WEB")
    await web.post("/v1/auth/test-sign-in", { email: `e2e-${randomUUID()}@test.example`, deviceId: web.deviceId, client: "WEB" })
    expect(web.cookies.get("ut_dt")).toBeUndefined()
    const off = new Session("CONSOLE")
    await off.post("/v1/auth/test-sign-in", { email: "sara@unitravel.example", deviceId: off.deviceId, client: "CONSOLE" })
    expect(off.cookies.get("ut_dt")).toBeUndefined()
  })

  it("31 minutes idle ends the session, through the guard and through refresh", async () => {
    const a = await signedIn()
    const idA = await sid(a)
    await age(idA, 31); await dropCaches(idA)
    expect((await a.get("/v1/me")).status).toBe(401)

    const b = await signedIn()
    const idB = await sid(b)
    await age(idB, 31); await dropCaches(idB)
    expireAccess(b)
    expect((await b.post("/v1/auth/refresh", {})).status).toBe(401)
    expect((await db.query("SELECT revoked_reason FROM sessions WHERE id = $1", [idB])).rows[0].revoked_reason).toBe("IDLE_TIMEOUT")
  })

  it("background requests and refresh do not extend an idle session; real requests do", async () => {
    const s = await signedIn()
    const id = await sid(s)
    const seen = async () => (await db.query("SELECT last_seen_at FROM sessions WHERE id = $1", [id])).rows[0].last_seen_at as Date
    await age(id, 20); await dropCaches(id)
    const before = await seen()
    expect((await s.get("/v1/me", { "x-ut-background": "1" })).status).toBe(200)
    expect((await s.post("/v1/auth/refresh", {})).status).toBe(200)
    expect(await seen()).toEqual(before)
    await dropCaches(id)
    expect((await s.post("/v1/auth/activity", {})).status).toBe(204)
    expect((await seen()).getTime()).toBeGreaterThan(before.getTime())
  })

  it("the 12-hour cap applies even to an active session", async () => {
    const s = await signedIn()
    const id = await sid(s)
    const hours = (await db.query("SELECT extract(epoch from absolute_expires_at - created_at) / 3600 AS h FROM sessions WHERE id = $1", [id])).rows[0].h
    expect(Math.round(Number(hours))).toBe(12)
    await db.query("UPDATE sessions SET absolute_expires_at = now() - interval '1 second' WHERE id = $1", [id]); await dropCaches(id)
    expect((await s.get("/v1/me")).status).toBe(401)
    expect((await s.post("/v1/auth/refresh", {})).status).toBe(401)
  })

  it("resume opens a new session with no recent second factor, and rotates the device token", async () => {
    const s = await signedIn()
    const id = await sid(s)
    const firstToken = s.cookies.get("ut_dt")
    await age(id, 31); await dropCaches(id)
    expect((await s.get("/v1/me")).status).toBe(401)
    const r = await resume(s)
    expect(r.status).toBe(200)
    expect(s.cookies.get("ut_dt")).not.toBe(firstToken)
    const me = await s.get("/v1/me")
    expect(me.status).toBe(200)
    const next = await sid(s)
    expect(next).not.toBe(id)
    const row = (await db.query("SELECT mfa_level, mfa_verified_at FROM sessions WHERE id = $1", [next])).rows[0]
    expect(row).toEqual({ mfa_level: 1, mfa_verified_at: null })
    // A staff route works, a step-up route asks for the second factor again.
    expect((await s.get("/v1/admin/queues/summary")).status).toBe(200)
    const owner = await signedIn("owner@unitravel.example", DEV_HOST)
    const ownerId = await sid(owner)
    await age(ownerId, 31); await dropCaches(ownerId)
    expect((await resume(owner, { origin: `http://${DEV_HOST}`, "x-ut-device": "1" })).status).toBe(200)
    expect((await owner.post("/v1/dev/audit-log/export", {})).body.code).toBe("STEP_UP_REQUIRED")
  })

  it("refuses resume without the header, from another origin, or on the other console host", async () => {
    const s = await signedIn()
    expect((await resume(s, { "x-ut-device": "1" })).status).toBe(401)
    const t = await signedIn()
    expect((await resume(t, { origin: ORIGIN })).status).toBe(401)
    const u = await signedIn()
    expect((await resume(u, { origin: "https://evil.example", "x-ut-device": "1" })).status).toBe(401)
    const v = await signedIn()
    const onDev = new Session("CONSOLE", DEV_HOST)
    onDev.cookies.set("ut_dt", v.cookies.get("ut_dt")!)
    expect((await resume(onDev, { origin: `http://${DEV_HOST}`, "x-ut-device": "1" })).status).toBe(401)
    expect((await resume(v)).status).toBe(200) // A wrong host does not burn the real device.
  })

  it("the old token inside the grace gets a session without a new token; later or elsewhere it revokes the device", async () => {
    const s = await signedIn()
    const old = s.cookies.get("ut_dt")!
    expect((await resume(s)).status).toBe(200)
    const current = s.cookies.get("ut_dt")!
    const twin = new Session("CONSOLE", ADMIN_HOST)
    // Same client as the rotation.
    Object.defineProperty(twin, "ip", { value: s.ip })
    twin.cookies.set("ut_dt", old)
    expect((await resume(twin)).status).toBe(200)
    expect(twin.cookies.get("ut_dt")).toBe(old)

    const thief = new Session("CONSOLE", ADMIN_HOST)
    thief.cookies.set("ut_dt", old)
    expect((await resume(thief, { ...device, "user-agent": "thief/1.0" })).status).toBe(401)
    expect((await s.get("/v1/me")).status).toBe(401)
    s.cookies.set("ut_dt", current)
    expect((await resume(s)).status).toBe(401)
  })

  it("sign-out, revoking and suspension all stop resume", async () => {
    const out = await signedIn()
    const token = out.cookies.get("ut_dt")!
    expect((await out.post("/v1/auth/logout", {})).status).toBe(204)
    expect(out.cookies.get("ut_dt")).toBeUndefined()
    out.cookies.set("ut_dt", token)
    expect((await resume(out)).status).toBe(401)

    const late = await signedIn()
    const lateId = await sid(late)
    const lateToken = late.cookies.get("ut_dt")!
    await age(lateId, 31); await dropCaches(lateId)
    expect((await late.get("/v1/me")).status).toBe(401)
    expect((await late.post("/v1/auth/device/forget", {}, device)).status).toBe(204)
    late.cookies.set("ut_dt", lateToken)
    expect((await resume(late)).status).toBe(401)

    const viaList = await signedIn()
    const other = await signedIn()
    const list = (await viaList.get<{ id: string; current: boolean }[]>("/v1/me/trusted-devices")).body
    const mine = list.find((d) => d.current)!
    expect((await other.req("DELETE", `/v1/me/trusted-devices/${mine.id}`)).status).toBe(204)
    expect((await viaList.get("/v1/me")).status).toBe(401)
    expect((await resume(viaList)).status).toBe(401)
  })

  it("a suspended user, or one no longer staff, cannot resume", async () => {
    const email = "compliance@unitravel.example"
    const s = await signedIn(email)
    const userId = (await s.get<{ id: string }>("/v1/me")).body.id
    await db.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId])
    try {
      expect((await resume(s)).status).toBe(401)
    } finally {
      await db.query("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [userId])
    }
    const t = await signedIn(email)
    const { rows } = await db.query("DELETE FROM user_roles WHERE user_id = $1 RETURNING *", [userId])
    try {
      expect((await resume(t)).status).toBe(401)
    } finally {
      for (const r of rows) await db.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [r.user_id, r.role_id])
    }
  })

  it("someone else's device cannot be seen or revoked", async () => {
    const a = await signedIn()
    const b = await signedIn("cargo@unitravel.example")
    const id = (await a.get<{ id: string; current: boolean }[]>("/v1/me/trusted-devices")).body.find((d) => d.current)!.id
    expect((await b.req("DELETE", `/v1/me/trusted-devices/${id}`)).status).toBe(404)
    expect((await b.get<{ id: string }[]>("/v1/me/trusted-devices")).body.map((d) => d.id)).not.toContain(id)
  })

  it("a lapsed device needs a full sign-in, and rotation never passes the hard cap", async () => {
    const s = await signedIn()
    const deviceId = s.cookies.get("ut_dt")!.split(".")[0]!
    await db.query("UPDATE trusted_devices SET max_expires_at = now() + interval '1 hour' WHERE id = $1", [deviceId])
    expect((await resume(s)).status).toBe(200)
    const row = (await db.query("SELECT expires_at <= max_expires_at AS capped FROM trusted_devices WHERE id = $1", [deviceId])).rows[0]
    expect(row.capped).toBe(true)
    await db.query("UPDATE trusted_devices SET expires_at = now() - interval '1 second' WHERE id = $1", [deviceId])
    expect((await resume(s)).status).toBe(401)
    expect(s.cookies.get("ut_dt")).toBeUndefined()
  })
})
