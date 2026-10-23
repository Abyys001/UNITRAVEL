import type { ConnectionRuleFields, EngineRules, RuleOverride, ScoringWeights } from "@unitravel/contracts"

export interface ResolvedRule extends ConnectionRuleFields {
  /** Ids of the rules that contributed, most specific first, e.g. "carrier-pair:IST:W6>TK,airport-IST,global". */
  id: string
}

export interface ConnectionKey {
  at: string
  to?: string
  inbound?: string
  outbound?: string
  origin?: string
  destination?: string
}

/**
 * Precedence (ch. 22.3): carrier pair at airport → airport → route → global. The most specific rule that defines a
 * field wins; undefined fields fall through.
 */
export class RuleResolver {
  constructor(private readonly rules: EngineRules) {}

  forConnection(k: ConnectionKey): ResolvedRule {
    const layers: RuleOverride[] = []
    const o = this.rules.overrides
    layers.push(...o.filter((r) => r.level === "CARRIER_PAIR" && r.airport === k.at && (!r.inboundCarrier || r.inboundCarrier === k.inbound) && (!r.outboundCarrier || r.outboundCarrier === k.outbound)))
    layers.push(...o.filter((r) => r.level === "AIRPORT" && r.airport === k.at))
    layers.push(...o.filter((r) => r.level === "ROUTE" && r.origin === k.origin && r.destination === k.destination))
    const merged: ConnectionRuleFields = { ...this.rules.global }
    // Apply from least to most specific so the most specific definition wins.
    for (const layer of [...layers].reverse()) Object.assign(merged, stripUndefined(layer.fields))
    const id = [...layers.map((l) => l.id), "global"].join(",")
    return { ...merged, id }
  }

  forRoute(origin: string, destination: string): ResolvedRule {
    return this.forConnection({ at: "", origin, destination })
  }

  /** Airports reachable by an allowed airport change from `at`, with their transfer times. */
  airportChanges(at: string): { to: string; transferMin: number }[] {
    return this.forConnection({ at }).airportChanges
  }

  airportChangeMin(at: string, to: string): number | null {
    return this.airportChanges(at).find((c) => c.to === to)?.transferMin ?? null
  }

  isBlocked(iata: string): boolean {
    return this.forConnection({ at: iata }).blocked
  }

  weightsFor(origin: string, destination: string): ScoringWeights {
    return this.rules.routeWeights.find((w) => w.origin === origin && w.destination === destination)?.weights ?? this.rules.weights
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}
