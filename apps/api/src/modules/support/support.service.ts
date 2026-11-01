import { Inject, Injectable, type OnModuleInit } from "@nestjs/common"
import { and, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm"

import {
  type CreateTicketBody, type CustomerTicketSummary, type CustomerTicketView, type StaffTicketListQuery, type StaffTicketPage, type StaffTicketSummary, type StaffTicketView, type SupportTicketStatus,
  type StaffTicketCommandBody, type SupportTopic,
} from "@unitravel/contracts"
import { callLogs, type Db, type DbOrTx, supportMessages, supportTickets, type Tx, users } from "@unitravel/db"
import {
  allowedCommands, evaluate, generateTicketRef, type MachineActor, normaliseReference, normaliseTicketRef, TICKET_AUTO_CLOSE_DAYS, TICKET_TRANSITIONS, type TicketCommandName, type TicketFacts,
} from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { ipPrefix, RateLimiter } from "../../core/http/rate-limit"
import { DB, UnitOfWork } from "../../core/infra.module"
import { WorkerRegistry } from "../../core/workers"
import { Queues } from "../../core/queues"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { PowService } from "../identity/pow.service"
import { EmailSender } from "../notifications/channels"
import { normaliseIdentity } from "../identity/otp.service"
import { addBusinessMinutes } from "../platform/business-hours"
import type { DispatchedEvent } from "../platform/outbox.dispatcher"
import { OutboxService } from "../platform/outbox.service"
import { staffActor, SYSTEM } from "../requests/requests.service"
import { toCallView } from "./calls.service"

type Ticket = typeof supportTickets.$inferSelect
const iso = (d: Date | null) => d?.toISOString() ?? null
export const SUPPORT_REPLY_EVENT = "support.reply"

export interface CreateCtx { ip: string; requestId?: string; actor?: Actor }

/**
 * Support tickets (plan J5). A ticket is a thread, not a request: it never changes a request, a quote or a payment.
 * Statuses move only through TICKET_TRANSITIONS inside one transaction with the audit entry. A guest ticket is never
 * linked to an account by matching contact details, and a customer sees only their own tickets (404 otherwise).
 */
@Injectable()
export class SupportService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly limiter: RateLimiter,
    private readonly pow: PowService,
    private readonly access: AccessService,
    private readonly email: EmailSender,
    private readonly workers: WorkerRegistry,
    private readonly queues: Queues,
  ) {}

  async onModuleInit() {
    // Reply emails ride the outbox like every other notification: the row commits with the reply, the worker sends it.
    this.workers.register("events.misc", (job) => (job.name === SUPPORT_REPLY_EVENT ? this.sendReplyEmail((job.data as DispatchedEvent).payload as { messageId: string }) : Promise.resolve("ignored")), 3)
    this.workers.registerJob("maintenance", "support.auto-close", () => this.autoClose())
    await this.queues.get("maintenance").upsertJobScheduler("support-auto-close-hourly", { every: 3600_000 }, { name: "support.auto-close" }).catch(() => undefined)
  }

  // ---------------- public create ----------------

  async create(body: CreateTicketBody, ctx: CreateCtx) {
    const auth = this.config.get("AUTH")
    if (!ctx.actor) {
      // Layered limits as for tracking: per address, per network, per device, per contact; proof of work after a burst. Signed-in customers are limited per user instead.
      const recent = await this.limiter.count("support-ip-10m", ctx.ip, 600)
      if (auth.challengeAfterRequestsPerIp10Min > 0 && recent >= auth.challengeAfterRequestsPerIp10Min && !(await this.pow.verify(body.challenge))) {
        throw new AppError("CHALLENGE_REQUIRED", "Please complete the check", undefined, { challenge: this.pow.create() })
      }
      await this.limiter.enforce("support-ip-1h", ctx.ip, 10, 3600)
      await this.limiter.enforce("support-net-1h", ipPrefix(ctx.ip), 30, 3600)
      await this.limiter.enforce("support-device-1h", body.deviceId, 5, 3600)
      await this.limiter.hit("support-ip-10m", ctx.ip, 600)
    } else {
      await this.limiter.enforce("support-user-1h", ctx.actor.userId, 10, 3600)
    }
    const contact = (body.email ?? body.phone)!.toLowerCase()
    await this.limiter.enforce("support-contact-1d", contact, 10, 86400)

    const email = body.email ? normaliseIdentity("EMAIL", body.email).value : null
    const phone = body.phone ? body.phone.replace(/[ ()-]/g, "") : null
    const requestRef = body.requestRef ? normaliseReference(body.requestRef) : null
    const wf = this.config.get("WORKFLOW")
    const now = new Date()
    const subject = body.message.split("\n")[0]!.trim().slice(0, 100)
    return this.uow.run(async (tx) => {
      const ref = await this.uniqueRef(tx)
      const [t] = await tx.insert(supportTickets).values({
        ref, topic: body.topic, subject, userId: ctx.actor?.userId ?? null, contactName: body.name, contactEmail: email, contactPhone: phone, requestRef, locale: body.locale,
        slaDueAt: addBusinessMinutes(wf.businessHours, now, wf.sla.unassignedMinutes), lastMessageAt: now,
      }).returning()
      await tx.insert(supportMessages).values({ ticketId: t!.id, kind: "CUSTOMER", authorUserId: ctx.actor?.userId ?? null, authorName: body.name, body: body.message })
      await this.audit.record(tx, { actorUserId: ctx.actor?.userId ?? null, actorKind: ctx.actor ? "CUSTOMER" : "ANONYMOUS", action: "support.ticket_created", entityType: "support_ticket", entityId: t!.id, contextRef: ref, after: { topic: body.topic, signedIn: !!ctx.actor }, ip: ctx.ip, requestId: ctx.requestId })
      await this.outbox.add(tx, { aggregateType: "support_ticket", aggregateId: t!.id, eventType: "support.ticket_created", payload: { ticketId: t!.id, ref, topic: body.topic } })
      return { ref, status: t!.status as SupportTicketStatus, createdAt: t!.createdAt.toISOString() }
    })
  }

  private async uniqueRef(tx: DbOrTx): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const ref = generateTicketRef()
      const [hit] = await tx.select({ id: supportTickets.id }).from(supportTickets).where(eq(supportTickets.ref, ref))
      if (!hit) return ref
    }
    throw new Error("Could not allocate a unique ticket reference")
  }

  // ---------------- lookups ----------------

  async byRef(ref: string, tx: DbOrTx = this.db, lock = false): Promise<Ticket> {
    const norm = normaliseTicketRef(ref)
    if (!norm) throw notFound("Ticket")
    const q = tx.select().from(supportTickets).where(eq(supportTickets.ref, norm))
    const [t] = lock ? await q.for("update") : await q
    if (!t) throw notFound("Ticket")
    return t
  }

  /** Ownership on every customer lookup; a miss is 404, never 403. */
  async owned(ref: string, userId: string, tx: DbOrTx = this.db, lock = false): Promise<Ticket> {
    const t = await this.byRef(ref, tx, lock)
    if (t.userId !== userId) throw notFound("Ticket")
    return t
  }

  // ---------------- state machine ----------------

  private facts(t: Ticket, extra: Partial<TicketFacts> = {}): TicketFacts {
    return { status: t.status, now: new Date(), ...extra }
  }

  private async transition(tx: Tx, t: Ticket, command: TicketCommandName, actor: MachineActor, opts: { expectedVersion?: number; facts?: Partial<TicketFacts>; patch?: Partial<typeof supportTickets.$inferInsert> } = {}): Promise<Ticket> {
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== t.version) throw new AppError("VERSION_CONFLICT", "Ticket changed; reload")
    const ev = evaluate(TICKET_TRANSITIONS, command, this.facts(t, opts.facts), actor)
    if (!ev.ok) throw new AppError(ev.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_TRANSITION", ev.reason)
    const wf = this.config.get("WORKFLOW")
    const now = new Date()
    // The clock runs while the ball is in our court (OPEN) and stops while we wait for the customer.
    const sla = ev.to === "OPEN" ? (t.status === "OPEN" && t.slaDueAt ? t.slaDueAt : addBusinessMinutes(wf.businessHours, now, wf.sla.unassignedMinutes)) : null
    const [u] = await tx.update(supportTickets).set({
      status: ev.to, version: t.version + 1, slaDueAt: sla, resolvedAt: ev.to === "RESOLVED" ? now : ev.to === "OPEN" ? null : t.resolvedAt, closedAt: ev.to === "CLOSED" ? now : t.closedAt, ...opts.patch,
    }).where(and(eq(supportTickets.id, t.id), eq(supportTickets.version, t.version))).returning()
    if (!u) throw new AppError("VERSION_CONFLICT", "Ticket changed; reload")
    await this.audit.record(tx, { actorUserId: actor.userId, actorKind: actor.kind === "SYSTEM" ? "SYSTEM" : actor.kind === "STAFF" ? "STAFF" : "CUSTOMER", action: `support.${command}`, entityType: "support_ticket", entityId: t.id, contextRef: t.ref, before: { status: ev.from }, after: { status: ev.to } })
    return u
  }

  // ---------------- customer ----------------

  async customerList(userId: string): Promise<CustomerTicketSummary[]> {
    const rows = await this.db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).orderBy(desc(supportTickets.lastMessageAt)).limit(100)
    return rows.map(summary)
  }

  async customerDetail(ref: string, userId: string): Promise<CustomerTicketView> {
    const t = await this.owned(ref, userId)
    // Internal notes are excluded in the query itself, not only in the serialiser.
    const msgs = await this.db.select().from(supportMessages).where(and(eq(supportMessages.ticketId, t.id), inArray(supportMessages.kind, ["CUSTOMER", "STAFF"]))).orderBy(supportMessages.createdAt)
    return { ...summary(t), canReply: t.status !== "CLOSED", messages: msgs.map((m) => ({ id: m.id, direction: m.kind === "CUSTOMER" ? "FROM_CUSTOMER" as const : "TO_CUSTOMER" as const, authorName: m.kind === "CUSTOMER" ? m.authorName : "Uni Travel", body: m.body, createdAt: m.createdAt.toISOString() })) }
  }

  async customerReply(ref: string, actor: Actor, body: string): Promise<CustomerTicketView> {
    await this.uow.run(async (tx) => {
      const t = await this.owned(ref, actor.userId, tx, true)
      const [u] = await tx.select({ name: users.displayName }).from(users).where(eq(users.id, actor.userId))
      const owner: MachineActor = { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true }
      // A pending or resolved ticket reopens; CLOSED is refused by the table.
      const moved = await this.transition(tx, t, "customer_reply", owner, { patch: { lastMessageAt: new Date() } })
      await tx.insert(supportMessages).values({ ticketId: moved.id, kind: "CUSTOMER", authorUserId: actor.userId, authorName: u?.name ?? "Customer", body })
    })
    return this.customerDetail(ref, actor.userId)
  }

  // ---------------- staff ----------------

  async staffList(q: StaffTicketListQuery, actor: Actor): Promise<StaffTicketPage> {
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, "\\$&")}%` : null
    const conds = [
      q.status ? eq(supportTickets.status, q.status) : undefined,
      q.topic ? eq(supportTickets.topic, q.topic) : undefined,
      q.assignee === "me" ? eq(supportTickets.assigneeUserId, actor.userId) : q.assignee === "none" ? isNull(supportTickets.assigneeUserId) : q.assignee ? eq(supportTickets.assigneeUserId, q.assignee) : undefined,
      q.overdue === true ? and(eq(supportTickets.status, "OPEN"), sql`${supportTickets.slaDueAt} < now()`) : undefined,
      q.overdue === false ? or(sql`${supportTickets.status} <> 'OPEN'`, sql`${supportTickets.slaDueAt} >= now()`, isNull(supportTickets.slaDueAt)) : undefined,
      q.customerId ? eq(supportTickets.userId, q.customerId) : undefined,
      like ? or(ilike(supportTickets.ref, like), ilike(supportTickets.subject, like), ilike(supportTickets.contactName, like)) : undefined,
      q.cursor ? lt(supportTickets.id, q.cursor) : undefined,
    ].filter(Boolean)
    const rows = await this.db.select({ t: supportTickets, assignee: sql<string | null>`(select display_name from users where id = ${supportTickets.assigneeUserId})`, n: sql<number>`(select count(*)::int from support_messages m where m.ticket_id = ${supportTickets.id} and m.kind <> 'INTERNAL')` })
      .from(supportTickets).where(conds.length ? and(...conds) : undefined).orderBy(desc(supportTickets.id)).limit(q.limit + 1)
    const page = rows.slice(0, q.limit)
    return { items: page.map((r) => staffSummary(r.t, r.assignee, r.n)), nextCursor: rows.length > q.limit ? page[page.length - 1]!.t.id : null }
  }

  async staffDetail(ref: string, actor: Actor): Promise<StaffTicketView> {
    const t = await this.byRef(ref)
    const [msgs, calls, assignee] = await Promise.all([
      this.db.select().from(supportMessages).where(eq(supportMessages.ticketId, t.id)).orderBy(supportMessages.createdAt),
      this.db.select().from(callLogs).where(eq(callLogs.ticketId, t.id)).orderBy(desc(callLogs.startedAt)),
      t.assigneeUserId ? this.db.select({ name: users.displayName }).from(users).where(eq(users.id, t.assigneeUserId)) : Promise.resolve([]),
    ])
    return {
      ...staffSummary(t, assignee[0]?.name ?? null, msgs.filter((m) => m.kind !== "INTERNAL").length),
      contact: { name: t.contactName, email: t.contactEmail, phone: t.contactPhone }, locale: t.locale,
      messages: msgs.map((m) => ({ id: m.id, kind: m.kind, authorName: m.authorName, body: m.body, createdAt: m.createdAt.toISOString(), emailed: m.emailQueued })),
      calls: calls.map((c) => toCallView(c, t.ref, null)), version: t.version,
      allowedCommands: allowedCommands(TICKET_TRANSITIONS, this.facts(t, { assigneeCanReply: true }), staffActor(actor), ["assign", "resolve", "reopen", "close"]) as StaffTicketView["allowedCommands"],
    }
  }

  async staffReply(ref: string, actor: Actor, body: string, internal: boolean): Promise<StaffTicketView> {
    await this.uow.run(async (tx) => {
      const t = await this.byRef(ref, tx, true)
      const [u] = await tx.select({ name: users.displayName }).from(users).where(eq(users.id, actor.userId))
      if (internal) {
        // A note changes nothing about the ticket and nobody is told; it still needs the reply permission and is audited.
        if (!actor.permissions.has("support.reply")) throw new AppError("FORBIDDEN", "Requires support.reply")
        if (t.status === "CLOSED") throw new AppError("INVALID_TRANSITION", "This ticket is closed")
        const [m] = await tx.insert(supportMessages).values({ ticketId: t.id, kind: "INTERNAL", authorUserId: actor.userId, authorName: u?.name ?? "Staff", body }).returning()
        await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "support.note_added", entityType: "support_ticket", entityId: t.id, contextRef: t.ref, after: { messageId: m!.id } })
        return
      }
      const moved = await this.transition(tx, t, "staff_reply", staffActor(actor), { patch: { lastMessageAt: new Date(), assigneeUserId: t.assigneeUserId ?? actor.userId } })
      // Email only where there is an address; a phone-only contact is answered by calling (the console shows `emailed: false`).
      const [m] = await tx.insert(supportMessages).values({ ticketId: moved.id, kind: "STAFF", authorUserId: actor.userId, authorName: u?.name ?? "Staff", body, emailQueued: !!t.contactEmail }).returning()
      if (t.contactEmail) await this.outbox.add(tx, { aggregateType: "support_ticket", aggregateId: t.id, eventType: SUPPORT_REPLY_EVENT, payload: { ticketId: t.id, messageId: m!.id }, dedupeKey: `support-reply:${m!.id}` })
    })
    return this.staffDetail(ref, actor)
  }

  async staffCommand(ref: string, body: StaffTicketCommandBody, actor: Actor): Promise<StaffTicketView> {
    await this.uow.run(async (tx) => {
      const t = await this.byRef(ref, tx, true)
      const m = staffActor(actor)
      if (body.command === "assign") {
        const acc = await this.access.load(body.assigneeUserId!, tx)
        await this.transition(tx, t, "assign", m, { expectedVersion: body.expectedVersion, facts: { assigneeCanReply: acc.permissions.includes("support.reply") }, patch: { assigneeUserId: body.assigneeUserId } })
      } else {
        await this.transition(tx, t, body.command, m, { expectedVersion: body.expectedVersion })
      }
    })
    return this.staffDetail(ref, actor)
  }

  /** A resolved ticket the customer has not answered in TICKET_AUTO_CLOSE_DAYS closes itself. */
  async autoClose(now = new Date()): Promise<{ closed: number }> {
    const cutoff = new Date(now.getTime() - TICKET_AUTO_CLOSE_DAYS * 86400_000)
    const due = await this.db.select().from(supportTickets).where(and(eq(supportTickets.status, "RESOLVED"), lt(supportTickets.resolvedAt, cutoff)))
    let closed = 0
    for (const d of due) {
      await this.uow.run(async (tx) => {
        const t = await this.byRef(d.ref, tx, true)
        if (t.status !== "RESOLVED") return
        await this.transition(tx, t, "auto_close", SYSTEM)
        closed++
      })
    }
    return { closed }
  }

  /** Sends one staff reply to the contact's email. Idempotent per message: a retry after success finds `emailQueued` already consumed. */
  async sendReplyEmail(payload: { messageId: string }): Promise<string> {
    const [row] = await this.db.select({ m: supportMessages, t: supportTickets }).from(supportMessages).innerJoin(supportTickets, eq(supportTickets.id, supportMessages.ticketId)).where(eq(supportMessages.id, payload.messageId))
    if (!row || row.m.kind !== "STAFF" || !row.t.contactEmail) return "skipped"
    const fa = row.t.locale === "fa"
    const subject = `${fa ? "پاسخ به درخواست شما" : "Re: your message to Uni Travel"} [${row.t.ref}]`
    const footer = fa ? `\n\nبرای ادامه گفتگو به همین ایمیل پاسخ ندهید؛ شماره پیگیری شما ${row.t.ref} است.` : `\n\nPlease do not reply to this email. Your reference is ${row.t.ref}; quote it if you contact us again.`
    await this.email.send(row.t.contactEmail, subject, `${row.m.body}${footer}`, row.t.locale)
    return "sent"
  }
}

const summary = (t: Ticket): CustomerTicketSummary => ({ ref: t.ref as CustomerTicketSummary["ref"], topic: t.topic as SupportTopic, subject: t.subject, status: t.status, requestRef: t.requestRef, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(), lastMessageAt: t.lastMessageAt.toISOString() })

function staffSummary(t: Ticket, assigneeName: string | null, messageCount: number): StaffTicketSummary {
  return {
    ref: t.ref as StaffTicketSummary["ref"], topic: t.topic as SupportTopic, subject: t.subject, status: t.status, contactName: t.contactName, customerId: t.userId, requestRef: t.requestRef,
    assignee: t.assigneeUserId ? { userId: t.assigneeUserId, name: assigneeName ?? "" } : null, slaDueAt: iso(t.slaDueAt), overdue: t.status === "OPEN" && !!t.slaDueAt && t.slaDueAt < new Date(),
    createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(), messageCount,
  }
}
