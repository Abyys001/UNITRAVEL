import { z } from "zod"

import { Iata, IsoDateTime, Uuid } from "./common"
import { ConfigDomain, ConfigVersionStatus, ProviderEnv, ProviderId, UserStatus } from "./enums"
import { PERMISSIONS } from "./permissions"
import { SearchQuery } from "./search"

export const DevUserListItem = z.object({
  id: Uuid, displayName: z.string(), status: UserStatus, roles: z.array(z.string()), primaryPhone: z.string().nullable(), email: z.string().nullable(),
  phoneVerified: z.boolean(), lastActiveAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
})
export const DevUsersQuery = z.object({
  q: z.string().max(120).optional(), role: z.string().optional(), status: UserStatus.optional(), verified: z.enum(["yes", "no"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().optional(),
})
export const ReplaceRolesBody = z.object({ roles: z.array(z.string().min(1)).max(20) })
export const RoleBody = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/), name: z.string().min(2).max(80), permissions: z.array(z.enum(PERMISSIONS)).min(1), clonedFrom: z.string().optional(),
})
export const RoleView = z.object({ id: Uuid, key: z.string(), name: z.string(), builtIn: z.boolean(), privileged: z.boolean(), permissions: z.array(z.string()), members: z.number().int() })

/** ADR-0029 A6: spend control for a metered (pay-per-row) provider. Configuration in the Developer Panel, never code. */
export const MeteringPool = z.enum(["customer", "prewarm", "staff"])
export const ProviderMetering = z.object({
  monthlyBudgetUsd: z.number().min(0).max(10_000).default(5),
  /** Shares of the monthly budget per pool; must add up to 1. */
  poolSplit: z.object({ customer: z.number().min(0).max(1), prewarm: z.number().min(0).max(1), staff: z.number().min(0).max(1) }).default({ customer: 0.4, prewarm: 0.3, staff: 0.3 })
    .refine((p) => Math.abs(p.customer + p.prewarm + p.staff - 1) < 1e-6, "Pool shares must add up to 1"),
  /** Customers and prewarm can never spend into this part of the monthly budget. */
  staffReserveUsd: z.number().min(0).default(0.75),
  customerRunsPerHour: z.number().int().min(0).max(1000).default(6),
  maxResultsCustomer: z.number().int().min(1).max(100).default(15),
  maxResultsStaff: z.number().int().min(1).max(100).default(30),
  cacheTtlSeconds: z.number().int().min(60).max(7 * 86400).default(3 * 3600),
  currency: z.string().length(3).default("GBP"),
  market: z.string().length(2).optional(),
  excludeAirlines: z.array(z.string().min(2).max(3)).max(50).default([]),
  maxLegsPerSearch: z.number().int().min(1).max(10).default(3),
  /** Routes the prewarm job refreshes, as data (for example gateway airports to Europe). Empty until staff add some. */
  watchlist: z.array(z.object({ origin: Iata, destination: Iata, dateOffsetsDays: z.array(z.number().int().min(0).max(330)).max(12) })).max(100).default([]),
})
export type ProviderMetering = z.infer<typeof ProviderMetering>

export const ProviderView = z.object({
  id: ProviderId,
  name: z.string(),
  environment: ProviderEnv,
  enabled: z.boolean(),
  priority: z.number().int(),
  capabilities: z.object({ search: z.boolean(), price: z.boolean(), seatMap: z.boolean(), order: z.boolean() }),
  limits: z.object({ timeoutMs: z.number().int(), maxConcurrent: z.number().int(), rps: z.number(), dailyBudget: z.number().int(), lookToBookAlert: z.number().int() }),
  markets: z.object({ pointOfSale: z.string(), currency: z.string(), originRegions: z.array(z.string()), destinationRegions: z.array(z.string()) }),
  shadowMode: z.boolean(),
  credentials: z.object({ set: z.boolean(), rotatedAt: IsoDateTime.nullable(), rotatedBy: z.string().nullable(), invalidAt: IsoDateTime.nullable() }),
  /** Null for providers that are not metered. */
  metering: ProviderMetering.nullable(),
  health: z.object({ circuit: z.enum(["CLOSED", "OPEN", "HALF_OPEN"]), successRate: z.number().nullable(), p50: z.number().nullable(), p95: z.number().nullable(), lastError: z.string().nullable(), callsToday: z.number().int() }),
  version: z.number().int(),
})
export type ProviderView = z.infer<typeof ProviderView>
export const ProviderPatchBody = ProviderView.pick({ enabled: true, environment: true, priority: true, capabilities: true, limits: true, markets: true, shadowMode: true }).extend({ metering: ProviderMetering }).partial()

