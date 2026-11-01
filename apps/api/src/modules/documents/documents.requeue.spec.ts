import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

import { DocumentsService, STUCK_SCAN_AFTER_MS } from "./documents.service"

type Handler = (job: { data: unknown }) => Promise<unknown>

/** Just enough of the collaborators to see what the requeue selects and what it puts on the queue. */
function setup(rows: { id: string }[]) {
  let where: SQL | undefined
  const limit = vi.fn(async () => rows)
  const db = { select: () => ({ from: () => ({ where: (w: SQL) => { where = w; return { limit } } }) }) }
  const add = vi.fn(async () => undefined)
  const upsertJobScheduler = vi.fn(async () => undefined)
  const handlers = new Map<string, Handler>()
  const workers = { register: (q: string, h: Handler) => handlers.set(q, h), registerJob: (_q: string, name: string, h: Handler) => handlers.set(name, h) }
  const queues = { get: () => ({ add, upsertJobScheduler }) }
  const svc = new (DocumentsService as unknown as new (...a: unknown[]) => DocumentsService)(db, {}, {}, workers, {}, queues, {})
  return { svc, add, upsertJobScheduler, handlers, limit, whereSql: () => new PgDialect().sqlToQuery(where!) }
}

describe("stuck virus scans", () => {
  const now = new Date("2026-11-01T15:00:00Z")

  it("selects only finished uploads, still pending, not erased, older than the retry window", async () => {
    const { svc, whereSql } = setup([])
    await svc.requeueStuckScans(now)
    const { sql, params } = whereSql()
    expect(sql).toContain('"scanStatus" = $1')
    expect(params[0]).toBe("PENDING")
    expect(sql).toContain('"uploadCompletedAt" is not null')
    expect(sql).toContain('"erasedAt" is null')
    expect(sql).toContain('"uploadCompletedAt" <')
    expect(params[1]).toEqual(new Date(now.getTime() - STUCK_SCAN_AFTER_MS).toISOString())
  })

  it("queues nothing when no upload is stuck", async () => {
    const { svc, add } = setup([])
    expect(await svc.requeueStuckScans(now)).toBe(0)
    expect(add).not.toHaveBeenCalled()
  })

  it("queues a job the scan worker can read, which reaches scan() for that document", async () => {
    const { svc, add, handlers } = setup([{ id: "doc-1" }])
    await svc.onModuleInit()
    const scan = vi.spyOn(svc, "scan").mockResolvedValue(undefined)
    expect(await svc.requeueStuckScans(now)).toBe(1)
    const [, data] = add.mock.calls[0] as unknown as [string, unknown]
    await handlers.get("documents.scan")!({ data })
    expect(scan).toHaveBeenCalledWith("doc-1")
  })

  it("uses a new job id each window, so a failed attempt never blocks the next one, and the same id within a window", async () => {
    const { svc, add } = setup([{ id: "doc-1" }])
    const jobId = async (at: Date) => {
      add.mockClear()
      await svc.requeueStuckScans(at)
      return ((add.mock.calls[0] as unknown as [string, unknown, { jobId: string }])[2]).jobId
    }
    const first = await jobId(now)
    expect(await jobId(new Date(now.getTime() + 1000))).toBe(first)
    expect(await jobId(new Date(now.getTime() + STUCK_SCAN_AFTER_MS))).not.toBe(first)
    expect(first).not.toContain(":")
  })

  it("runs on a schedule", async () => {
    const { svc, handlers, upsertJobScheduler } = setup([])
    await svc.onModuleInit()
    expect(handlers.has("documents.scan-requeue")).toBe(true)
    expect(upsertJobScheduler).toHaveBeenCalledWith("documents-scan-requeue-every-10m", { every: STUCK_SCAN_AFTER_MS }, { name: "documents.scan-requeue" })
  })
})
