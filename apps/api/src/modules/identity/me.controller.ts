import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { and, eq, isNull } from "drizzle-orm"
import type { Request } from "express"

import { AddIdentityBody, DeviceBody, Me, UpdateMeBody } from "@unitravel/contracts"
import {
  customerProfiles, type Db, devices, documents, flightRequests, cargoRequests, notifications, travellerDocuments, travellers, userIdentities, users,
} from "@unitravel/db"

import { AppError } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import { type Actor, Authenticated, Ctx, CurrentActor, RateLimit, type RequestContext } from "../../core/http/decorators"
import { ApiZodResponse, serialise, zbody } from "../../core/http/zod"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { DocumentsService, isIdentityType } from "../documents/documents.service"
import { MfaService } from "./mfa.service"
import { OtpService } from "./otp.service"
import { SessionsService } from "./sessions.service"
import { DEV_SURFACE_PERMISSIONS, STAFF_SURFACE_PERMISSIONS } from "@unitravel/contracts"

@ApiTags("me")
@Controller("v1/me")
export class MeController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly access: AccessService,
    private readonly config: ConfigService,
    private readonly mfa: MfaService,
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
  ) {}

  /** The clients render what GET /v1/me returns; they never decide permissions themselves (ch. 10.4). */
  @Get()
  @Authenticated()
  @ApiZodResponse(200, Me)
  async me(@CurrentActor() actor: Actor) {
    const [u] = await this.db.select().from(users).where(eq(users.id, actor.userId))
    if (!u) throw new AppError("UNAUTHENTICATED")
    const ids = await this.db.select().from(userIdentities).where(and(eq(userIdentities.userId, u.id), isNull(userIdentities.revokedAt)))
    const [profile] = await this.db.select().from(customerProfiles).where(eq(customerProfiles.userId, u.id))
    const acc = await this.access.load(u.id)
    const enrolled = await this.mfa.enrolled(u.id)
    const window = this.config.get("AUTH").stepUpWindowMinutes * 60_000
    const perms = new Set(acc.permissions)
    return serialise(Me, {
      id: u.id, displayName: u.displayName, status: u.status, preferredLocale: u.preferredLocale, calendar: u.calendar, timezone: u.timezone,
      identities: ids.map((i) => ({ id: i.id, type: i.type, value: i.valueNormalised, verifiedAt: i.verifiedAt?.toISOString() ?? null, isPrimary: i.isPrimary })),
      roles: acc.roles, permissions: acc.permissions, flags: this.config.flags(), permVersion: acc.permVersion,
      profile: profile ? { givenNamesLatin: profile.givenNamesLatin, surnameLatin: profile.surnameLatin, nameFa: profile.nameFa, contactTimePref: profile.contactTimePref } : null,
      notificationPrefs: u.notificationPrefs,
      mfa: { level: actor.mfaLevel, enrolled, stepUpValidUntil: actor.mfaVerifiedAt ? new Date(actor.mfaVerifiedAt.getTime() + window).toISOString() : null },
      onDuty: u.onDuty,
      surfaces: { customer: perms.has("flight_request.create.own"), admin: STAFF_SURFACE_PERMISSIONS.some((p) => perms.has(p)), developer: DEV_SURFACE_PERMISSIONS.some((p) => perms.has(p)) },
    })
  }

  @Patch()
  @Authenticated()
  async update(@Body(zbody(UpdateMeBody)) body: import("zod").infer<typeof UpdateMeBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.uow.run(async (tx) => {
      const userPatch: Partial<typeof users.$inferInsert> = {}
      if (body.displayName) userPatch.displayName = body.displayName
      if (body.preferredLocale) userPatch.preferredLocale = body.preferredLocale
      if (body.calendar) userPatch.calendar = body.calendar
      else if (body.preferredLocale) {
        // Switching language also switches the calendar when it is still the previous language's default (fa starts as Jalali, en as Gregorian).
        const [cur] = await tx.select({ locale: users.preferredLocale, calendar: users.calendar }).from(users).where(eq(users.id, actor.userId))
        const dflt = (l: string) => (l === "fa" ? "JALALI" : "GREGORIAN")
        if (cur && cur.locale !== body.preferredLocale && cur.calendar === dflt(cur.locale)) userPatch.calendar = dflt(body.preferredLocale)
      }
      if (body.timezone) userPatch.timezone = body.timezone
      if (body.onDuty !== undefined) userPatch.onDuty = body.onDuty
      if (body.notificationPrefs) userPatch.notificationPrefs = body.notificationPrefs
      if (body.givenNamesLatin && body.surnameLatin && !body.displayName) userPatch.displayName = `${body.givenNamesLatin} ${body.surnameLatin}`
      if (Object.keys(userPatch).length) await tx.update(users).set(userPatch).where(eq(users.id, actor.userId))
      const profilePatch: Partial<typeof customerProfiles.$inferInsert> = {}
      for (const k of ["givenNamesLatin", "surnameLatin", "nameFa", "contactTimePref"] as const) if (body[k] !== undefined) profilePatch[k] = body[k]
      if (Object.keys(profilePatch).length) {
        await tx.insert(customerProfiles).values({ userId: actor.userId, ...profilePatch }).onConflictDoUpdate({ target: customerProfiles.userId, set: profilePatch })
      }
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: actor.isStaff ? "STAFF" : "CUSTOMER", action: "user.profile_updated", entityType: "user", entityId: actor.userId, after: body, ip: actor.ip, requestId: ctx.id })
    })
    return this.me(actor)
  }

  @Post("identities")
  @Authenticated()
  @HttpCode(202)
  addIdentity(@Body(zbody(AddIdentityBody)) body: import("zod").infer<typeof AddIdentityBody>, @CurrentActor() actor: Actor, @Req() req: Request, @Ctx() ctx: RequestContext) {
    return this.otp.request({ channel: body.type, value: body.value, defaultCountry: body.defaultCountry, deviceId: body.deviceId, challenge: body.challenge, client: actor.audience === "mobile" ? "MOBILE" : "WEB", purpose: body.type === "PHONE" ? "VERIFY_PHONE" : "VERIFY_EMAIL", voice: false }, { ip: req.ip ?? "", requestId: ctx.id, locale: ctx.locale, userId: actor.userId })
  }

  @Get("sessions")
  @Authenticated()
  async listSessions(@CurrentActor() actor: Actor) {
    const rows = await this.sessions.list(actor.userId)
    return rows.map((s) => ({ id: s.id, client: s.client, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), current: s.id === actor.sessionId, mfaLevel: s.mfaLevel }))
  }

  /** Sign out all other devices (keeps this session). Rate-limited: it touches every session row of the account. */
  @Post("sessions/revoke-others")
  @Authenticated()
  @HttpCode(200)
  @RateLimit({ name: "sessions-revoke-others", limit: 10, windowSeconds: 600, key: "user" })
  async revokeOtherSessions(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const revoked = await this.sessions.revokeAll(actor.userId, "USER_REVOKED_ALL", actor.sessionId)
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: actor.isStaff ? "STAFF" : "CUSTOMER", action: "session.revoked_others", entityType: "user", entityId: actor.userId, after: { revoked }, ip: actor.ip, requestId: ctx.id }))
    return { revoked }
  }

  @Delete("sessions/:id")
  @Authenticated()
  @HttpCode(204)
  async revokeSession(@Param("id") id: string, @CurrentActor() actor: Actor) {
    const s = await this.sessions.get(id)
    if (!s || s.userId !== actor.userId) throw new AppError("NOT_FOUND")
    await this.sessions.revoke(id, "USER_REVOKED")
  }

  @Post("devices")
  @Authenticated()
  async registerDevice(@Body(zbody(DeviceBody)) body: import("zod").infer<typeof DeviceBody>, @CurrentActor() actor: Actor) {
    const [d] = await this.db.insert(devices).values({ userId: actor.userId, ...body }).onConflictDoUpdate({ target: [devices.pushProvider, devices.pushToken], set: { userId: actor.userId, disabledAt: null, appVersion: body.appVersion } }).returning()
    return { id: d!.id }
  }

  @Delete("devices/:id")
  @Authenticated()
  @HttpCode(204)
  async removeDevice(@Param("id") id: string, @CurrentActor() actor: Actor) {
    await this.db.update(devices).set({ disabledAt: new Date() }).where(and(eq(devices.id, id), eq(devices.userId, actor.userId)))
  }

  /** Privacy: download my data (ch. 11.7, 28.6). Passport numbers stay masked; staff export with reveal on request. */
  @Post("export")
  @Authenticated()
  @HttpCode(200)
  async exportData(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const me = await this.me(actor)
    const trav = await this.db.select().from(travellers).where(and(eq(travellers.ownerUserId, actor.userId), isNull(travellers.deletedAt)))
    const docs = trav.length ? await this.db.select({ travellerId: travellerDocuments.travellerId, last4: travellerDocuments.numberLast4, issuingCountry: travellerDocuments.issuingCountry, expiryDate: travellerDocuments.expiryDate }).from(travellerDocuments) : []
    const fr = await this.db.select({ ref: flightRequests.ref, status: flightRequests.status, submittedAt: flightRequests.submittedAt, query: flightRequests.query }).from(flightRequests).where(eq(flightRequests.customerUserId, actor.userId))
    const cr = await this.db.select({ ref: cargoRequests.ref, status: cargoRequests.status, submittedAt: cargoRequests.submittedAt }).from(cargoRequests).where(eq(cargoRequests.customerUserId, actor.userId))
    const inbox = await this.db.select({ title: notifications.title, body: notifications.body, createdAt: notifications.createdAt }).from(notifications).where(eq(notifications.userId, actor.userId))
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "CUSTOMER", action: "privacy.export", entityType: "user", entityId: actor.userId, requestId: ctx.id }))
    return { exportedAt: new Date().toISOString(), account: me, travellers: trav.map((t) => ({ ...t, document: docs.find((d) => d.travellerId === t.id) ?? null })), flightRequests: fr, cargoRequests: cr, notifications: inbox }
  }

  /**
   * Delete my account: identities and sessions are revoked, profile and traveller data erased; booking, payment and
   * compliance records stay for the legal retention period (ch. 28.6) and are anonymised later by the retention job.
   */
  @Post("delete")
  @Authenticated()
  @HttpCode(202)
  async deleteAccount(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const acc = await this.access.load(actor.userId)
    if (acc.roles.includes("owner")) throw new AppError("LAST_OWNER", "Owners cannot delete their account here")
    await this.uow.run(async (tx) => {
      await tx.update(users).set({ status: "DELETED", displayName: "Deleted user", notificationPrefs: {} }).where(eq(users.id, actor.userId))
      await tx.update(userIdentities).set({ revokedAt: new Date() }).where(eq(userIdentities.userId, actor.userId))
      await tx.update(customerProfiles).set({ givenNamesLatin: null, surnameLatin: null, nameFa: null, contactTimePref: null, addressLine1: null, addressLine2: null, addressCity: null, addressPostcode: null, addressCountry: null }).where(eq(customerProfiles.userId, actor.userId))
      for (const d of await tx.select().from(documents).where(and(eq(documents.ownerUserId, actor.userId), isNull(documents.erasedAt)))) if (isIdentityType(d.type)) await this.documents.erase(tx, d)
      const trav = await tx.select({ id: travellers.id }).from(travellers).where(eq(travellers.ownerUserId, actor.userId))
      for (const t of trav) {
        await tx.update(travellerDocuments).set({ numberCiphertext: "erased", numberLast4: "0000", erasedAt: new Date() }).where(eq(travellerDocuments.travellerId, t.id))
        await tx.update(travellers).set({ deletedAt: new Date() }).where(eq(travellers.id, t.id))
      }
      await tx.update(devices).set({ disabledAt: new Date() }).where(eq(devices.userId, actor.userId))
      await this.access.revokeAllSessions(tx, actor.userId, "ACCOUNT_DELETED")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "CUSTOMER", action: "privacy.account_deleted", entityType: "user", entityId: actor.userId, requestId: ctx.id })
    })
    return { status: "DELETED", retained: ["flight and cargo requests, quotes, tickets and payments (6 years)", "compliance screenings (6 years)"] }
  }
}
