import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { and, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod"

import { DevUsersQuery, PERMISSIONS, PRIVILEGED_ROLES, ReplaceRolesBody, RoleBody } from "@unitravel/contracts"
import {
  auditLog, cargoRequests, type Db, devices, flightRequests, rolePermissions, roles, sessions, userIdentities, userRoles, users,
} from "@unitravel/db"
import { normaliseReference } from "@unitravel/domain"

import { AppError } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import { type Actor, Ctx, CurrentActor, DevSurface, RequirePermission, type RequestContext, StaffOnly, StepUp } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"

/** Developer Panel §1 — users and roles (ch. 16.2). */
@ApiTags("dev")
@Controller("v1/dev")
@DevSurface()
@StaffOnly()
export class DevUsersController {
  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly access: AccessService, private readonly audit: AuditService, private readonly config: ConfigService) {}

  @Get("users")
  @RequirePermission("user.read")
  async list(@Query(zbody(DevUsersQuery)) q: z.infer<typeof DevUsersQuery>) {
    const conds = [q.status ? eq(users.status, q.status) : undefined, q.cursor ? lt(users.createdAt, new Date(q.cursor)) : undefined]
    if (q.q) {
      const ref = normaliseReference(q.q)
      if (ref) {
        const fr = await this.db.select({ id: flightRequests.customerUserId }).from(flightRequests).where(eq(flightRequests.ref, ref))
        const cr = await this.db.select({ id: cargoRequests.customerUserId }).from(cargoRequests).where(eq(cargoRequests.ref, ref))
        const ids = [...fr, ...cr].map((r) => r.id)
        conds.push(ids.length ? inArray(users.id, ids) : sql`false`)
      } else {
        const idRows = await this.db.select({ userId: userIdentities.userId }).from(userIdentities).where(ilike(userIdentities.valueNormalised, `%${q.q.replace(/[%_]/g, "")}%`))
        conds.push(or(ilike(users.displayName, `%${q.q.replace(/[%_]/g, "")}%`), idRows.length ? inArray(users.id, idRows.map((r) => r.userId)) : sql`false`))
      }
    }
    if (q.role) {
      const rr = await this.db.select({ userId: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(roles.key, q.role))
      conds.push(rr.length ? inArray(users.id, rr.map((r) => r.userId)) : sql`false`)
    }
    const rows = await this.db.select().from(users).where(and(...conds.filter(Boolean))).orderBy(desc(users.createdAt)).limit(q.limit + 1)
    const ids = rows.map((r) => r.id)
    const idents = ids.length ? await this.db.select().from(userIdentities).where(and(inArray(userIdentities.userId, ids), isNull(userIdentities.revokedAt))) : []
    const rr = ids.length ? await this.db.select({ userId: userRoles.userId, key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(inArray(userRoles.userId, ids)) : []
    let items = rows.slice(0, q.limit).map((u) => {
      const phone = idents.find((i) => i.userId === u.id && i.type === "PHONE" && i.isPrimary) ?? idents.find((i) => i.userId === u.id && i.type === "PHONE")
      const email = idents.find((i) => i.userId === u.id && i.type === "EMAIL")
      return {
        id: u.id, displayName: u.displayName, status: u.status, roles: rr.filter((r) => r.userId === u.id).map((r) => r.key), primaryPhone: phone?.valueNormalised ?? null, email: email?.valueNormalised ?? null,
        phoneVerified: !!phone?.verifiedAt, lastActiveAt: u.lastActiveAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
      }
    })
    if (q.verified) items = items.filter((i) => i.phoneVerified === (q.verified === "yes"))
    return { items, nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.createdAt.toISOString() : null }
  }

  @Get("users/:id")
  @RequirePermission("user.read")
  async detail(@Param("id", zbody(z.uuid())) id: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, id))
    if (!u) throw new AppError("NOT_FOUND")
    const acc = await this.access.load(id)
    const ids = await this.db.select().from(userIdentities).where(eq(userIdentities.userId, id))
    const sess = await this.db.select().from(sessions).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt))).orderBy(desc(sessions.lastSeenAt))
    const devs = await this.db.select().from(devices).where(and(eq(devices.userId, id), isNull(devices.disabledAt)))
    const security = await this.db.select().from(auditLog).where(and(eq(auditLog.entityId, id), or(ilike(auditLog.action, "user.%"), ilike(auditLog.action, "security.%"), ilike(auditLog.action, "identity.%")))).orderBy(desc(auditLog.id)).limit(30)
    const signIns = await this.db.select().from(auditLog).where(and(eq(auditLog.actorUserId, id), inArray(auditLog.action, ["user.signed_in", "user.signed_up"]))).orderBy(desc(auditLog.id)).limit(20)
    const fr = await this.db.select({ ref: flightRequests.ref, status: flightRequests.status, submittedAt: flightRequests.submittedAt }).from(flightRequests).where(eq(flightRequests.customerUserId, id)).orderBy(desc(flightRequests.submittedAt)).limit(20)
    const cr = await this.db.select({ ref: cargoRequests.ref, status: cargoRequests.status, submittedAt: cargoRequests.submittedAt }).from(cargoRequests).where(eq(cargoRequests.customerUserId, id)).orderBy(desc(cargoRequests.submittedAt)).limit(20)
    return {
      id: u.id, displayName: u.displayName, status: u.status, roles: acc.roles, permissions: acc.permissions, permVersion: acc.permVersion, createdAt: u.createdAt,
      identities: ids.map((i) => ({ id: i.id, type: i.type, value: i.valueNormalised, verifiedAt: i.verifiedAt, isPrimary: i.isPrimary, revokedAt: i.revokedAt })),
      sessions: sess.map((s) => ({ id: s.id, client: s.client, ip: s.ip, userAgent: s.userAgent, lastSeenAt: s.lastSeenAt, createdAt: s.createdAt, mfaLevel: s.mfaLevel })),
      devices: devs.map((d) => ({ id: d.id, platform: d.platform, pushProvider: d.pushProvider, lastSuccessAt: d.lastSuccessAt, appVersion: d.appVersion })),
      securityEvents: [...security, ...signIns].sort((a, b) => b.id - a.id).map((a) => ({ at: a.occurredAt, action: a.action, ip: a.ip })),
      requests: [...fr, ...cr].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime()),
    }
  }

  /** Privileged changes require user.role.assign.privileged, a step-up and alert every owner (ch. 10.3). */
  @Put("users/:id/roles")
  @RequirePermission("user.role.assign", "user.role.assign.privileged")
  async replaceRoles(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(ReplaceRolesBody)) body: { roles: string[] }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const before = await this.access.load(id)
    const privilegedKeys = (await this.db.select().from(roles).where(eq(roles.privileged, true))).map((r) => r.key)
    const touchesPrivileged = [...body.roles.filter((r) => !before.roles.includes(r)), ...before.roles.filter((r) => !body.roles.includes(r))].some((k) => privilegedKeys.includes(k) || PRIVILEGED_ROLES.includes(k as never))
    if (touchesPrivileged) {
      const window = this.config.get("AUTH").stepUpWindowMinutes * 60_000
      if (!actor.mfaVerifiedAt || Date.now() - actor.mfaVerifiedAt.getTime() > window) throw new AppError("STEP_UP_REQUIRED", "Privileged role changes need a fresh second-factor check")
    }
    return this.access.replaceRoles(id, body.roles, { userId: actor.userId, permissions: actor.permissions, ip: actor.ip, requestId: ctx.id })
  }

  @Post("users/:id/suspend")
  @RequirePermission("user.role.assign")
  @HttpCode(200)
  async suspend(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(z.object({ reason: z.string().min(3) }))) body: { reason: string }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    if (id === actor.userId) throw new AppError("FORBIDDEN", "You cannot suspend yourself")
    return this.uow.run(async (tx) => {
      const acc = await this.access.load(id, tx)
      if (acc.roles.includes("owner")) await this.access.assertNotLastOwner(tx, id)
      if (acc.roles.some((r) => PRIVILEGED_ROLES.includes(r as never)) && !actor.permissions.has("user.role.assign.privileged")) throw new AppError("FORBIDDEN")
      await tx.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, id))
      // Leavers: suspension revokes all sessions immediately and removes push tokens (ch. 25.5).
      const revoked = await this.access.revokeAllSessions(tx, id, "SUSPENDED")
      await tx.update(devices).set({ disabledAt: new Date() }).where(eq(devices.userId, id))
      await this.access.bumpPermVersion(tx, id)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "user.suspended", entityType: "user", entityId: id, after: { reason: body.reason, sessionsRevoked: revoked }, ip: actor.ip, requestId: ctx.id })
      return { status: "SUSPENDED", sessionsRevoked: revoked }
    })
  }

  @Post("users/:id/reactivate")
  @RequirePermission("user.role.assign")
  @HttpCode(200)
  async reactivate(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.uow.run(async (tx) => {
      await tx.update(users).set({ status: "ACTIVE" }).where(eq(users.id, id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "user.reactivated", entityType: "user", entityId: id, ip: actor.ip, requestId: ctx.id })
      return { status: "ACTIVE" }
    })
  }

  @Post("users/:id/sessions/revoke")
  @RequirePermission("user.role.assign")
  @HttpCode(200)
  async revokeSessions(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.uow.run(async (tx) => {
      const n = await this.access.revokeAllSessions(tx, id, "STAFF_REVOKED")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "user.sessions_revoked", entityType: "user", entityId: id, after: { count: n }, ip: actor.ip, requestId: ctx.id })
      return { revoked: n }
    })
  }

  /** Force re-verification: the phone becomes unverified until a new OTP succeeds. */
  @Post("users/:id/force-reverify")
  @RequirePermission("user.role.assign")
  @HttpCode(200)
  async forceReverify(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.uow.run(async (tx) => {
      await tx.update(userIdentities).set({ verifiedAt: null }).where(and(eq(userIdentities.userId, id), eq(userIdentities.type, "PHONE")))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "user.force_reverify", entityType: "user", entityId: id, ip: actor.ip, requestId: ctx.id })
      return { ok: true }
    })
  }

  @Post("users/:id/identities/:identityId/unlink")
  @RequirePermission("user.role.assign")
  @HttpCode(200)
  async unlink(@Param("id", zbody(z.uuid())) id: string, @Param("identityId", zbody(z.uuid())) identityId: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.uow.run(async (tx) => {
      const left = await tx.select().from(userIdentities).where(and(eq(userIdentities.userId, id), isNull(userIdentities.revokedAt)))
      if (left.length <= 1) throw new AppError("VALIDATION_FAILED", "A user needs at least one identity")
      await tx.update(userIdentities).set({ revokedAt: new Date(), isPrimary: false }).where(and(eq(userIdentities.id, identityId), eq(userIdentities.userId, id)))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "user.identity_unlinked", entityType: "user_identity", entityId: identityId, contextRef: id, ip: actor.ip, requestId: ctx.id })
      return { ok: true }
    })
  }

  /** Merging two accounts moves requests and travellers to the survivor (ch. 25.4); step-up required. */
  @Post("users/:id/merge")
  @RequirePermission("user.role.assign.privileged")
  @StepUp()
  @HttpCode(200)
  async merge(@Param("id", zbody(z.uuid())) survivorId: string, @Body(zbody(z.object({ mergeUserId: z.uuid() }))) body: { mergeUserId: string }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    if (survivorId === body.mergeUserId) throw new AppError("VALIDATION_FAILED", "Choose two different accounts")
    return this.uow.run(async (tx) => {
      await tx.execute(sql`update flight_requests set customer_user_id = ${survivorId} where customer_user_id = ${body.mergeUserId}`)
      await tx.execute(sql`update cargo_requests set customer_user_id = ${survivorId} where customer_user_id = ${body.mergeUserId}`)
      await tx.execute(sql`update travellers set owner_user_id = ${survivorId} where owner_user_id = ${body.mergeUserId}`)
      await tx.execute(sql`update user_identities set user_id = ${survivorId}, is_primary = false where user_id = ${body.mergeUserId} and revoked_at is null`)
      await tx.update(users).set({ status: "DELETED", mergedInto: survivorId }).where(eq(users.id, body.mergeUserId))
      await this.access.revokeAllSessions(tx, body.mergeUserId, "MERGED")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "user.merged", entityType: "user", entityId: survivorId, after: { merged: body.mergeUserId }, ip: actor.ip, requestId: ctx.id })
      return { survivorId }
    })
  }

  // ---- role editor ----

  @Get("roles")
  @RequirePermission("user.read")
  async roles() {
    const rs = await this.db.select().from(roles).orderBy(roles.createdAt)
    const rp = await this.db.select().from(rolePermissions)
    const members = await this.db.select({ roleId: userRoles.roleId, n: sql<number>`count(*)::int` }).from(userRoles).groupBy(userRoles.roleId)
    return { catalogue: PERMISSIONS, roles: rs.map((r) => ({ id: r.id, key: r.key, name: r.name, builtIn: r.builtIn, privileged: r.privileged, permissions: rp.filter((p) => p.roleId === r.id).map((p) => p.permission), members: members.find((m) => m.roleId === r.id)?.n ?? 0 })) }
  }

  /** Custom roles combine catalogue permissions; built-in roles can be cloned but not deleted or edited. */
  @Post("roles")
  @RequirePermission("user.role.assign.privileged")
  @StepUp()
  async createRole(@Body(zbody(RoleBody)) body: z.infer<typeof RoleBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.uow.run(async (tx) => {
      const privileged = body.permissions.some((p) => p.startsWith("user.role.assign") || p === "compliance.case.decide" || p === "provider.config.write")
      const [r] = await tx.insert(roles).values({ key: body.key, name: body.name, builtIn: false, privileged }).returning()
      await tx.insert(rolePermissions).values(body.permissions.map((permission) => ({ roleId: r!.id, permission })))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "role.created", entityType: "role", entityId: r!.id, after: body, ip: actor.ip, requestId: ctx.id })
      return r
    })
  }

  @Put("roles/:key")
  @RequirePermission("user.role.assign.privileged")
  @StepUp()
  async updateRole(@Param("key") key: string, @Body(zbody(RoleBody.omit({ key: true, clonedFrom: true }))) body: { name: string; permissions: (typeof PERMISSIONS)[number][] }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.uow.run(async (tx) => {
      const [r] = await tx.select().from(roles).where(eq(roles.key, key))
      if (!r) throw new AppError("NOT_FOUND")
      if (r.builtIn) throw new AppError("FORBIDDEN", "Built-in roles cannot be edited; clone them instead")
      const before = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, r.id))
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, r.id))
      await tx.insert(rolePermissions).values(body.permissions.map((permission) => ({ roleId: r.id, permission })))
      await tx.update(roles).set({ name: body.name }).where(eq(roles.id, r.id))
      // Everyone holding the role gets a new perm_version so their next call refreshes permissions.
      const holders = await tx.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, r.id))
      for (const h of holders) await this.access.bumpPermVersion(tx, h.userId)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "role.updated", entityType: "role", entityId: r.id, before: before.map((b) => b.permission), after: body, ip: actor.ip, requestId: ctx.id })
      return { ok: true, affectedUsers: holders.length }
    })
  }
}
