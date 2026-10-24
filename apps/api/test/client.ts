import { createHmac } from "node:crypto"

export const API = process.env.API_URL ?? "http://localhost:4100"
export const DEV_HOST = "dev.localhost:4200"
export const ADMIN_HOST = "admin.localhost:4200"

/** Minimal client for end-to-end tests: bearer (mobile) or cookie jar (web/console) sessions against the real API. */
export class Session {
  cookies = new Map<string, string>()
  accessToken?: string
  refreshToken?: string
  /** Each session appears to come from its own address behind the proxy, like real users. */
  readonly ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
  constructor(readonly client: "WEB" | "CONSOLE" | "MOBILE", readonly host?: string, readonly deviceId = `e2e-${Math.random().toString(36).slice(2)}${Date.now()}`) {}

  headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", "x-device-id": this.deviceId, "x-forwarded-for": this.ip, ...extra }
    if (this.accessToken) h.authorization = `Bearer ${this.accessToken}`
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
    if (this.cookies.get("ut_csrf")) h["x-csrf-token"] = this.cookies.get("ut_csrf")!
    if (this.host) h["x-forwarded-host"] = this.host
    return h
  }

  private keepCookies(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";")
      const [k, ...v] = kv!.split("=")
      if (c.includes("Expires=Thu, 01 Jan 1970")) this.cookies.delete(k!)
      else this.cookies.set(k!, v.join("="))
    }
  }

  /** Opens a streaming GET (server-sent events) and keeps any rotated session cookies; the caller reads or cancels the body. */
  async stream(path: string, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(API + path, { headers: this.headers({ accept: "text/event-stream" }), signal })
    this.keepCookies(res)
    return res
  }

  async req<T = any>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; body: T; headers: Headers }> {
    const res = await fetch(API + path, { method, headers: this.headers(extra), body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" })
    this.keepCookies(res)
    const text = await res.text()
    let parsed: unknown = text
    try { parsed = text ? JSON.parse(text) : null } catch { /* csv or empty */ }
    return { status: res.status, body: parsed as T, headers: res.headers }
  }

  get = <T = any>(p: string, h?: Record<string, string>) => this.req<T>("GET", p, undefined, h)
  post = <T = any>(p: string, b?: unknown, h?: Record<string, string>) => this.req<T>("POST", p, b ?? {}, h)
  put = <T = any>(p: string, b?: unknown, h?: Record<string, string>) => this.req<T>("PUT", p, b ?? {}, h)
  patch = <T = any>(p: string, b?: unknown, h?: Record<string, string>) => this.req<T>("PATCH", p, b ?? {}, h)
}

export async function latestCode(to: string, since = Date.now() - 60_000): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const sink = (await (await fetch(`${API}/v1/dev-sink/sms`)).json()) as { to: string; body: string; at: string }[]
    const hit = sink.find((m) => m.to === to && /\d{6}/.test(m.body) && Date.parse(m.at) >= since)
    if (hit) return /(\d{6})/.exec(hit.body)![1]!
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`no code for ${to}`)
}

/** Solves the ALTCHA-style proof-of-work the API asks for after 3 requests per IP in 10 minutes. */
export function solvePow(c: { challenge: string; salt: string; maxnumber: number; signature: string; algorithm: string }): string {
  const { createHash } = require("node:crypto") as typeof import("node:crypto")
  for (let n = 0; n <= c.maxnumber; n++) {
    if (createHash("sha256").update(c.salt + n).digest("hex") === c.challenge) return Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature })).toString("base64")
  }
  throw new Error("pow unsolved")
}

export async function requestOtp(s: Session, value: string, extra: Record<string, unknown> = {}) {
  const body = { channel: "PHONE", value, deviceId: s.deviceId, client: s.client, ...extra }
  let r = await s.post("/v1/auth/otp/request", body)
  if (r.status === 428 && r.body.challenge) r = await s.post("/v1/auth/otp/request", { ...body, challenge: solvePow(r.body.challenge) })
  return r
}

export async function signIn(s: Session, phone: string, profile?: { givenNamesLatin: string; surnameLatin: string }) {
  const since = Date.now() - 1000
  const r = await requestOtp(s, phone)
  if (r.status !== 202) throw new Error(`otp request ${r.status} ${JSON.stringify(r.body)}`)
  const code = await latestCode(r.body.normalised, since)
  const v = await s.post("/v1/auth/otp/verify", { challengeId: r.body.challengeId, code, deviceId: s.deviceId, client: s.client, profile })
  if (v.status !== 200) throw new Error(`verify ${v.status} ${JSON.stringify(v.body)}`)
  if (v.body.tokens) { s.accessToken = v.body.tokens.accessToken; s.refreshToken = v.body.tokens.refreshToken }
  return v.body
}

