import type { Metadata } from "next"

/** A tracking result is one shipment's status: never indexed (ADR-0042 public tracking). */
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" }

export default function TrackingResultLayout({ children }: { children: React.ReactNode }) {
  return children
}
