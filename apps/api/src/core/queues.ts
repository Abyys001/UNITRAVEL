import { Injectable, type OnModuleDestroy } from "@nestjs/common"
import { type JobsOptions, Queue } from "bullmq"

import { env } from "./env"

// Chapter 26.2 — queues. Names follow the booklet; BullMQ forbids ':' so dots are used.
export const QUEUES = [
  "search.execute", "supplier.call", "notify.route", "notify.sms", "notify.push", "notify.email", "notify.escalate",
  "timers.sla", "compliance.screen", "compliance.lists-sync", "reference.sync", "documents.scan", "maintenance", "events.misc",
] as const
export type QueueName = (typeof QUEUES)[number]

export function redisConnection() {
  const u = new URL(env().REDIS_URL)
  return { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined, maxRetriesPerRequest: null as null }
}

/** Retries per queue (Table 26.2): notifications 5 with exponential back-off, then the dead-letter set. */
export const QUEUE_DEFAULTS: Record<QueueName, JobsOptions> = {
  "search.execute": { attempts: 1, removeOnComplete: 500, removeOnFail: 500 },
  "supplier.call": { attempts: 2, backoff: { type: "exponential", delay: 300 }, removeOnComplete: 1000 },
  "notify.route": { attempts: 5, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 2000, removeOnFail: false },
  "notify.sms": { attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 2000, removeOnFail: false },
  "notify.push": { attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 2000, removeOnFail: false },
  "notify.email": { attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 2000, removeOnFail: false },
  "notify.escalate": { attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 2000, removeOnFail: false },
  "timers.sla": { attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 2000, removeOnFail: false },
  "compliance.screen": { attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 2000, removeOnFail: false },
  "compliance.lists-sync": { attempts: 5, backoff: { type: "exponential", delay: 60000 }, removeOnComplete: 100, removeOnFail: false },
  "reference.sync": { attempts: 5, backoff: { type: "exponential", delay: 60000 }, removeOnComplete: 100, removeOnFail: false },
  "documents.scan": { attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 1000, removeOnFail: false },
  maintenance: { attempts: 3, removeOnComplete: 100, removeOnFail: false },
  "events.misc": { attempts: 5, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 2000, removeOnFail: false },
}

@Injectable()
export class Queues implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>()

  get(name: QueueName): Queue {
    let q = this.queues.get(name)
    if (!q) {
      q = new Queue(name, { connection: redisConnection(), defaultJobOptions: QUEUE_DEFAULTS[name] })
      this.queues.set(name, q)
    }
    return q
  }

  all(): Queue[] {
    return QUEUES.map((n) => this.get(n))
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((q) => q.close()))
  }
}
