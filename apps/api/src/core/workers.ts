import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common"
import { type Job, Worker } from "bullmq"

import { type Db, jobRuns } from "@unitravel/db"

import { DB } from "./infra.module"
import { type QueueName, redisConnection } from "./queues"
import { scrubMessage } from "./safe-error"

export const PROCESS_ROLE = Symbol("PROCESS_ROLE")
export type ProcessRole = "api" | "worker"

type Handler = (job: Job) => Promise<unknown>

/**
 * BullMQ consumers live only in the worker process role (ADR-01). Modules register their handlers; the registry
 * starts one Worker per queue with the concurrency from Table 26.2.
 */
@Injectable()
export class WorkerRegistry implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("Workers")
  private readonly handlers = new Map<QueueName, { handler: Handler; concurrency: number }>()
  private readonly named = new Map<QueueName, Map<string, Handler>>()
  private readonly workers: Worker[] = []

  constructor(@Inject(PROCESS_ROLE) private readonly role: ProcessRole, @Inject(DB) private readonly db: Db) {}

  register(queue: QueueName, handler: Handler, concurrency = 5) {
    this.handlers.set(queue, { handler, concurrency })
  }

  /** Shared queues (maintenance) carry jobs from several modules; each module registers its job by name. */
  registerJob(queue: QueueName, name: string, handler: Handler) {
    const named = this.named.get(queue) ?? new Map<string, Handler>()
    named.set(name, handler)
    if (!this.named.has(queue)) {
      this.named.set(queue, named)
      this.register(queue, async (job) => {
        const h = named.get(job.name)
        if (!h) throw new Error(`No handler for ${queue}/${job.name}`)
        return h(job)
      }, 1)
    }
  }

  onApplicationBootstrap() {
    if (this.role !== "worker") return
    for (const [queue, { handler, concurrency }] of this.handlers) {
      const w = new Worker(queue, async (job) => {
        const started = Date.now()
        try {
          const r = await handler(job)
          if (queue === "maintenance" || queue === "compliance.lists-sync" || queue === "reference.sync") await this.db.insert(jobRuns).values({ queue, name: job.name, status: "OK", durationMs: Date.now() - started, detail: (r ?? null) as never })
          return r
        } catch (err) {
          // BullMQ keeps err.message as the job's failedReason (shown in the Developer Panel): scrub it in place so the
          // error class (and with it retry behaviour) is kept.
          if (err instanceof Error) err.message = scrubMessage(err.message)
          if (queue === "maintenance" || queue === "compliance.lists-sync" || queue === "reference.sync") await this.db.insert(jobRuns).values({ queue, name: job.name, status: "FAILED", durationMs: Date.now() - started, detail: { error: String(err) } })
          throw err
        }
      }, { connection: redisConnection(), concurrency })
      w.on("failed", (job, err) => this.log.warn({ queue, job: job?.name, attempts: job?.attemptsMade, err: scrubMessage(err.message) }, "job failed"))
      this.workers.push(w)
    }
    this.log.log({ queues: [...this.handlers.keys()] }, "workers started")
  }

  async onApplicationShutdown() {
    await Promise.all(this.workers.map((w) => w.close()))
  }
}
