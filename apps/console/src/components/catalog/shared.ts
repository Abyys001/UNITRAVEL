import type { SlotStatus } from "@unitravel/contracts"

export const CATALOG = "/v1/admin/catalog"
export const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`)

/** Query keys: every catalog mutation invalidates the whole ["catalog"] tree, which is small. */
export const KEYS = {
  all: ["catalog"] as const,
  usage: ["catalog", "usage"] as const,
  coverage: ["catalog", "coverage"] as const,
  settings: ["catalog", "settings"] as const,
  routes: ["catalog", "routes"] as const,
}

/** Colour reinforces the status; the visible text label carries it (a11y). */
export const SLOT_CLASS: Record<SlotStatus, string> = {
  NEVER: "border-dashed border-rule-strong bg-surface text-steel",
  FRESH: "border-success-border bg-success-subtle text-success-subtle-fg",
  AGING: "border-info-border bg-info-subtle text-info-subtle-fg",
  STALE: "border-warning-border bg-warning-subtle text-warning-subtle-fg",
  EMPTY: "border-rule-strong bg-surface-sunk text-steel",
  ERROR: "border-danger/40 bg-danger-subtle text-danger",
}
