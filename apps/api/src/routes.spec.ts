import { Controller, Get } from "@nestjs/common"
import { describe, expect, it } from "vitest"

import { API_CONTROLLERS } from "./app.module"
import { enumerateRoutes } from "./core/http/route-table"
import { BUSINESS_CONTROLLERS } from "./modules/business.module"

describe("fail-closed route declarations", () => {
  const routes = enumerateRoutes([...API_CONTROLLERS, ...BUSINESS_CONTROLLERS])

  it("every route declares @Public, @Authenticated or @RequirePermission", () => {
    expect(routes.length).toBeGreaterThan(30)
    expect(routes.filter((r) => !r.declared).map((r) => `${r.controller}.${r.handler} ${r.path}`)).toEqual([])
  })

  it("every /v1/dev route is restricted to the dev host and staff MFA; every /v1/admin route needs staff MFA", () => {
    for (const r of routes.filter((x) => x.path.startsWith("/v1/dev/"))) expect({ path: r.path, dev: r.dev, staff: r.staff }).toEqual({ path: r.path, dev: true, staff: true })
    for (const r of routes.filter((x) => x.path.startsWith("/v1/admin/"))) expect({ path: r.path, staff: r.staff }).toEqual({ path: r.path, staff: true })
  })

  it("flags a route that lacks a declaration (the check fails the build)", () => {
    @Controller("v1/oops")
    class Undeclared {
      @Get() leak() { return "secret" }
    }
    const bad = enumerateRoutes([Undeclared]).filter((r) => !r.declared)
    expect(bad).toHaveLength(1)
    expect(bad[0]!.path).toBe("/v1/oops")
  })
})