function base32Decode(str: string): Buffer {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = 0, value = 0
  const out: number[] = []
  for (const c of str) { value = (value << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 } }
  return Buffer.from(out)
}
export function totp(secretB32: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)))
  const h = createHmac("sha1", base32Decode(secretB32)).update(counter).digest()
  const o = h[h.length - 1]! & 0xf
  return String((((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, "0")
}

/** Local demo staff share this TOTP secret (docs/LOCAL-DEV.md); seeded only when APP_ENV=local. */
export const DEMO_TOTP = "KVXGSVDSMF3GK3CEMVWW6VCPKRIDEMBSGY"
export const STAFF = { owner: "+447700900001", admin: "+447700900002", cargo: "+447700900003", compliance: "+447700900004", developer: "+447700900005" }

/** Staff console session with TOTP enrolled and verified (so step-up is fresh). Secrets are cached per phone. */
const secrets = new Map<string, string>()
const staffCache = new Map<string, Session>()
export async function staffSession(phone: string, host = DEV_HOST): Promise<Session> {
  // One sign-in per staff phone per run (the OTP resend cooldown applies to staff too); hosts share the cookie jar.
  let base = staffCache.get(phone)
  if (base) {
    const r = await base.post("/v1/auth/mfa/totp/verify", { type: "TOTP", code: totp(secrets.get(phone) ?? DEMO_TOTP) })
    if (r.status !== 200 && r.body?.code !== "OTP_INVALID") base = undefined
  }
  if (!base) { base = await freshStaffSession(phone, host); staffCache.set(phone, base) }
  const view = new Session("CONSOLE", host, base.deviceId)
  view.cookies = base.cookies
  ;(view as { ip: string }).ip = base.ip
  return view
}

async function freshStaffSession(phone: string, host: string): Promise<Session> {
  const s = new Session("CONSOLE", host)
  const v = await signIn(s, phone)
  if (v.mfaEnrolmentRequired || !secrets.has(phone)) {
    if (v.mfaEnrolmentRequired) {
      const e = await s.post("/v1/auth/mfa/totp/enrol")
      secrets.set(phone, e.body.secret)
    }
  }
  const secret = secrets.get(phone) ?? DEMO_TOTP
  if (!secret) throw new Error(`no TOTP secret for ${phone}`)
  let code = totp(secret)
  let r = await s.post("/v1/auth/mfa/totp/verify", { type: "TOTP", code })
  if (r.status !== 200) { await new Promise((x) => setTimeout(x, 30_000)); code = totp(secret); r = await s.post("/v1/auth/mfa/totp/verify", { type: "TOTP", code }) }
  if (r.status !== 200) throw new Error(`totp ${r.status} ${JSON.stringify(r.body)}`)
  return s
}

/** +98 912 xxx xxxx, or a UK drama-range test number +44 7700 900100–999 (never assigned to real people). */
export const randomPhone = (prefix: "+98912" | "+4477009") =>
  prefix === "+98912" ? `+98912${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}` : `+447700900${100 + Math.floor(Math.random() * 900)}`

/**
 * Test shortcut for suites that are not about identity: marks a traveller's document VERIFIED directly in the
 * database so ticketing can proceed. The real flow (scan, confirm, review) is covered in stage8.e2e.ts.
 */
export async function markVerifiedForTest(travellerId: string) {
  const { Client } = await import("pg")
  const c = new Client({ connectionString: process.env.DATABASE_MIGRATE_URL ?? "postgres://unitravel:unitravel@localhost:5462/unitravel" })
  await c.connect()
  await c.query("update traveller_documents set verification_status = 'VERIFIED', verified_at = now() where traveller_id = $1 and erased_at is null", [travellerId])
  await c.end()
}

/** Reads one value from the database for assertions the API deliberately does not expose. */
export async function dbQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { Client } = await import("pg")
  const c = new Client({ connectionString: process.env.DATABASE_MIGRATE_URL ?? "postgres://unitravel:unitravel@localhost:5462/unitravel" })
  await c.connect()
  try { return (await c.query(sql, params)).rows as T[] } finally { await c.end() }
}

/** Mirrors what AccessService does after a role change made outside the API (tests assign roles in SQL). */
export async function refreshPermCache(userId: string) {
  const { Redis } = await import("ioredis")
  const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6390")
  const [u] = await dbQuery<{ perm_version: number }>("select perm_version from users where id = $1", [userId])
  await r.set(`perm:${userId}`, String(u!.perm_version))
  r.disconnect()
}
