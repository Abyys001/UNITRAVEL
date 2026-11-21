import { Inject, Injectable } from "@nestjs/common"
import bwipjs from "bwip-js"
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm"

import { agentSignInCodes, cargoAgentAssignments, cargoAgents, cargoRequests, type Db, roles, userRoles, users } from "@unitravel/db"

import { randomToken, sha256 } from "../../core/crypto"
import { env } from "../../core/env"
import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { type IssuedTokens, SessionsService } from "../identity/sessions.service"

const CODE_TTL_MS = 10 * 60_000
/** Roles a QR sign-in may open. Anything else (admin, owner, finance…) must sign in with its second factor (ADR-0045 D2). */
const QR_ROLES = new Set(["agent", "customer"])

/** ADR-0045: agent sign-in QR codes and the agent's scan lookup. */
@Injectable()
export class AgentSignInService {
  constructor(@Inject(DB) private readonly db: Db, private readonly audit: AuditService, private readonly sessions: SessionsService) {}

  private async rolesOf(userId: string, tx: Pick<Db, "select"> = this.db) {
    const rows = await tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId))
    return rows.map((r) => r.key)
  }

  private qrEligible(keys: string[]) {
    return keys.includes("agent") && keys.every((k) => QR_ROLES.has(k))
  }

  /** Staff create a code; earlier unused codes for the agent stop working. */
  async issue(agentId: string, actor: Actor, ctx: { ip?: string; requestId?: string }) {
    const [a] = await this.db.select().from(cargoAgents).where(eq(cargoAgents.id, agentId))
    if (!a) throw notFound("Agent")
    if (!a.active) throw new AppError("VALIDATION_FAILED", "This agent is deactivated")
    if (!this.qrEligible(await this.rolesOf(a.userId))) throw new AppError("VALIDATION_FAILED", "This account has other staff roles; it must sign in with its own second factor")
    const code = randomToken(32)
    const expiresAt = new Date(Date.now() + CODE_TTL_MS)
    await this.db.transaction(async (tx) => {
      await tx.update(agentSignInCodes).set({ usedAt: new Date() }).where(and(eq(agentSignInCodes.agentId, a.id), isNull(agentSignInCodes.usedAt)))
      const [row] = await tx.insert(agentSignInCodes).values({ agentId: a.id, tokenHash: sha256(code), expiresAt, createdBy: actor.userId }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_agent.sign_in_code_issued", entityType: "cargo_agent", entityId: a.id, contextRef: a.agentCode, after: { codeId: row!.id, expiresAt: expiresAt.toISOString() }, ip: ctx.ip, requestId: ctx.requestId })
    })
    // The code rides in the fragment, so it never reaches a server or proxy log.
    const url = `${env().PUBLIC_CONSOLE_ADMIN_URL}/agent-sign-in#${code}`
    const qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: url, paddingwidth: 2, paddingheight: 2 })
    return { url, expiresAt: expiresAt.toISOString(), qrSvg }
  }

  /** Consumes the code atomically and opens a console session for the agent. */
  async redeem(code: string, input: { deviceId?: string; ip?: string; userAgent?: string; requestId?: string }): Promise<IssuedTokens> {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.update(agentSignInCodes).set({ usedAt: new Date() })
        .where(and(eq(agentSignInCodes.tokenHash, sha256(code)), isNull(agentSignInCodes.usedAt), gt(agentSignInCodes.expiresAt, sql`now()`))).returning()
      if (!c) throw new AppError("UNAUTHENTICATED", "This QR code has expired or was already used. Ask for a new one.")
      const [a] = await tx.select().from(cargoAgents).where(eq(cargoAgents.id, c.agentId))
      const [u] = a ? await tx.select().from(users).where(eq(users.id, a.userId)) : []
      if (!a?.active || !u || u.status !== "ACTIVE" || !this.qrEligible(await this.rolesOf(a.userId, tx))) throw new AppError("UNAUTHENTICATED", "This QR code cannot be used. Ask for a new one.")
      // Issued in person by staff who passed their own second factor; single use, 10 minutes (ADR-0045 D2).
      const tokens = await this.sessions.create(tx, { userId: a.userId, client: "CONSOLE", deviceId: input.deviceId, ip: input.ip, userAgent: input.userAgent, mfaSatisfied: true })
      await tx.update(agentSignInCodes).set({ sessionId: tokens.sessionId }).where(eq(agentSignInCodes.id, c.id))
      await this.audit.record(tx, { actorUserId: a.userId, actorKind: "STAFF", action: "user.signed_in_agent_code", entityType: "session", entityId: tokens.sessionId, contextRef: a.agentCode, after: { client: "CONSOLE", codeId: c.id, issuedBy: c.createdBy }, ip: input.ip, userAgent: input.userAgent, requestId: input.requestId })
      return tokens
    })
  }

  /** The signed-in agent's own open jobs for a scanned tracking number; 404 for anything else (rule 4). */
  async jobsByTracking(actor: Actor, trackingNumber: string) {
    const [a] = await this.db.select().from(cargoAgents).where(eq(cargoAgents.userId, actor.userId))
    if (!a?.active) throw notFound("Agent profile")
    const rows = await this.db.select({ id: cargoAgentAssignments.id, kind: cargoAgentAssignments.kind, status: cargoAgentAssignments.status, ref: cargoRequests.ref })
      .from(cargoAgentAssignments).innerJoin(cargoRequests, eq(cargoRequests.id, cargoAgentAssignments.cargoRequestId))
      .where(and(eq(cargoRequests.trackingNumber, trackingNumber), eq(cargoAgentAssignments.agentId, a.id), inArray(cargoAgentAssignments.status, ["OFFERED", "ASSIGNED"])))
    if (!rows.length) throw notFound("Job")
    const order = { COLLECTION: 0, HANDLING: 1, DELIVERY: 2 } as const
    return { trackingNumber, jobs: rows.sort((x, y) => order[x.kind] - order[y.kind]).map((r) => ({ assignmentId: r.id, kind: r.kind, status: r.status, ref: r.ref })) }
  }
}
