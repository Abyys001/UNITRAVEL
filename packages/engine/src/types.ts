import type { EngineRules, HubsConfig, NormalisedOffer, ProviderId, SearchQuery } from "@unitravel/contracts"

export interface AirportRef {
  iata: string
  country: string
  tz: string
  cityCode: string | null
  regions: string[]
  nameEn: string
  nameFa: string
}

/** Reference data the engine needs, passed in as plain data (the engine performs no I/O). */
export interface ReferenceLookup {
  airport(iata: string): AirportRef | undefined
  /** City or metro code → its airports (LON → LHR, LGW, STN, LTN, LCY, SEN). */
  cityAirports(code: string): string[]
}

export interface CarrierPolicy {
  /** Carriers whose segments must never be shown (marketing or operating), with the reason for the counter. */
  blockedCarriers: Set<string>
  reviewCarriers: Set<string>
  blockedAirports: Set<string>
  reviewAirports: Set<string>
}

export interface ProviderPlanInfo {
  id: ProviderId
  priority: number
  /** Remaining calls for today; the planner lowers fan-out when this is low. */
  budgetRemaining: number
  supportsCityCodes: boolean
}

export type CallKind = "THROUGH" | "LEG_TO_HUB" | "LEG_FROM_HUB" | "GATEWAY_THROUGH" | "GATEWAY_LEG_TO_HUB" | "GATEWAY_LEG_FROM_HUB"

export interface PlannedCall {
  key: string
  wave: 1 | 2 | 3
  kind: CallKind
  provider: ProviderId
  sliceIndex: number
  /** For round-trip through searches, more than one slice is sent in one call. */
  slices: { origin: string; destination: string; date: string }[]
  hub?: string
  gateway?: { iata: string; dayOffset: number; country: string }
  dateOffset: number
}

export interface Plan {
  calls: PlannedCall[]
  strategies: { through: boolean; selfTransfer: boolean; gateway: boolean }
  hubs: string[]
  gateways: { iata: string; dayOffset: number }[]
  notes: string[]
  droppedForBudget: number
}

export interface EngineContext {
  query: SearchQuery
  rules: EngineRules
  hubs: HubsConfig
  policy: CarrierPolicy
  reference: ReferenceLookup
  ruleVersion: number
  flags: { selfTransfer: boolean; gateways: boolean }
  locale: "en" | "fa"
  now: Date
}

export interface CollectedCall {
  call: PlannedCall
  offers: NormalisedOffer[]
  error?: string
}

export interface FilterStats {
  removedByPolicy: number
  removedExpired: number
  removedTimezone: number
  removedInvalid: number
  reviewFlagged: number
}
