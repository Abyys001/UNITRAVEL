import { z } from "zod"

import { IsoDateTime, Uuid } from "./common"
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
  credentials: z.object({ set: z.boolean(), rotatedAt: IsoDateTime.nullable(), rotatedBy: z.string().nullable() }),
  health: z.object({ circuit: z.enum(["CLOSED", "OPEN", "HALF_OPEN"]), successRate: z.number().nullable(), p50: z.number().nullable(), p95: z.number().nullable(), lastError: z.string().nullable(), callsToday: z.number().int() }),
  version: z.number().int(),
})
export type ProviderView = z.infer<typeof ProviderView>
export const ProviderPatchBody = ProviderView.pick({ enabled: true, environment: true, priority: true, capabilities: true, limits: true, markets: true, shadowMode: true }).partial()
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
