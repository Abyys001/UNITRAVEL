import { Inject, Injectable } from "@nestjs/common"
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm"

import { AGENT_TYPE_LABELS, type AgentAction, type AssignmentKind, CARGO_MILESTONE_LABELS, FAILURE_REASON_LABELS, type TrackingEventCode } from "@unitravel/contracts"
import { auditLog, cargoAgentAssignments, cargoAgents, cargoDeliveryProofs, cargoItems, cargoPieces, cargoRequests, type Db, roles, trackingEvents, type Tx, userIdentities, userRoles, users } from "@unitravel/db"
import { agentActions, effectiveTimeline, type MachineActor, MAX_DELIVERY_ATTEMPTS, trackingEventAllowed } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { DocumentsService } from "../documents/documents.service"
import { normaliseIdentity } from "../identity/otp.service"
import { OutboxService } from "../platform/outbox.service"
import { CargoOpsService, decodeImage, publicAgentName } from "./cargo-ops.service"
import { CargoService } from "./cargo.service"

type Party = { name: string; company?: string; phone: string; email?: string; address: { line1: string; line2?: string; city: string; postcode?: string; country: string } }
type Agent = typeof cargoAgents.$inferSelect
type Assignment = typeof cargoAgentAssignments.$inferSelect
const KIND_LABEL = { COLLECTION: { en: "collection", fa: "جمع‌آوری" }, HANDLING: { en: "handling", fa: "جابه‌جایی" }, DELIVERY: { en: "delivery", fa: "تحویل" } } as const
/** Which shipment states each kind of job can be given in. */
const ASSIGNABLE: Record<AssignmentKind, string[]> = {
  COLLECTION: ["BOOKED", "AWAITING_HANDOVER"],
  HANDLING: ["AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS"],
  DELIVERY: ["RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY"],
}
const ASSIGNED_EVENT: Partial<Record<AssignmentKind, TrackingEventCode>> = { COLLECTION: "COLLECTION_AGENT_ASSIGNED", DELIVERY: "DELIVERY_AGENT_ASSIGNED" }
const fullAddress = (p: Party) => [p.address.line1, p.address.line2, p.address.city, p.address.postcode, p.address.country].filter(Boolean).join(", ")

/**
 * Agent Management and agent jobs (ADR-0043, extends ADR-0042 D7-D9). Staff with `cargo_agent.manage` create agents
 * and staff with `cargo_request.transition` assign jobs; an agent (`cargo_job.agent`) sees and acts on their own
 * assignments only. Every agent route resolves the assignment from the signed-in user first and answers 404 otherwise.
 */
