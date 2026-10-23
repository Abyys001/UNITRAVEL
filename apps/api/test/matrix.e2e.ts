import { type BuiltInRole, DEFAULT_ROLE_PERMISSIONS, type Permission } from "@unitravel/contracts"
import { beforeAll, describe, expect, it } from "vitest"

import { API_CONTROLLERS } from "../src/app.module"
import { enumerateRoutes } from "../src/core/http/route-table"
import { BUSINESS_CONTROLLERS } from "../src/modules/business.module"
import { ADMIN_HOST, DEV_HOST, Session, signIn, STAFF, staffSession } from "./client"

/**
 * Permission matrix (ch. 32.3): for every permission-guarded route and every built-in role, the API answers 403
 * when the role lacks the permission and something other than 401/403 when it holds it; Developer Panel routes
 * answer 404 off the dev host. Ids are random UUIDs and bodies empty, so nothing is mutated — permitted calls end
 * in 400/404/409/428, never in a write. Routes without a path parameter that mutate are excluded for that reason.
 */
const ZERO = "00000000-0000-4000-8000-000000000000"
const routes = enumerateRoutes([...API_CONTROLLERS, ...BUSINESS_CONTROLLERS])
  .filter((r) => r.permissions.length && (r.method === "GET" || r.path.includes(":")))
  .map((r) => ({ ...r, url: r.path.replace(/:ref\b/g, "UT-F-000000").replace(/:\w+/g, ZERO) }))

/** Business rules enforced in the handler on top of the permission (each documented at its route). */
const ROLE_RULES: Record<string, string> = { "POST /v1/admin/compliance/policies/:id/approve": "owner" }

/** Server-sent event streams stay open; only the status line matters here. */
const STREAMS = new Set(["/v1/admin/events"])

async function call(s: Session, method: string, url: string) {
  if (STREAMS.has(url)) {
    const res = await s.stream(url)
    await res.body?.cancel()
    return res.status
  }
  return (await s.req(method, url, method === "GET" || method === "DELETE" ? undefined : {})).status
}

describe("permission matrix", () => {
  it("covers a meaningful share of the route table", () => expect(routes.length).toBeGreaterThan(60))

  it("anonymous callers get 401 on every guarded route", async () => {
    const anon = new Session("WEB")
    const wrong = []
    for (const r of routes) { const st = await call(anon, r.method, r.url); if (st !== 401) wrong.push(`${r.method} ${r.path} → ${st}`) }
    expect(wrong).toEqual([])
  })

  it("a customer gets 403 (or 404 for Developer Panel routes) on every staff route", async () => {
    const c = new Session("WEB")
    await signIn(c, "+447700900010")
    const wrong = []
    for (const r of routes.filter((x) => x.staff)) {
      const st = await call(c, r.method, r.url)
      if (st !== (r.dev ? 404 : 403)) wrong.push(`${r.method} ${r.path} → ${st}`)
    }
    expect(wrong).toEqual([])
  })

  for (const [name, phone] of Object.entries(STAFF)) {
    describe(name, () => {
      let dev: Session, admin: Session, held: Set<Permission>
      beforeAll(async () => {
        dev = await staffSession(phone, DEV_HOST)
        admin = await staffSession(phone, ADMIN_HOST)
        held = new Set((await admin.get("/v1/me")).body.permissions as Permission[])
      })

      it("holds exactly the default permissions of its role(s)", async () => {
        const roles = (await admin.get("/v1/me")).body.roles as BuiltInRole[]
        const expected = new Set(roles.flatMap((r) => DEFAULT_ROLE_PERMISSIONS[r] ?? []))
        expect([...held].sort()).toEqual([...expected].sort())
      })

      it("is allowed exactly where a permission is held, refused elsewhere", async () => {
        const wrong = []
        for (const r of routes) {
          const s = r.dev ? dev : admin
          const st = await call(s, r.method, r.url)
          const rule = ROLE_RULES[`${r.method} ${r.path}`]
          const allowed = r.permissions.some((p) => held.has(p)) && (!rule || rule === name)
          if (allowed ? st === 401 || st === 403 : st !== 403) wrong.push(`${r.method} ${r.path} → ${st} (expected ${allowed ? "allowed" : 403})`)
        }
        expect(wrong).toEqual([])
      })

      it("Developer Panel routes do not exist on the admin host", async () => {
        const wrong = []
        for (const r of routes.filter((x) => x.dev)) { const st = await call(admin, r.method, r.url); if (st !== 404) wrong.push(`${r.method} ${r.path} → ${st}`) }
        expect(wrong).toEqual([])
      })
    })
  }
})
