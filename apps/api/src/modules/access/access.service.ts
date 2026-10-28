import { Inject, Injectable } from "@nestjs/common"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import { DEV_SURFACE_PERMISSIONS, isPermission, type Permission, PRIVILEGED_ROLES, STAFF_SURFACE_PERMISSIONS } from "@unitravel/contracts"
import { type Db, type DbOrTx, rolePermissions, roles, sessions, type Tx, userRoles, users } from "@unitravel/db"

import { AppError } from "../../core/errors"
import { DB, REDIS } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { OutboxService } from "../platform/outbox.service"

export interface UserAccess {
  roles: string[]
  permissions: Permission[]
  permVersion: number
  status: string
}

const PERM_CACHE_SECONDS = 300
const PERM_VERSION_MAX_LUA = `
local cur = redis.call("GET", KEYS[1])
if (not cur) or tonumber(cur) < tonumber(ARGV[1]) then redis.call("SET", KEYS[1], ARGV[1], "EX", tonumber(ARGV[2])) end
return 1
`

/** Roles are bundles of permissions; the backend only ever checks permissions (ch. 10.2). */
@Injectable()
export class AccessService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(REDIS) private readonly redis: Redis, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  async load(userId: string, tx: DbOrTx = this.db): Promise<UserAccess> {
    const [u] = await tx.select({ permVersion: users.permVersion, status: users.status }).from(users).where(eq(users.id, userId))
    if (!u) throw new AppError("UNAUTHENTICATED", "User not found")
    const rows = await tx.select({ key: roles.key, permission: rolePermissions.permission }).from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId)).leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).where(eq(userRoles.userId, userId))
    const roleKeys = [...new Set(rows.map((r) => r.key))]
    const perms = [...new Set(rows.map((r) => r.permission).filter((p): p is string => !!p && isPermission(p)))] as Permission[]
    return { roles: roleKeys, permissions: perms, permVersion: u.permVersion, status: u.status }
  }

  /** perm:{userId} — write-through on change, DB fallback on miss (ch. 25.6). One Redis read per request. */
  async currentPermVersion(userId: string): Promise<number> {
    const cached = await this.redis.get(`perm:${userId}`)
    if (cached) return Number(cached)
    const [u] = await this.db.select({ v: users.permVersion }).from(users).where(eq(users.id, userId))
    if (!u) return -1
    await this.cachePermVersion(userId, u.v)
    return u.v
  }

  /**
   * The cached version only ever moves up, so a slow writer holding a version read before a demotion cannot put the old
   * value back and revive the old tokens. A short lifetime heals a value left too high by a rolled-back transaction.
   */
  async cachePermVersion(userId: string, version: number) {
    await this.redis.eval(PERM_VERSION_MAX_LUA, 1, `perm:${userId}`, String(version), String(PERM_CACHE_SECONDS))
  }

  isStaff(perms: Iterable<Permission>): boolean {
    const set = new Set(perms)
    return STAFF_SURFACE_PERMISSIONS.some((p) => set.has(p)) || DEV_SURFACE_PERMISSIONS.some((p) => set.has(p)) || set.has("compliance.case.read")
  }

  /**
   * Replace a user's role set (PUT /v1/dev/users/:id/roles). Privileged roles need user.role.assign.privileged and a
   * step-up (enforced by the caller); the last owner can never be removed; perm_version increments so the next call
   * with an old token gets 401 PERMISSIONS_CHANGED; every owner is alerted for privileged changes.
   */
  async replaceRoles(targetUserId: string, roleKeys: string[], actor: { userId: string; permissions: Set<Permission>; ip?: string; requestId?: string }) {
    return this.db.transaction(async (tx) => {
      const wanted = roleKeys.length ? await tx.select().from(roles).where(inArray(roles.key, roleKeys)) : []
      if (wanted.length !== new Set(roleKeys).size) throw new AppError("VALIDATION_FAILED", "Unknown role")
      const before = await this.load(targetUserId, tx)
      const added = wanted.filter((r) => !before.roles.includes(r.key))
      const removed = before.roles.filter((k) => !roleKeys.includes(k))
      const touchesPrivileged = [...added.map((r) => r.key), ...removed].some((k) => PRIVILEGED_ROLES.includes(k as never) || wanted.find((w) => w.key === k)?.privileged)
      if (touchesPrivileged && !actor.permissions.has("user.role.assign.privileged")) throw new AppError("FORBIDDEN", "Privileged roles need user.role.assign.privileged")
      if (removed.includes("owner")) await this.assertNotLastOwner(tx, targetUserId)
      await tx.delete(userRoles).where(eq(userRoles.userId, targetUserId))
      if (wanted.length) await tx.insert(userRoles).values(wanted.map((r) => ({ userId: targetUserId, roleId: r.id, grantedBy: actor.userId })))
      const [u] = await tx.update(users).set({ permVersion: sql`${users.permVersion} + 1` }).where(eq(users.id, targetUserId)).returning({ v: users.permVersion })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "user.roles_replaced", entityType: "user", entityId: targetUserId, before: { roles: before.roles }, after: { roles: roleKeys, permVersion: u!.v }, ip: actor.ip, requestId: actor.requestId })
      await this.outbox.add(tx, { aggregateType: "user", aggregateId: targetUserId, eventType: "user.permissions_changed", payload: { userId: targetUserId, permVersion: u!.v, roles: roleKeys, actorUserId: actor.userId, privileged: touchesPrivileged } })
      // Write-through after commit would be ideal; writing now is safe because a stale-high value only forces a refresh.
      await this.cachePermVersion(targetUserId, u!.v)
      return { roles: roleKeys, permVersion: u!.v, privileged: touchesPrivileged }
    })
  }

  async assertNotLastOwner(tx: Tx, removingFrom: string) {
    const owners = await tx.select({ userId: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(roles.key, "owner"), eq(users.status, "ACTIVE")))
    if (owners.filter((o) => o.userId !== removingFrom).length === 0) throw new AppError("LAST_OWNER", "The last owner cannot be demoted or suspended")
  }

  async bumpPermVersion(tx: Tx, userId: string): Promise<number> {
    const [u] = await tx.update(users).set({ permVersion: sql`${users.permVersion} + 1` }).where(eq(users.id, userId)).returning({ v: users.permVersion })
    await this.cachePermVersion(userId, u!.v)
    return u!.v
  }

  /** Staff with a permission, for notifications (e.g. compliance officers, owners). */
  async usersWithPermission(permission: Permission, opts: { onDutyOnly?: boolean } = {}): Promise<string[]> {
    const rows = await this.db.selectDistinct({ id: users.id, onDuty: users.onDuty }).from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .where(and(eq(rolePermissions.permission, permission), eq(users.status, "ACTIVE")))
    return rows.filter((r) => !opts.onDutyOnly || r.onDuty).map((r) => r.id)
  }

  /** Active staff for pickers (assign dialog); names and duty status only, never contact details. */
  async staffDirectory(): Promise<{ id: string; displayName: string; roles: string[]; onDuty: boolean }[]> {
    const rows = await this.db.select({ id: users.id, displayName: users.displayName, onDuty: users.onDuty, role: roles.key, roleId: roles.id }).from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(users.status, "ACTIVE"))
    if (!rows.length) return []
    const perms = await this.db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, [...new Set(rows.map((r) => r.roleId))]))
    const byUser = new Map<string, { id: string; displayName: string; roles: string[]; onDuty: boolean; perms: Permission[] }>()
    for (const r of rows) {
      const u = byUser.get(r.id) ?? { id: r.id, displayName: r.displayName, roles: [], onDuty: r.onDuty, perms: [] }
      u.roles.push(r.role)
      for (const p of perms) if (p.roleId === r.roleId && isPermission(p.permission)) u.perms.push(p.permission)
      byUser.set(r.id, u)
    }
    return [...byUser.values()].filter((u) => this.isStaff(u.perms)).map(({ perms: _, ...u }) => ({ ...u, roles: u.roles.sort() })).sort((a, b) => a.displayName.localeCompare(b.displayName))
  }

  async usersWithRole(roleKey: string): Promise<string[]> {
    const rows = await this.db.select({ id: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(roles.key, roleKey))
    return rows.map((r) => r.id)
  }

  async revokeAllSessions(tx: Tx, userId: string, reason: string) {
    const rows = await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))).returning({ id: sessions.id })
    for (const r of rows) await this.redis.set(`sess:${r.id}:revoked`, "1", "EX", 13 * 3600)
    return rows.length
  }
}
