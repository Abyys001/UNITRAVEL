import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, gte, lt, lte } from "drizzle-orm"

import type { CallListQuery, CallLogBody, CallLogView, ClickToCallBody, TelephonyEvent } from "@unitravel/contracts"
import { callLogs, type Db, supportTickets, userIdentities, users } from "@unitravel/db"
import { normaliseTicketRef } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { normaliseIdentity } from "../identity/otp.service"
import { TELEPHONY, type TelephonyPort } from "./telephony.port"

export function toCallView(c: typeof callLogs.$inferSelect, ticketRef: string | null, recordedByName: string | null): CallLogView {
  return {
    id: c.id, direction: c.direction, fromNumber: c.fromNumber, toNumber: c.toNumber, durationSeconds: c.durationSeconds, status: c.status, startedAt: c.startedAt.toISOString(),
    source: c.source, ticketRef, customerId: c.userId, recordedBy: recordedByName, note: c.note, createdAt: c.createdAt.toISOString(),
  }
}

/** Call log (ADR-0019): entered by hand or ingested from a signed vendor webhook. Never needed for a ticket or request to work. */
@Injectable()
export class CallsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    @Inject(TELEPHONY) private readonly telephony: TelephonyPort,
  ) {}

  private async ticketId(ref: string | undefined): Promise<string | null> {
    if (!ref) return null
    const norm = normaliseTicketRef(ref)
    const [t] = norm ? await this.db.select({ id: supportTickets.id }).from(supportTickets).where(eq(supportTickets.ref, norm)) : []
    if (!t) throw new AppError("VALIDATION_FAILED", "Unknown ticket", [{ path: "ticketRef", code: "NOT_FOUND" }])
    return t.id
  }

  async record(body: CallLogBody, actor: Actor, requestId?: string): Promise<CallLogView> {
    const ticketId = await this.ticketId(body.ticketRef)
    if (body.customerId) {
      const [u] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, body.customerId))
      if (!u) throw new AppError("VALIDATION_FAILED", "Unknown customer", [{ path: "customerId", code: "NOT_FOUND" }])
    }
    return this.uow.run(async (tx) => {
      const [c] = await tx.insert(callLogs).values({
        direction: body.direction, fromNumber: body.fromNumber, toNumber: body.toNumber, durationSeconds: body.durationSeconds, status: body.status, startedAt: new Date(body.startedAt),
        source: "MANUAL", ticketId, userId: body.customerId ?? null, recordedBy: actor.userId, note: body.note ?? null,
      }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "call.logged", entityType: "call_log", entityId: c!.id, contextRef: body.ticketRef ?? null, after: { direction: body.direction, status: body.status, durationSeconds: body.durationSeconds }, ip: actor.ip, requestId })
      return toCallView(c!, body.ticketRef ?? null, null)
    })
  }

  async list(q: CallListQuery): Promise<{ items: CallLogView[]; nextCursor: string | null }> {
    const ticketId = q.ticketRef ? await this.ticketId(q.ticketRef) : null
    const rows = await this.db.select({ c: callLogs, ref: supportTickets.ref, by: users.displayName }).from(callLogs)
      .leftJoin(supportTickets, eq(supportTickets.id, callLogs.ticketId)).leftJoin(users, eq(users.id, callLogs.recordedBy))
      .where(and(
        q.direction ? eq(callLogs.direction, q.direction) : undefined, q.status ? eq(callLogs.status, q.status) : undefined, ticketId ? eq(callLogs.ticketId, ticketId) : undefined,
        q.customerId ? eq(callLogs.userId, q.customerId) : undefined, q.from ? gte(callLogs.startedAt, new Date(q.from)) : undefined, q.to ? lte(callLogs.startedAt, new Date(q.to)) : undefined,
        q.cursor ? lt(callLogs.id, q.cursor) : undefined,
      )).orderBy(desc(callLogs.id)).limit(q.limit + 1)
    const page = rows.slice(0, q.limit)
    return { items: page.map((r) => toCallView(r.c, r.ref, r.by)), nextCursor: rows.length > q.limit ? page[page.length - 1]!.c.id : null }
  }

  async clickToCall(body: ClickToCallBody, actor: Actor): Promise<{ callId: string }> {
    await this.ticketId(body.ticketRef)
    return this.telephony.clickToCall(body, actor.userId)
  }

  /** Public, signed. A redelivered event (same vendor call id) is acknowledged without a second row. */
  async ingest(rawBody: Buffer, headers: Record<string, string | undefined>, requestId?: string): Promise<{ accepted: true; duplicate: boolean }> {
    const ev: TelephonyEvent = await this.telephony.verifyAndParse(rawBody, headers)
    // Link to a customer only when the outside number is a verified phone on an account; a guess is never stored as a link.
    const outside = ev.direction === "INBOUND" ? ev.fromNumber : ev.toNumber
    let userId: string | null = null
    try {
      const n = normaliseIdentity("PHONE", outside)
      const [hit] = await this.db.select({ userId: userIdentities.userId, verifiedAt: userIdentities.verifiedAt }).from(userIdentities).where(and(eq(userIdentities.type, "PHONE"), eq(userIdentities.valueNormalised, n.value)))
      if (hit?.verifiedAt) userId = hit.userId
    } catch { /* not a dialable number (for example an internal extension): no link */ }
    return this.uow.run(async (tx) => {
      const inserted = await tx.insert(callLogs).values({
        direction: ev.direction, fromNumber: ev.fromNumber, toNumber: ev.toNumber, durationSeconds: ev.durationSeconds, status: ev.status, startedAt: new Date(ev.startedAt), source: "BONLINE", providerRef: ev.callId, userId,
      }).onConflictDoNothing().returning({ id: callLogs.id })
      if (inserted[0]) await this.audit.record(tx, { actorKind: "SYSTEM", action: "call.ingested", entityType: "call_log", entityId: inserted[0].id, after: { direction: ev.direction, status: ev.status, vendor: this.telephony.vendor }, requestId })
      return { accepted: true as const, duplicate: !inserted[0] }
    })
  }

  async mustExist(id: string) {
    const [c] = await this.db.select().from(callLogs).where(eq(callLogs.id, id))
    if (!c) throw notFound("Call")
    return c
  }
}