const PoolUsage = z.object({ budgetUsd: z.number(), spentUsd: z.number(), remainingUsd: z.number() })
/** `GET /v1/dev/providers/:id/usage`: Apify's own numbers next to our ledger. `apify` is null when the credential is missing or invalid. */
export const ProviderUsageView = z.object({
  provider: ProviderId,
  month: z.string(),
  credential: z.object({ set: z.boolean(), invalidAt: IsoDateTime.nullable() }),
  apify: z.object({ cycle: z.string().nullable(), maxMonthlyUsageUsd: z.number().nullable(), monthlyUsageUsd: z.number().nullable() }).nullable(),
  apifyError: z.string().nullable(),
  ledger: z.object({ budgetUsd: z.number(), staffReserveUsd: z.number(), totalSpentUsd: z.number(), pools: z.object({ customer: PoolUsage, prewarm: PoolUsage, staff: PoolUsage }), customerRunsThisHour: z.number().int(), customerRunsPerHour: z.number().int() }),
  banner: z.enum(["NONE", "CUSTOMER_POOL_EMPTY", "CREDENTIAL_INVALID", "CREDENTIAL_MISSING"]),
  reconciledAt: IsoDateTime.nullable(),
})
export type ProviderUsageView = z.infer<typeof ProviderUsageView>

export const ProviderRunView = z.object({
  id: Uuid, provider: ProviderId, externalRunId: z.string().nullable(), pool: MeteringPool, purpose: z.enum(["SEARCH", "RECHECK", "PREWARM"]), searchId: Uuid.nullable(),
  routes: z.array(z.object({ origin: Iata, destination: Iata, departureDate: z.string(), returnDate: z.string().optional() })),
  status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "DECLINED"]),
  rows: z.number().int(), estimatedUsd: z.number(),
  notices: z.array(z.string()), errors: z.array(z.string()),
  startedAt: IsoDateTime.nullable(), finishedAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
})
export type ProviderRunView = z.infer<typeof ProviderRunView>
export const ProviderRunsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) })
export const CredentialsBody = z.object({ values: z.record(z.string(), z.string().min(1).max(4096)) })

export const ConfigVersionView = z.object({
  id: Uuid, domain: ConfigDomain, version: z.number().int(), status: ConfigVersionStatus, payload: z.unknown(), changeNote: z.string().nullable(),
  createdBy: z.string(), publishedBy: z.string().nullable(), publishedAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
})
export const ConfigDraftBody = z.object({ payload: z.unknown(), changeNote: z.string().max(500).optional() })
export const PublishBody = z.object({ changeNote: z.string().min(5).max(500) })
export const SimulateBody = z.object({ query: SearchQuery.optional(), searchId: Uuid.optional(), draftVersion: z.number().int().optional() })

export const AuditQuery = z.object({
  actor: z.string().optional(), action: z.string().optional(), entityType: z.string().optional(), ref: z.string().optional(),
  from: IsoDateTime.optional(), to: IsoDateTime.optional(), limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().optional(),
})
export const AuditEntryView = z.object({
  id: z.string(), occurredAt: IsoDateTime, actor: z.string().nullable(), actorKind: z.string(), action: z.string(), entityType: z.string(), entityId: z.string().nullable(),
  contextRef: z.string().nullable(), before: z.unknown(), after: z.unknown(), ip: z.string().nullable(), requestId: z.string().nullable(), hash: z.string(),
})

export const HealthView = z.object({
  version: z.string(), commit: z.string(), env: z.string(), uptimeSeconds: z.number(),
  database: z.object({ ok: z.boolean(), latencyMs: z.number(), migrations: z.object({ applied: z.number().int(), latest: z.string().nullable() }) }),
  redis: z.object({ ok: z.boolean(), latencyMs: z.number() }),
  queues: z.array(z.object({ name: z.string(), waiting: z.number().int(), active: z.number().int(), delayed: z.number().int(), failed: z.number().int(), oldestWaitingSeconds: z.number().nullable() })),
  workers: z.array(z.object({ id: z.string(), role: z.string(), configVersions: z.record(z.string(), z.number()), lastHeartbeat: IsoDateTime })),
  configVersions: z.record(z.string(), z.number()),
  flags: z.record(z.string(), z.boolean()),
  dependencies: z.array(z.object({ name: z.string(), kind: z.string(), ok: z.boolean().nullable(), successRate: z.number().nullable(), p50: z.number().nullable(), p95: z.number().nullable(), lastError: z.string().nullable(), circuit: z.string().nullable() })),
  outbox: z.object({ pending: z.number().int(), oldestSeconds: z.number().nullable() }),
})

export const DeadLetterView = z.object({ id: z.string(), queue: z.string(), name: z.string(), failedReason: z.string(), attemptsMade: z.number().int(), timestamp: IsoDateTime, data: z.unknown() })
