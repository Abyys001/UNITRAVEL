import { createHash } from "node:crypto"

import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, gte, ilike, lte, lt, or, sql } from "drizzle-orm"

import { auditLog, type Db, type DbOrTx } from "@unitravel/db"

import { DB } from "../../core/infra.module"

export interface AuditEntry {
  actorUserId?: string | null
  actorKind: "CUSTOMER" | "STAFF" | "SYSTEM" | "ANONYMOUS"
  action: string
  entityType: string
  entityId?: string | null
  contextRef?: string | null
  before?: unknown
  after?: unknown
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
}

const PERSONAL = /(phone|email|givenname|surname|name_?fa|namefa|passport|documentnumber|^number$|payername|address|idnumber|dateofbirth|value_?normalised|valuenormalised)/i

/** Phone numbers keep the country code and the last two digits; other personal fields are masked (ch. 28.5). */
export function maskValue(key: string, v: unknown): unknown {
  if (typeof v !== "string") return v
  if (/phone|valuenormalised/i.test(key) && /^\+\d+$/.test(v)) return `${v.slice(0, v.startsWith("+98") || v.startsWith("+44") ? 3 : 4)}${"•".repeat(Math.max(0, v.length - 6))}${v.slice(-2)}`
  if (/email/i.test(key) && v.includes("@")) return `${v[0]}•••@${v.split("@")[1]}`
  return v.length <= 2 ? "••" : `${v[0]}${"•".repeat(Math.min(6, v.length - 1))}`
}

export function maskPersonal(input: unknown, depth = 0): unknown {
  if (depth > 6 || input === null || input === undefined) return input
  if (Array.isArray(input)) return input.map((x) => maskPersonal(x, depth + 1))
  if (typeof input === "object") {
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, PERSONAL.test(k) && (typeof v === "string") ? maskValue(k, v) : maskPersonal(v, depth + 1)]))
  }
  return input
}

export function chainHash(prev: string, e: Omit<AuditEntry, "before" | "after"> & { before: unknown; after: unknown; occurredAt: string }): string {
  return createHash("sha256").update(prev).update(JSON.stringify([e.occurredAt, e.actorUserId ?? null, e.actorKind, e.action, e.entityType, e.entityId ?? null, e.contextRef ?? null, e.before ?? null, e.after ?? null])).digest("hex")
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Append-only, hash-chained (tamper-evident). Runs inside the caller's transaction so it commits with the change. */
  async record(tx: DbOrTx, entry: AuditEntry): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('audit_chain'))`)
    const last = await tx.select({ hash: auditLog.hash }).from(auditLog).orderBy(desc(auditLog.id)).limit(1)
    const prevHash = last[0]?.hash ?? "0".repeat(64)
    const occurredAt = new Date()
    const before = maskPersonal(entry.before ?? null)
    const after = maskPersonal(entry.after ?? null)
    const hash = chainHash(prevHash, { ...entry, before, after, occurredAt: occurredAt.toISOString() })
    await tx.insert(auditLog).values({
      occurredAt, actorUserId: entry.actorUserId ?? null, actorKind: entry.actorKind, action: entry.action, entityType: entry.entityType,
      entityId: entry.entityId ?? null, contextRef: entry.contextRef ?? null, before, after, ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 400) ?? null, requestId: entry.requestId ?? null, prevHash, hash,
    })
  }

  async query(q: { actor?: string; action?: string; entityType?: string; ref?: string; from?: string; to?: string; limit: number; cursor?: string }) {
    const where = [
      q.actor ? eq(auditLog.actorUserId, q.actor) : undefined,
      q.action ? ilike(auditLog.action, `${q.action}%`) : undefined,
      q.entityType ? eq(auditLog.entityType, q.entityType) : undefined,
      q.ref ? or(eq(auditLog.contextRef, q.ref.toUpperCase()), eq(auditLog.entityId, q.ref)) : undefined,
      q.from ? gte(auditLog.occurredAt, new Date(q.from)) : undefined,
      q.to ? lte(auditLog.occurredAt, new Date(q.to)) : undefined,
      q.cursor ? lt(auditLog.id, Number(q.cursor)) : undefined,
    ].filter(Boolean)
    const rows = await this.db.select().from(auditLog).where(where.length ? and(...where) : undefined).orderBy(desc(auditLog.id)).limit(q.limit + 1)
    return { items: rows.slice(0, q.limit), nextCursor: rows.length > q.limit ? String(rows[q.limit - 1]!.id) : null }
  }

  /** Recomputes the chain; returns the first broken id, if any. */
  async verify(): Promise<{ ok: boolean; checked: number; brokenAt: number | null }> {
    const rows = await this.db.select().from(auditLog).orderBy(auditLog.id)
    let prev = "0".repeat(64)
    for (const r of rows) {
      const h = chainHash(prev, { ...r, before: r.before, after: r.after, occurredAt: r.occurredAt.toISOString() })
      if (r.prevHash !== prev || r.hash !== h) return { ok: false, checked: rows.length, brokenAt: r.id }
      prev = r.hash
    }
    return { ok: true, checked: rows.length, brokenAt: null }
  }
}