@Injectable()
export class AgentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
    private readonly docs: DocumentsService,
    private readonly cargo: CargoService,
    private readonly ops: CargoOpsService,
  ) {}

  // ---------------- Agent Management ----------------

  private async counts() {
    const rows = await this.db.select({ d: cargoAgentAssignments.agentId, s: cargoAgentAssignments.status, n: sql<number>`count(*)::int` }).from(cargoAgentAssignments).groupBy(cargoAgentAssignments.agentId, cargoAgentAssignments.status)
    return (id: string, s: string) => rows.find((c) => c.d === id && c.s === s)?.n ?? 0
  }

  private view(a: Agent, n: (id: string, s: string) => number) {
    return {
      id: a.id, agentCode: a.agentCode, userId: a.userId, displayName: a.displayName, publicName: publicAgentName(a), customPublicName: a.publicName, email: a.email, phone: a.phone, agentType: a.agentType,
      agentTypeLabel: AGENT_TYPE_LABELS[a.agentType as keyof typeof AGENT_TYPE_LABELS]?.en ?? a.agentType, responsibilities: a.responsibilities, company: a.company, vehicle: a.vehicle, notes: a.notes,
      active: a.active, requiresAcceptance: a.requiresAcceptance, hasPhoto: !!a.photoDocumentId,
      offeredJobs: n(a.id, "OFFERED"), activeJobs: n(a.id, "ASSIGNED"), completedJobs: n(a.id, "COMPLETED"), failedJobs: n(a.id, "FAILED"), createdAt: a.createdAt.toISOString(),
    }
  }

  async list() {
    const rows = await this.db.select().from(cargoAgents).orderBy(desc(cargoAgents.active), asc(cargoAgents.agentCode))
    const n = await this.counts()
    return rows.map((a) => this.view(a, n))
  }

  /**
   * Links the profile to the account with this email, creating the account when there is none. Only the `agent` role is
   * added: an existing customer keeps their account and data, and gains nothing else. The Agent ID comes from a sequence.
   */
  async create(body: { displayName: string; email: string; phone?: string; agentType: string; responsibilities: string[]; publicName?: string; company?: string; vehicle?: string; notes?: string; requiresAcceptance: boolean }, actor: Actor) {
    const email = normaliseIdentity("EMAIL", body.email).value
    return this.uow.run(async (tx) => {
      const [existing] = await tx.select().from(userIdentities).where(and(eq(userIdentities.type, "EMAIL"), eq(userIdentities.valueNormalised, email), isNull(userIdentities.revokedAt)))
      let userId = existing?.userId
      if (!userId) {
        const [u] = await tx.insert(users).values({ displayName: body.displayName, preferredLocale: "en", calendar: "GREGORIAN", timezone: "Europe/London" }).returning()
        userId = u!.id
        // Unverified until the agent signs in with the emailed code (ch. 11.2).
        await tx.insert(userIdentities).values({ userId, type: "EMAIL", valueNormalised: email, isPrimary: true })
      }
      const [dup] = await tx.select().from(cargoAgents).where(eq(cargoAgents.userId, userId))
      if (dup) throw new AppError("VALIDATION_FAILED", `This account is already agent ${dup.agentCode}`, [{ path: "email", code: "DUPLICATE" }])
      const [a] = await tx.insert(cargoAgents).values({
        userId, displayName: body.displayName, email, phone: body.phone ?? null, agentType: body.agentType, responsibilities: [...new Set(body.responsibilities)], publicName: body.publicName ?? null,
        company: body.company ?? null, vehicle: body.vehicle ?? null, notes: body.notes ?? null, requiresAcceptance: body.requiresAcceptance, createdBy: actor.userId,
      } as typeof cargoAgents.$inferInsert).returning()
      await this.grantRole(tx, userId, actor)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_agent.created", entityType: "cargo_agent", entityId: a!.id, contextRef: a!.agentCode, after: { userId, email, agentType: body.agentType, responsibilities: body.responsibilities, newAccount: !existing } })
      return this.view(a!, () => 0)
    })
  }

  async update(id: string, body: { displayName?: string; phone?: string; agentType?: string; responsibilities?: string[]; publicName?: string | null; company?: string; vehicle?: string; notes?: string; requiresAcceptance?: boolean; active?: boolean }, actor: Actor) {
    return this.uow.run(async (tx) => {
      const [a] = await tx.select().from(cargoAgents).where(eq(cargoAgents.id, id)).for("update")
      if (!a) throw notFound("Agent")
      if (body.active === false && a.active) {
        const open = await tx.select({ id: cargoAgentAssignments.id }).from(cargoAgentAssignments).where(and(eq(cargoAgentAssignments.agentId, id), inArray(cargoAgentAssignments.status, ["OFFERED", "ASSIGNED"])))
        if (open.length) throw new AppError("VALIDATION_FAILED", `Reassign the agent's ${open.length} open job(s) first`, [{ path: "active", code: "OPEN_JOBS" }])
        await this.revokeRole(tx, a.userId, actor)
      }
      if (body.active === true && !a.active) await this.grantRole(tx, a.userId, actor)
      const patch = { ...body, ...(body.responsibilities ? { responsibilities: [...new Set(body.responsibilities)] } : {}) }
      const [after] = await tx.update(cargoAgents).set(patch).where(eq(cargoAgents.id, id)).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_agent.updated", entityType: "cargo_agent", entityId: id, contextRef: a.agentCode, before: { displayName: a.displayName, phone: a.phone, agentType: a.agentType, responsibilities: a.responsibilities, publicName: a.publicName, active: a.active, requiresAcceptance: a.requiresAcceptance }, after: body })
      return this.view(after!, await this.counts())
    })
  }

  /** Profile photograph: JPG/PNG, metadata stripped, scanned; shown only inside the Admin Panel and the agent dashboard. */
  async setPhoto(id: string, body: { filename: string; data: string }, actor: Actor) {
    const [a] = await this.db.select().from(cargoAgents).where(eq(cargoAgents.id, id))
    if (!a) throw notFound("Agent")
    const doc = await this.docs.storeImage({ ownerUserId: a.userId, type: "AGENT_PHOTO", filename: body.filename, body: decodeImage(body.data), createdBy: actor.userId })
    await this.uow.run(async (tx) => {
      await tx.update(cargoAgents).set({ photoDocumentId: doc.id }).where(eq(cargoAgents.id, id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_agent.photo_set", entityType: "cargo_agent", entityId: id, contextRef: a.agentCode, after: { documentId: doc.id } })
    })
    return { documentId: doc.id }
  }

  /** Bytes of the photo for the console (same origin, so the console's CSP allows it). 404 until the scan is clean. */
  async photo(id: string) {
    const [a] = await this.db.select().from(cargoAgents).where(eq(cargoAgents.id, id))
    if (!a?.photoDocumentId) throw notFound("Photo")
    const d = await this.docs.get(a.photoDocumentId)
    if (!d || d.scanStatus !== "CLEAN" || d.erasedAt) throw notFound("Photo")
    return { body: await this.docs.readBytes(d), mime: d.mime }
  }

  /** Agent profile: details, performance, jobs and activity (ADR-0043 D1). */
  async profile(id: string) {
    const [a] = await this.db.select().from(cargoAgents).where(eq(cargoAgents.id, id))
    if (!a) throw notFound("Agent")
    const jobs = await this.db.select({ j: cargoAgentAssignments, ref: cargoRequests.ref, tn: cargoRequests.trackingNumber, cargoStatus: cargoRequests.status })
      .from(cargoAgentAssignments).innerJoin(cargoRequests, eq(cargoRequests.id, cargoAgentAssignments.cargoRequestId)).where(eq(cargoAgentAssignments.agentId, id)).orderBy(desc(cargoAgentAssignments.assignedAt)).limit(200)
    const done = jobs.filter(({ j }) => j.status === "COMPLETED")
    const minutes = done.filter(({ j }) => j.completedAt).map(({ j }) => (j.completedAt!.getTime() - (j.acceptedAt ?? j.assignedAt).getTime()) / 60_000)
    const scheduled = done.filter(({ j }) => j.scheduledFor && j.completedAt)
    const onTime = scheduled.filter(({ j }) => j.completedAt!.getTime() <= j.scheduledFor!.getTime() + 2 * 3600_000).length
    const closed = jobs.filter(({ j }) => ["COMPLETED", "FAILED"].includes(j.status)).length
    const activity = await this.db.select({ at: auditLog.occurredAt, action: auditLog.action, ref: auditLog.contextRef }).from(auditLog).where(eq(auditLog.actorUserId, a.userId)).orderBy(desc(auditLog.occurredAt)).limit(100)
    const handled = await this.db.select({ n: sql<number>`count(*)::int` }).from(trackingEvents).where(eq(trackingEvents.agentId, id))
    return {
      agent: this.view(a, await this.counts()),
      performance: {
        totalJobs: jobs.length, completed: done.length, failed: jobs.filter(({ j }) => j.status === "FAILED").length, declined: jobs.filter(({ j }) => j.status === "DECLINED").length,
        open: jobs.filter(({ j }) => ["OFFERED", "ASSIGNED"].includes(j.status)).length, failedAttempts: jobs.reduce((n, { j }) => n + j.attempts, 0),
        completionRate: closed ? Math.round((done.length / closed) * 100) : null, onTimeRate: scheduled.length ? Math.round((onTime / scheduled.length) * 100) : null,
        averageMinutes: minutes.length ? Math.round(minutes.reduce((x, y) => x + y, 0) / minutes.length) : null, trackingUpdates: handled[0]?.n ?? 0,
      },
      jobs: jobs.map(({ j, ref, tn, cargoStatus }) => ({ id: j.id, ref, trackingNumber: tn, cargoStatus, kind: j.kind, status: j.status, assignedAt: j.assignedAt.toISOString(), acceptedAt: j.acceptedAt?.toISOString() ?? null, completedAt: j.completedAt?.toISOString() ?? null, scheduledFor: j.scheduledFor?.toISOString() ?? null, attempts: j.attempts, declineReason: j.declineReason })),
      activity: activity.map((x) => ({ at: x.at.toISOString(), action: x.action.replace(/^cargo_request\.agent_|^cargo_request\.|^cargo_agent\./, ""), ref: x.ref })),
    }
  }

  private async grantRole(tx: Tx, userId: string, actor: Actor) {
    const [role] = await tx.select().from(roles).where(eq(roles.key, "agent"))
    if (!role) throw new AppError("VALIDATION_FAILED", "The agent role is missing; run the seed")
    await tx.insert(userRoles).values({ userId, roleId: role.id }).onConflictDoNothing()
    await this.access.bumpPermVersion(tx, userId)
    await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "user.role_granted", entityType: "user", entityId: userId, after: { role: "agent" } })
    await this.outbox.add(tx, { aggregateType: "user", aggregateId: userId, eventType: "user.permissions_changed", payload: { userId, roles: ["agent"], actorUserId: actor.userId, privileged: false } })
  }

  private async revokeRole(tx: Tx, userId: string, actor: Actor) {
    const [role] = await tx.select().from(roles).where(eq(roles.key, "agent"))
    if (role) await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)))
    await this.access.bumpPermVersion(tx, userId)
    // An agent who is nothing else loses their console sessions at once.
    const acc = await this.access.load(userId, tx)
    if (!this.access.isStaff(acc.permissions)) await this.access.revokeAllSessions(tx, userId, "AGENT_DEACTIVATED")
    await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "user.role_revoked", entityType: "user", entityId: userId, after: { role: "agent" } })
  }

  // ---------------- Agent Assignment (staff) ----------------

  /** One or several agents for one kind of job. Agents who must accept get the job as OFFERED. */
  async assign(ref: string, body: { agentIds: string[]; kind: AssignmentKind; scheduledFor?: string; location: string; note?: string }, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.cargo.byRef(ref, tx, true)
      if (!ASSIGNABLE[body.kind].includes(r.status)) throw new AppError("INVALID_TRANSITION", body.kind === "COLLECTION" ? "Collection agents are assigned once the shipment is booked and before it is received" : body.kind === "HANDLING" ? "Handling agents are assigned between handover and delivery" : "Delivery agents are assigned once the shipment has been received")
      const agents = await tx.select().from(cargoAgents).where(inArray(cargoAgents.id, [...new Set(body.agentIds)]))
      if (agents.length !== new Set(body.agentIds).size) throw notFound("Agent")
      for (const a of agents) {
        if (!a.active) throw new AppError("VALIDATION_FAILED", `${a.agentCode} is not active`, [{ path: "agentIds", code: "INACTIVE" }])
        if (!a.responsibilities.includes(body.kind)) throw new AppError("VALIDATION_FAILED", `${a.agentCode} does not take ${KIND_LABEL[body.kind].en} jobs`, [{ path: "agentIds", code: "NOT_RESPONSIBLE" }])
      }
      const created: Assignment[] = []
      for (const a of agents) {
        const [open] = await tx.select().from(cargoAgentAssignments).where(and(eq(cargoAgentAssignments.cargoRequestId, r.id), eq(cargoAgentAssignments.kind, body.kind), eq(cargoAgentAssignments.agentId, a.id), inArray(cargoAgentAssignments.status, ["OFFERED", "ASSIGNED"])))
        if (open) throw new AppError("VALIDATION_FAILED", `${a.agentCode} already has this job`, [{ path: "agentIds", code: "DUPLICATE" }])
        const [j] = await tx.insert(cargoAgentAssignments).values({ cargoRequestId: r.id, agentId: a.id, kind: body.kind, status: a.requiresAcceptance ? "OFFERED" : "ASSIGNED", scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null, note: body.note ?? null, assignedBy: actor.userId, acceptedAt: a.requiresAcceptance ? null : new Date() }).returning()
        created.push(j!)
        if (!a.requiresAcceptance) await this.announce(tx, r, j!, a, body.location, body.scheduledFor, actor.userId)
        await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r.id, eventType: "cargo.job_assigned", payload: { requestId: r.id, ref: r.ref, agentUserId: a.userId, kind: KIND_LABEL[body.kind].en, kind_fa: KIND_LABEL[body.kind].fa, scheduledFor: body.scheduledFor ?? null } })
      }
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_request.agent_assigned", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, after: { kind: body.kind, agents: agents.map((a) => a.agentCode), assignments: created.map((c) => ({ id: c.id, status: c.status })) } })
      return created
    })
  }

  /** The customer-visible part of an assignment: the event (with the agent's public name) and the notice. */
  private async announce(tx: Tx, r: typeof cargoRequests.$inferSelect, j: Assignment, a: Agent, location: string, scheduledFor: string | undefined | null, userId: string) {
    const code = ASSIGNED_EVENT[j.kind as AssignmentKind]
    if (code) {
      await this.addEvent(tx, r, code, location, new Date(), `${KIND_LABEL[j.kind as AssignmentKind].en} job ${j.id.slice(0, 8)}`, userId, a.id)
      // A millisecond later so the timeline order (and the milestone) is deterministic.
      if (j.kind === "COLLECTION" && scheduledFor) await this.addEvent(tx, r, "COLLECTION_SCHEDULED", location, new Date(Date.now() + 1), `Collection planned for ${scheduledFor.slice(0, 16).replace("T", " ")}`, userId, a.id)
      await this.milestoneCheck(tx, r, `AGENT_ASSIGNED:${j.kind}`)
    }
    await this.milestoneCheck(tx, r)
  }

  async unassign(ref: string, assignmentId: string, reason: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.cargo.byRef(ref, tx, true)
      const [a] = await tx.update(cargoAgentAssignments).set({ status: "CANCELLED", cancelReason: reason, completedAt: new Date() }).where(and(eq(cargoAgentAssignments.id, assignmentId), eq(cargoAgentAssignments.cargoRequestId, r.id), inArray(cargoAgentAssignments.status, ["OFFERED", "ASSIGNED"]))).returning()
      if (!a) throw notFound("Assignment")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_request.agent_unassigned", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, after: { assignmentId, reason } })
      return { ok: true }
    })
  }

  // ---------------- Agent Dashboard ----------------

  private async me(actor: Actor) {
    const [a] = await this.db.select().from(cargoAgents).where(eq(cargoAgents.userId, actor.userId))
    if (!a?.active) throw notFound("Agent profile")
    return a
  }

  async myProfile(actor: Actor) {
    const a = await this.me(actor)
    return { agentCode: a.agentCode, displayName: a.displayName, publicName: publicAgentName(a), agentType: a.agentType, agentTypeLabel: AGENT_TYPE_LABELS[a.agentType as keyof typeof AGENT_TYPE_LABELS]?.en ?? a.agentType, responsibilities: a.responsibilities, vehicle: a.vehicle, company: a.company, hasPhoto: !!a.photoDocumentId, id: a.id }
  }

  async myPhoto(actor: Actor) {
    return this.photo((await this.me(actor)).id)
  }

  /** The agent's own assignment or 404, never another agent's (rule 4). */
  private async own(actor: Actor, assignmentId: string, tx: Db | Tx = this.db) {
    const a = await this.me(actor)
    const [j] = await tx.select().from(cargoAgentAssignments).where(and(eq(cargoAgentAssignments.id, assignmentId), eq(cargoAgentAssignments.agentId, a.id)))
    if (!j || j.status === "CANCELLED") throw notFound("Job")
    return { agent: a, j }
  }

  async myJobs(actor: Actor, scope: "open" | "done") {
    const a = await this.me(actor)
    const statuses = scope === "open" ? ["OFFERED", "ASSIGNED"] as const : ["COMPLETED", "FAILED", "DECLINED"] as const
    const rows = await this.db.select({ j: cargoAgentAssignments, r: cargoRequests }).from(cargoAgentAssignments).innerJoin(cargoRequests, eq(cargoRequests.id, cargoAgentAssignments.cargoRequestId))
      .where(and(eq(cargoAgentAssignments.agentId, a.id), inArray(cargoAgentAssignments.status, [...statuses]))).orderBy(scope === "open" ? asc(sql`coalesce(${cargoAgentAssignments.scheduledFor}, ${cargoAgentAssignments.assignedAt})`) : desc(cargoAgentAssignments.completedAt)).limit(100)
    const out = []
    for (const { j, r } of rows) out.push(await this.jobView(j, r))
    return { agent: await this.myProfile(actor), jobs: out }
  }

  async job(actor: Actor, assignmentId: string) {
    const { j } = await this.own(actor, assignmentId)
    const [r] = await this.db.select().from(cargoRequests).where(eq(cargoRequests.id, j.cargoRequestId))
    return this.jobView(j, r!)
  }

  private async jobView(j: Assignment, r: typeof cargoRequests.$inferSelect) {
    const records = await this.ops.records(r.id)
    const milestone = this.cargo.milestoneOf(r, records)
    const pieces = await this.db.select().from(cargoPieces).where(eq(cargoPieces.cargoRequestId, r.id))
    const items = await this.db.select().from(cargoItems).where(eq(cargoItems.cargoRequestId, r.id))
    const proofs = await this.db.select().from(cargoDeliveryProofs).where(eq(cargoDeliveryProofs.assignmentId, j.id)).orderBy(desc(cargoDeliveryProofs.capturedAt))
    const others = await this.db.select({ kind: cargoAgentAssignments.kind, code: cargoAgents.agentCode, name: cargoAgents.displayName }).from(cargoAgentAssignments).innerJoin(cargoAgents, eq(cargoAgents.id, cargoAgentAssignments.agentId))
      .where(and(eq(cargoAgentAssignments.cargoRequestId, r.id), ne(cargoAgentAssignments.id, j.id), inArray(cargoAgentAssignments.status, ["ASSIGNED", "COMPLETED"])))
    const names = await this.ops.agentNames(r.id)
    const s = r.shipper as Party
    const c = r.consignee as Party
    // An offered job shows the place and the work, not the contacts, until the agent accepts it.
    const accepted = j.status !== "OFFERED"
    const party = (p: Party) => ({ name: accepted ? p.name : p.name.split(/\s+/)[0]!, company: p.company ?? null, phone: accepted ? p.phone : "", email: accepted ? p.email ?? null : null, address: accepted ? fullAddress(p) : `${p.address.city}, ${p.address.country}`, city: p.address.city })
    const pickup = r.handoverMode === "PICKUP" ? party(s) : { name: "Uni Travel drop-off point", company: null, phone: "", email: null, address: "Customer drops off at the partner point", city: s.address.city }
    return {
      assignmentId: j.id, kind: j.kind, status: j.status, ref: r.ref, trackingNumber: r.trackingNumber, cargoStatus: r.status, milestone, milestoneLabel: CARGO_MILESTONE_LABELS[milestone].en, service: r.service,
      scheduledFor: j.scheduledFor?.toISOString() ?? null, attempts: j.attempts,
      pickup, dropoff: party(c),
      pieces: pieces.length, weightKg: Math.round(pieces.reduce((n, p) => n + (p.verifiedWeightKg ?? p.weightKg), 0) * 100) / 100,
      description: items.map((i) => `${i.quantity} × ${i.description}`).join(", "), handlingInstructions: r.handlingInstructions, readyDate: r.readyDate, preferredDeliveryDate: r.preferredDeliveryDate, note: j.note,
      actions: agentActions(j.kind as AssignmentKind, j.status, r.status, milestone),
      otherAgents: others.map((o) => ({ kind: o.kind, agentCode: o.code, name: o.name })),
      timeline: effectiveTimeline(records).reverse().map((t) => ({ label: this.ops.eventLabel(t.eventCode, names.has(t.id), "en"), location: t.location, occurredAt: t.occurredAt, description: t.description ?? null, agent: names.get(t.id) ?? null })),
      proofs: proofs.map((p) => ({ id: p.id, kind: p.kind, receiverName: p.receiverName, capturedAt: p.capturedAt.toISOString(), files: p.photoDocumentIds.length + (p.signatureDocumentId ? 1 : 0) })),
    }
  }

  /** Photo or signature for the agent's own job; stored INTERNAL, metadata stripped, scanned (ADR-0042 D9). */
  async upload(actor: Actor, assignmentId: string, body: { filename: string; data: string; purpose: "PHOTO" | "SIGNATURE" }) {
    const { j } = await this.own(actor, assignmentId)
    if (j.status !== "ASSIGNED") throw new AppError("INVALID_TRANSITION", "This job is not open")
    const [r] = await this.db.select().from(cargoRequests).where(eq(cargoRequests.id, j.cargoRequestId))
    const doc = await this.docs.storeImage({ ownerUserId: r!.customerUserId, requestType: "CARGO", requestId: r!.id, type: body.purpose === "SIGNATURE" ? "CARGO_SIGNATURE" : "CARGO_PHOTO", filename: body.filename, body: decodeImage(body.data), createdBy: actor.userId })
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_request.agent_file_uploaded", entityType: "cargo_request", entityId: r!.id, contextRef: r!.ref, after: { documentId: doc.id, purpose: body.purpose, assignmentId } }))
    return { documentId: doc.id }
  }

  /** Agent actions, each one checked against the assignment, the stage gate and (for state changes) the state machine. */
  async act(actor: Actor, assignmentId: string, action: AgentAction, body: Record<string, unknown>) {
    return this.uow.run(async (tx) => {
      const { agent, j } = await this.own(actor, assignmentId, tx)
      const r = await this.cargo.byRef((await tx.select({ ref: cargoRequests.ref }).from(cargoRequests).where(eq(cargoRequests.id, j.cargoRequestId)))[0]!.ref, tx, true)
      const milestone = this.cargo.milestoneOf(r, await this.ops.records(r.id))
      if (!agentActions(j.kind as AssignmentKind, j.status, r.status, milestone).includes(action)) throw new AppError("INVALID_TRANSITION", `“${action}” is not possible on this job now (${j.status}, ${r.status})`)
      const at = body.occurredAt ? new Date(String(body.occurredAt)) : new Date()
      if (at.getTime() > Date.now() + 5 * 60_000) throw new AppError("VALIDATION_FAILED", "The time cannot be in the future", [{ path: "occurredAt", code: "FUTURE" }])
      const location = String(body.location ?? "")
      const files = [...((body.photoDocumentIds as string[] | undefined) ?? []), ...(body.signatureDocumentId ? [String(body.signatureDocumentId)] : [])]
      await this.assertOwnFiles(r.id, files, actor.userId)
      const agentActor: MachineActor = { kind: "STAFF", userId: actor.userId, permissions: new Set(["cargo_job.agent"]) }
      const desc = body.description ? String(body.description) : undefined
      const ev = (code: TrackingEventCode, place: string, text?: string) => this.addEvent(tx, r, code, place, at, text, actor.userId, agent.id)
      const close = (status: "COMPLETED" | "FAILED", extra: Partial<Assignment> = {}) => tx.update(cargoAgentAssignments).set({ status, completedAt: new Date(), ...extra }).where(eq(cargoAgentAssignments.id, j.id))
      switch (action) {
        case "accept": {
          await tx.update(cargoAgentAssignments).set({ status: "ASSIGNED", acceptedAt: new Date() }).where(eq(cargoAgentAssignments.id, j.id))
          await this.announce(tx, r, { ...j, status: "ASSIGNED" }, agent, j.kind === "DELIVERY" ? (r.consignee as Party).address.city : (r.shipper as Party).address.city, j.scheduledFor?.toISOString() ?? null, actor.userId)
          break
        }
        case "decline": {
          await tx.update(cargoAgentAssignments).set({ status: "DECLINED", declinedAt: new Date(), declineReason: String(body.reason) }).where(eq(cargoAgentAssignments.id, j.id))
          await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r.id, eventType: "cargo.job_declined", payload: { requestId: r.id, ref: r.ref, staffUserId: j.assignedBy, agent: `${agent.agentCode} ${agent.displayName}`, kind: KIND_LABEL[j.kind as AssignmentKind].en, kind_fa: KIND_LABEL[j.kind as AssignmentKind].fa, reason: String(body.reason) } })
          break
        }
        case "note":
          await this.cargo.note(r.ref, { userId: actor.userId } as Actor, `[Agent ${agent.agentCode} ${agent.displayName}] ${String(body.body)}`)
          break
        case "report_problem": {
          const text = `[Problem · ${String(body.category)} · agent ${agent.agentCode} ${agent.displayName}] ${String(body.description)}`
          await this.cargo.note(r.ref, { userId: actor.userId } as Actor, text)
          if ((body.photoDocumentIds as string[] | undefined)?.length) await this.proof(tx, r.id, j.id, j.kind === "COLLECTION" ? "COLLECTION" : "DELIVERY", { location: "—", note: text, photoDocumentIds: body.photoDocumentIds as string[] }, actor.userId)
          await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r.id, eventType: "cargo.agent_problem", payload: { requestId: r.id, ref: r.ref, staffUserIds: [...new Set([j.assignedBy, r.assigneeUserId].filter(Boolean))], agent: `${agent.agentCode} ${agent.displayName}`, category: String(body.category), message: String(body.description) } })
          break
        }
        case "start_collection":
          await ev("COLLECTION_SCHEDULED", location, desc ?? "Agent on the way to collect")
          break
        case "collected":
          await ev("PICKED_UP", location, desc)
          await this.proof(tx, r.id, j.id, "COLLECTION", { receiverName: String(body.handedOverBy), location, note: desc, signatureDocumentId: body.signatureDocumentId as string | undefined, photoDocumentIds: (body.photoDocumentIds as string[]) ?? [] }, actor.userId)
          await close("COMPLETED")
          break
        case "collection_failed": {
          const reason = String(body.reason) as keyof typeof FAILURE_REASON_LABELS
          await ev("COLLECTION_FAILED", location, `${FAILURE_REASON_LABELS[reason].en}${desc ? `: ${desc}` : ""}`)
          if ((body.photoDocumentIds as string[] | undefined)?.length) await this.proof(tx, r.id, j.id, "COLLECTION", { location, note: `Failed: ${FAILURE_REASON_LABELS[reason].en}`, photoDocumentIds: body.photoDocumentIds as string[] }, actor.userId)
          await close("FAILED", { attempts: j.attempts + 1 })
          break
        }
        case "handled":
          await ev("HANDLED", location, desc)
          break
        case "at_sorting_facility":
          await ev("SORTING_FACILITY", location)
          break
        case "handling_done":
          await close("COMPLETED", { note: desc ? `${j.note ? `${j.note}\n` : ""}Done: ${desc}` : j.note })
          break
        case "out_for_delivery": {
          // From IN_TRANSIT this is the state change; after a failed attempt it is a new attempt in the same state.
          if (r.status === "IN_TRANSIT") await this.cargo.transition(tx, r, "out_for_delivery", agentActor, { facts: { assignedAgent: true } })
          await ev("OUT_FOR_DELIVERY", location, j.attempts > 0 ? `Delivery attempt ${j.attempts + 1}` : undefined)
          break
        }
        case "delivered": {
          await this.cargo.transition(tx, r, "deliver", agentActor, { facts: { assignedAgent: true, podName: String(body.receiverName) } })
          await ev("DELIVERED", location, `Received by ${String(body.receiverName)}`)
          await this.proof(tx, r.id, j.id, "DELIVERY", { receiverName: String(body.receiverName), location, note: desc, signatureDocumentId: body.signatureDocumentId as string | undefined, photoDocumentIds: (body.photoDocumentIds as string[]) ?? [] }, actor.userId)
          await close("COMPLETED")
          // Other delivery agents on the same shipment have nothing left to do.
          await tx.update(cargoAgentAssignments).set({ status: "CANCELLED", cancelReason: `Delivered by ${agent.agentCode}`, completedAt: new Date() }).where(and(eq(cargoAgentAssignments.cargoRequestId, r.id), eq(cargoAgentAssignments.kind, "DELIVERY"), ne(cargoAgentAssignments.id, j.id), inArray(cargoAgentAssignments.status, ["OFFERED", "ASSIGNED"])))
          break
        }
        case "delivery_failed": {
          const reason = String(body.reason) as keyof typeof FAILURE_REASON_LABELS
          const attempts = j.attempts + 1
          await ev("DELIVERY_FAILED", location, `${FAILURE_REASON_LABELS[reason].en}${desc ? `: ${desc}` : ""} (attempt ${attempts})`)
          if ((body.photoDocumentIds as string[] | undefined)?.length) await this.proof(tx, r.id, j.id, "DELIVERY", { location, note: `Failed attempt ${attempts}: ${FAILURE_REASON_LABELS[reason].en}`, photoDocumentIds: body.photoDocumentIds as string[] }, actor.userId)
          // After the last allowed attempt the job closes and staff decide (re-deliver, hold or return to sender).
          await tx.update(cargoAgentAssignments).set({ attempts, ...(attempts >= MAX_DELIVERY_ATTEMPTS ? { status: "FAILED" as const, completedAt: new Date() } : {}) }).where(eq(cargoAgentAssignments.id, j.id))
          break
        }
      }
      // Every agent update names the agent (ADR-0043 D4): the audit row carries the agent ID next to the user.
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: `cargo_request.agent_${action}`, entityType: "cargo_request", entityId: r.id, contextRef: r.ref, after: { agentCode: agent.agentCode, assignmentId: j.id, kind: j.kind, location: location || undefined, reason: body.reason ?? body.category, files: files.length } })
      if (!["note", "report_problem", "decline"].includes(action)) await this.milestoneCheck(tx, r)
      return { ok: true }
    }).then(() => this.job(actor, assignmentId))
  }

  /** Uploaded by this agent for this shipment, and clean or still being scanned. */
  private async assertOwnFiles(requestId: string, ids: string[], userId: string) {
    for (const id of ids) {
      const doc = await this.docs.get(id)
      if (!doc || doc.requestType !== "CARGO" || doc.requestId !== requestId || doc.createdBy !== userId || doc.scanStatus === "INFECTED") throw new AppError("VALIDATION_FAILED", "Attachment not found for this job", [{ path: "documentId", code: "NOT_FOUND" }])
    }
  }

  private async proof(tx: Tx, requestId: string, assignmentId: string, kind: "COLLECTION" | "DELIVERY", p: { receiverName?: string; location: string; note?: string; signatureDocumentId?: string; photoDocumentIds: string[] }, userId: string) {
    await tx.insert(cargoDeliveryProofs).values({ cargoRequestId: requestId, assignmentId, kind, receiverName: p.receiverName ?? null, signatureDocumentId: p.signatureDocumentId ?? null, photoDocumentIds: p.photoDocumentIds, location: p.location, note: p.note ?? null, capturedBy: userId })
  }

  /** Same stage gate as staff entry (ADR-0008 W4), same ingest path; the event carries the agent. */
  private async addEvent(tx: Tx, r: typeof cargoRequests.$inferSelect, code: TrackingEventCode, location: string, at: Date, description: string | undefined, userId: string, agentId: string) {
    const stage = r.status === "EXCEPTION" ? ((r.exceptionResumeTo as typeof r.status | null) ?? "RECEIVED") : r.status
    // A delivery transition already moved the row in this transaction; re-read the status for the gate.
    const [cur] = await tx.select({ status: cargoRequests.status }).from(cargoRequests).where(eq(cargoRequests.id, r.id))
    const why = trackingEventAllowed(code, (cur?.status ?? stage) === "EXCEPTION" ? stage : cur?.status ?? stage)
    if (why) throw new AppError("INVALID_TRANSITION", why)
    await this.cargo.recordEvent(tx, r, code, location, at, description, userId, agentId)
  }

  private async milestoneCheck(tx: Tx, r: typeof cargoRequests.$inferSelect, key?: string) {
    await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r.id, eventType: "cargo.milestone_check", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, ...(key ? { key } : {}) } })
  }
}
