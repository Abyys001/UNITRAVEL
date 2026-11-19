import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common"

import { Queues } from "../../core/queues"
import { PROCESS_ROLE, type ProcessRole, WorkerRegistry } from "../../core/workers"
import { safeError } from "../../core/safe-error"
import type { DispatchedEvent } from "./outbox.dispatcher"

type TimerHandler = (data: Record<string, unknown>) => Promise<unknown>
type EventHandler = (e: DispatchedEvent) => Promise<unknown>
/** Re-derives the timers that should exist from the database; returns how many it (re)scheduled. */
type ReconcileHandler = () => Promise<number>

/** Deterministic job id per request + timer kind. BullMQ rejects custom ids containing ':', so `fr:<id>` becomes `fr-<id>`. */
export const timerJobId = (kind: string, key: string) => `${key.replaceAll(":", "-")}--${kind}`

/**
 * SLA reminders and deadlines are delayed BullMQ jobs keyed by request id + timer type (ch. 26.2). A state change
 * removes timers that no longer apply and schedules new ones; each job re-checks the state when it fires, so a
 * missed removal is harmless. The database is the source of truth: if Valkey loses the delayed jobs, the reconcile
 * (worker start-up and every 10 minutes) re-adds the missing ones under the same job ids.
 */
@Injectable()
export class TimersService implements OnModuleInit, OnApplicationBootstrap {
  private readonly log = new Logger("Timers")
  private readonly timers = new Map<string, TimerHandler>()
  private readonly events = new Map<string, EventHandler[]>()
  private readonly reconcilers: ReconcileHandler[] = []

  constructor(private readonly queues: Queues, private readonly workers: WorkerRegistry, @Inject(PROCESS_ROLE) private readonly role: ProcessRole) {}

  async onModuleInit() {
    this.workers.register("timers.sla", async (job) => {
      if (job.name.startsWith("timer:")) {
        const h = this.timers.get(job.name.slice(6))
        return h ? h(job.data as Record<string, unknown>) : undefined
      }
      for (const h of this.events.get(job.name) ?? []) await h(job.data as DispatchedEvent)
    }, 10)
    this.workers.registerJob("maintenance", "timers.reconcile", () => this.reconcile())
    await this.queues.get("maintenance").upsertJobScheduler("timers-reconcile-every-10m", { every: 10 * 60_000 }, { name: "timers.reconcile" }).catch(() => undefined)
  }

  onApplicationBootstrap() {
    if (this.role !== "worker") return
    void this.reconcile().catch((err: unknown) => this.log.error({ err: safeError(err) }, "timer reconcile failed"))
  }

  onReconcile(h: ReconcileHandler) {
    this.reconcilers.push(h)
  }

  async reconcile() {
    let scheduled = 0
    for (const h of this.reconcilers) scheduled += await h()
    this.log.log({ scheduled }, "timers reconciled")
    return { scheduled }
  }

  onTimer(kind: string, h: TimerHandler) {
    this.timers.set(kind, h)
  }

  onEvent(type: string, h: EventHandler) {
    this.events.set(type, [...(this.events.get(type) ?? []), h])
  }

  async schedule(kind: string, key: string, at: Date, data: Record<string, unknown>) {
    const q = this.queues.get("timers.sla")
    const jobId = timerJobId(kind, key)
    const existing = await q.getJob(jobId)
    if (existing) await existing.remove().catch(() => undefined)
    await q.add(`timer:${kind}`, data, { jobId, delay: Math.max(0, at.getTime() - Date.now()) })
  }

  /** Adds the timer only if no job with its id exists in any state, so a reconcile never duplicates or re-fires one. */
  async ensure(kind: string, key: string, at: Date, data: Record<string, unknown>): Promise<boolean> {
    const q = this.queues.get("timers.sla")
    const jobId = timerJobId(kind, key)
    if (await q.getJob(jobId)) return false
    await q.add(`timer:${kind}`, data, { jobId, delay: Math.max(0, at.getTime() - Date.now()) })
    return true
  }

  async cancel(kind: string, key: string) {
    const job = await this.queues.get("timers.sla").getJob(timerJobId(kind, key))
    if (job) await job.remove().catch(() => undefined)
  }

  async cancelAll(key: string, kinds: string[]) {
    for (const k of kinds) await this.cancel(k, key)
  }
}
