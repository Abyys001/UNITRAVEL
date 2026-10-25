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

/** Recursively key-sorted JSON so the hash does not depend on key order, which jsonb does not preserve. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"
  if (typeof (v as { toJSON?: unknown }).toJSON === "function") return canonicalJson((v as { toJSON(): unknown }).toJSON())
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`
}

export const AUDIT_HASH_VERSION = 2

type ChainInput = Omit<AuditEntry, "before" | "after"> & { before: unknown; after: unknown; occurredAt: string }

/** Version 1 is kept only to re-check rows written before the canonical form; do not use it for new rows. */
export function chainHash(prev: string, e: ChainInput, version: number = AUDIT_HASH_VERSION): string {
  const body = [e.occurredAt, e.actorUserId ?? null, e.actorKind, e.action, e.entityType, e.entityId ?? null, e.contextRef ?? null, e.before ?? null, e.after ?? null]
  return createHash("sha256").update(prev).update(version >= 2 ? canonicalJson(body) : JSON.stringify(body)).digest("hex")
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
      userAgent: entry.userAgent?.slice(0, 400) ?? null, requestId: entry.requestId ?? null, prevHash, hash, hashVersion: AUDIT_HASH_VERSION,
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

  /**
   * Recomputes the chain. Every row's link to its predecessor is checked. Version 2 rows are also content-checked. Version 1 rows
   * (before the canonical form) whose content hash no longer reproduces are reported as legacyUnverifiable, never as intact.
   */
  async verify(): Promise<{ ok: boolean; checked: number; brokenAt: number | null; verified: number; legacyUnverifiable: number; firstLegacyUnverifiable: number | null }> {
    const rows = await this.db.select().from(auditLog).orderBy(auditLog.id)
    let prev = "0".repeat(64)
    let legacy = 0
    let firstLegacy: number | null = null
    for (const r of rows) {
      const input = { ...r, before: r.before, after: r.after, occurredAt: r.occurredAt.toISOString() }
      const contentOk = chainHash(prev, input, r.hashVersion) === r.hash
      if (r.prevHash !== prev || (!contentOk && r.hashVersion >= 2)) return { ok: false, checked: rows.length, brokenAt: r.id, verified: rows.length - legacy, legacyUnverifiable: legacy, firstLegacyUnverifiable: firstLegacy }
      if (!contentOk) { legacy++; firstLegacy ??= r.id }
      prev = r.hash
    }
    return { ok: true, checked: rows.length, brokenAt: null, verified: rows.length - legacy, legacyUnverifiable: legacy, firstLegacyUnverifiable: firstLegacy }
  }
}
