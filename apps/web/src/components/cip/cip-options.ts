import { Armchair, BedDouble, Building2, Car, FastForward, Home, UtensilsCrossed, type LucideIcon } from "lucide-react"

import { CIP_DEPARTURE_ONLY, type CipService } from "@unitravel/contracts"

/** When an option applies, from the operator's pages (STAGE-32 evidence); FAST_TRACK is agency-sourced, so unconfirmed. */
export type CipWhen = "BOTH" | "DEPARTURE" | "ADDON" | "CONFIRM"

export const CIP_OPTIONS: { id: CipService; icon: LucideIcon; when: CipWhen }[] = [
  { id: "CIP_TERMINAL", icon: Building2, when: "BOTH" },
  { id: "BUSINESS_LOUNGE", icon: Armchair, when: "DEPARTURE" },
  { id: "BUSINESS_LOUNGE_FULL", icon: UtensilsCrossed, when: "DEPARTURE" },
  { id: "HOME_CHECK_IN", icon: Home, when: "DEPARTURE" },
  { id: "SUITE", icon: BedDouble, when: "ADDON" },
  { id: "TRANSFER", icon: Car, when: "ADDON" },
  { id: "FAST_TRACK", icon: FastForward, when: "CONFIRM" },
]

export const isDepartureOnly = (s: CipService) => CIP_DEPARTURE_ONLY.includes(s)

export const WHEN_TONE: Record<CipWhen, string> = {
  BOTH: "bg-success-subtle text-success-subtle-fg",
  DEPARTURE: "bg-info-subtle text-info-subtle-fg",
  ADDON: "bg-cloud text-navy-900 ring-1 ring-line",
  CONFIRM: "bg-warning-subtle text-warning-subtle-fg",
}
