import type { Permission } from "@unitravel/contracts"

export type ActorKind = "CUSTOMER" | "STAFF" | "SYSTEM"

export interface MachineActor {
  kind: ActorKind
  userId?: string
  permissions: ReadonlySet<Permission>
  /** True when the actor is the authenticated customer who owns the request (checked server-side). */
  isOwner?: boolean
}

export interface TransitionDef<S extends string, F> {
  from: readonly S[]
  /** Fixed target, or computed from the facts (e.g. a re-weigh beyond tolerance goes to EXCEPTION). */
  to: S | ((facts: F) => S)
  actor: ActorKind
  /** Any one of these grants the command (staff commands only). */
  permissions?: readonly Permission[]
  /** Returns a human-readable reason when the guard fails, or null when it passes. */
  guard?: (facts: F) => string | null
  /** Hidden from the console's action list (system and customer-only commands). */
  label?: string
}

export type TransitionTable<S extends string, F, C extends string = string> = Record<C, TransitionDef<S, F>>

export type Evaluation<S> =
  | { ok: true; from: S; to: S }
  | { ok: false; code: "INVALID_TRANSITION" | "FORBIDDEN"; reason: string }

export function evaluate<S extends string, F extends { status: S }, C extends string>(
  table: TransitionTable<S, F, C>,
  command: C,
  facts: F,
  actor: MachineActor,
): Evaluation<S> {
  const def = table[command]
  if (!def) return { ok: false, code: "INVALID_TRANSITION", reason: `Unknown command ${command}` }
  if (def.actor === "SYSTEM" && actor.kind !== "SYSTEM") return { ok: false, code: "FORBIDDEN", reason: "Only the system can run this command" }
  if (def.actor === "CUSTOMER" && !(actor.kind === "CUSTOMER" && actor.isOwner)) return { ok: false, code: "FORBIDDEN", reason: "Only the customer who owns the request can do this" }
  if (def.actor === "STAFF") {
    if (actor.kind !== "STAFF") return { ok: false, code: "FORBIDDEN", reason: "Staff only" }
    if (def.permissions && !def.permissions.some((p) => actor.permissions.has(p))) {
      return { ok: false, code: "FORBIDDEN", reason: `Requires ${def.permissions.join(" or ")}` }
    }
  }
  if (!def.from.includes(facts.status)) {
    return { ok: false, code: "INVALID_TRANSITION", reason: `${command} is not allowed from ${facts.status}` }
  }
  const reason = def.guard?.(facts)
  if (reason) return { ok: false, code: "INVALID_TRANSITION", reason }
  const to = typeof def.to === "function" ? def.to(facts) : def.to
  return { ok: true, from: facts.status, to }
}

/** Server-computed action list for the console (ch. 15.1 "Commands, not fields"): disabled actions carry the reason. */
export function allowedCommands<S extends string, F extends { status: S }, C extends string>(
  table: TransitionTable<S, F, C>,
  facts: F,
  actor: MachineActor,
  only?: readonly C[],
): { command: C; allowed: boolean; reason?: string }[] {
  const out: { command: C; allowed: boolean; reason?: string }[] = []
  for (const command of (only ?? (Object.keys(table) as C[]))) {
    const def = table[command]
    if (def.actor !== actor.kind) continue
    if (!def.from.includes(facts.status)) continue
    const r = evaluate(table, command, facts, actor)
    out.push(r.ok ? { command, allowed: true } : { command, allowed: false, reason: r.reason })
  }
  return out
}
