// Shared helpers for the smoke test: direct API calls (staff-side setup) and TOTP.
import crypto from 'node:crypto'
import http from 'node:http'

export const API = process.env.API_URL ?? 'http://localhost:4100'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function b32decode(s) {
  let bits = ''
  for (const c of s.replace(/=+$/, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0')
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
export function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)))
  const h = crypto.createHmac('sha1', b32decode(secret)).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 1_000_000).padStart(6, '0')
}

/** http.request wrapper so we can set the Host header (the dev routes are host-scoped). */
export function call(method, path, { token, cookies, body, host, headers = {} } = {}) {
  const url = new URL(API + path)
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request(
      {
        method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
        headers: {
          'content-type': 'application/json', 'x-device-id': 'e2e-device-0001', 'x-client-platform': 'web',
          ...(token ? { authorization: `Bearer ${token}` } : {}), ...(host ? { host } : {}),
          ...(cookies ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '), 'x-csrf-token': cookies.ut_csrf ?? '' } : {}),
          ...headers,
          ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let buf = ''
        res.on('data', (c) => (buf += c))
        res.on('end', () => {
          let json
          try { json = buf ? JSON.parse(buf) : undefined } catch { json = buf }
          resolve({ status: res.statusCode, json, headers: res.headers })
        })
      },
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function latestCode(phone, since = 0) {
  for (let i = 0; i < 20; i++) {
    const { json } = await call('GET', '/v1/dev-sink/sms')
    const hit = (json ?? []).find((m) => m.to === phone && Date.parse(m.at) >= since)
    if (hit) return /(\d{6})/.exec(hit.body)[1]
    await sleep(300)
  }
  throw new Error('no OTP for ' + phone)
}

function solvePow(c) {
  for (let n = 0; n <= c.maxnumber; n++) {
    if (crypto.createHash('sha256').update(c.salt + n).digest('hex') === c.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature })).toString('base64')
    }
  }
  throw new Error('pow unsolved')
}

function cookiesOf(headers) {
  const out = {}
  for (const c of headers['set-cookie'] ?? []) {
    const [kv] = c.split(';')
    const [k, ...v] = kv.split('=')
    out[k.trim()] = v.join('=')
  }
  return out
}

/**
 * Full OTP sign-in via the API. `client: 'CONSOLE'` is needed for the Developer Panel routes
 * (their tokens carry the console audience); those come back as cookies, whose access value is
 * used as a bearer token. Honours the OTP cooldown (429 + retryAfter) by waiting.
 */
export async function signIn(phone, { totpSecret, client = 'MOBILE', log = () => {} } = {}) {
  const body = { channel: 'PHONE', value: phone, deviceId: 'e2e-device-0001', client }
  let challenge
  let r
  for (let attempt = 0; attempt < 6; attempt++) {
    const since = Date.now() - 1500
    r = await call('POST', '/v1/auth/otp/request', { body: { ...body, ...(challenge ? { challenge } : {}) } })
    if (r.status === 428) { challenge = solvePow(r.json.challenge); continue }
    if (r.status === 429) {
      const wait = (r.json.retryAfter ?? 60) + 2
      log(`OTP cooldown for ${phone}: waiting ${wait}s`)
      await sleep(wait * 1000)
      continue
    }
    if (r.status !== 202) throw new Error('otp request failed ' + JSON.stringify(r.json))
    const code = await latestCode(r.json.normalised, since)
    const v = await call('POST', '/v1/auth/otp/verify', {
      body: { challengeId: r.json.challengeId, code, deviceId: 'e2e-device-0001', client, profile: { givenNamesLatin: 'Demo', surnameLatin: 'User' } },
    })
    if (v.status !== 200) throw new Error('verify failed ' + JSON.stringify(v.json))
    const token = v.json.tokens?.accessToken
    const cookies = token ? undefined : cookiesOf(v.headers)
    if (totpSecret) {
      const m = await call('POST', '/v1/auth/mfa/totp/verify', { token, cookies, body: { type: 'TOTP', code: totp(totpSecret) } })
      if (m.status >= 300) throw new Error('mfa failed ' + JSON.stringify(m.json))
    }
    return { token, cookies, verify: v.json }
  }
  throw new Error('could not get an OTP for ' + phone)
}

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SESSION_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.owner-session.json')

/**
 * Owner session for the Developer Panel (console audience, cookie based). The refresh cookie is cached on
 * disk (git-ignored) so repeated runs do not trip the per-number OTP cooldown.
 */
export async function ownerSession({ phone = '+447700900001', totpSecret, log = () => {} } = {}) {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
      const r = await call('POST', '/v1/auth/refresh', { cookies: saved, body: {} })
      if (r.status === 200) {
        const fresh = { ...saved, ...cookiesOf(r.headers) }
        const m = await call('POST', '/v1/auth/mfa/totp/verify', { cookies: fresh, body: { type: 'TOTP', code: totp(totpSecret) } })
        if (m.status < 300) {
          fs.writeFileSync(SESSION_FILE, JSON.stringify(fresh))
          return fresh
        }
      }
    } catch { /* fall through to a fresh sign-in */ }
  }
  const s = await signIn(phone, { client: 'CONSOLE', totpSecret, log })
  fs.writeFileSync(SESSION_FILE, JSON.stringify(s.cookies))
  return s.cookies
}
