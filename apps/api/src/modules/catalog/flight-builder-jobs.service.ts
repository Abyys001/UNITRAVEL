import { Injectable, Logger, type OnModuleInit } from "@nestjs/common"

import type { SyncInterval } from "@unitravel/contracts"

import { Queues } from "../../core/queues"
import { WorkerRegistry } from "../../core/workers"
import { FlightBuilderService } from "./flight-builder.service"

export const FB_JOBS = { freshness: "flight-builder.freshness", sync: "flight-builder.sync" } as const
const FRESHNESS_EVERY_MS = 15 * 60_000
const INTERVAL_MS: Record<SyncInterval, number> = { HOURLY: 3_600_000, DAILY: 86_400_000, WEEKLY: 7 * 86_400_000 }

/**
 * ADR-0037 D9-D10 jobs on the catalog queue. The freshness sweep needs no provider. The sync job exists only while sync mode is SCHEDULED
 * (which settings refuse without an authorisation and an adapter) and, whenever it runs, writes a BLOCKED run and returns: nothing is called.
 */
@Injectable()
export class FlightBuilderJobsService implements OnModuleInit {
  private readonly log = new Logger("FlightBuilderJobs")

  constructor(private readonly queues: Queues, private readonly workers: WorkerRegistry, private readonly fb: FlightBuilderService) {}

  async onModuleInit() {
    this.workers.registerJob("catalog", FB_JOBS.freshness, () => this.fb.sweepFreshness())
    this.workers.registerJob("catalog", FB_JOBS.sync, async () => {
      const { run, reason } = await this.fb.recordBlockedRun("SCHEDULED", {}, null)
      return { blocked: reason, runId: run.id }
    })
    await this.queues.get("catalog").upsertJobScheduler("flight-builder-freshness", { every: FRESHNESS_EVERY_MS }, { name: FB_JOBS.freshness, data: {} })
      .catch((err) => this.log.warn({ err: String(err) }, "freshness sweep not registered"))
    await this.applySchedule().catch((err) => this.log.warn({ err: String(err) }, "sync schedule not applied"))
  }

  /** Upserts or removes the sync scheduler to match the stored settings. Called at start and after every settings change. */
  async applySchedule(): Promise<void> {
    const s = await this.fb.settings()
    const q = this.queues.get("catalog")
    if (s.syncMode === "SCHEDULED") await q.upsertJobScheduler("flight-builder-sync", { every: INTERVAL_MS[s.syncInterval] }, { name: FB_JOBS.sync, data: {} })
    else await q.removeJobScheduler("flight-builder-sync")
  }
}
