import "reflect-metadata"

import { RequestMethod, type Type } from "@nestjs/common"
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants"

import type { Permission } from "@unitravel/contracts"

import { AUTHENTICATED_KEY, DEV_SURFACE_KEY, PERMISSIONS_KEY, PUBLIC_KEY, STAFF_KEY } from "./decorators"

export interface Route {
  controller: string; handler: string; method: string; path: string
  declared: boolean; isPublic: boolean; authenticated: boolean; permissions: Permission[]; staff: boolean; dev: boolean
}

/** Every route with its access declaration, read from controller metadata (ch. 25.6, 32.3). */
export function enumerateRoutes(controllers: Type[]): Route[] {
  const routes: Route[] = []
  for (const c of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, c) ?? "")
    for (const name of Object.getOwnPropertyNames(c.prototype)) {
      if (name === "constructor") continue
      const fn = c.prototype[name]
      const method = typeof fn === "function" ? (Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined) : undefined
      if (method === undefined) continue
      const meta = (k: string) => Reflect.getMetadata(k, fn) ?? Reflect.getMetadata(k, c)
      const permissions = (meta(PERMISSIONS_KEY) as Permission[] | undefined) ?? []
      routes.push({
        controller: c.name, handler: name, method: RequestMethod[method]!,
        path: `/${base}/${String(Reflect.getMetadata(PATH_METADATA, fn) ?? "")}`.replace(/\/+/g, "/").replace(/\/$/, ""),
        isPublic: !!meta(PUBLIC_KEY), authenticated: !!meta(AUTHENTICATED_KEY), permissions,
        declared: !!(meta(PUBLIC_KEY) || meta(AUTHENTICATED_KEY) || permissions.length), staff: !!meta(STAFF_KEY), dev: !!meta(DEV_SURFACE_KEY),
      })
    }
  }
  return routes
}
