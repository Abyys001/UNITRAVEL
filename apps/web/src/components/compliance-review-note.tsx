"use client"

import { ShieldCheck } from "lucide-react"

import { useI18n } from "@/lib/i18n"

/** ADR-0031 I5 wording for itineraries that match a REVIEW lane (`complianceReview`). No promise of availability or price. */
export function ComplianceReviewNote({ show, className = "" }: { show: boolean; className?: string }) {
  const { t } = useI18n()
  if (!show) return null
  return (
    <p role="note" data-testid="compliance-review-note" className={`flex items-start gap-2 rounded-xl border border-line bg-cloud px-4 py-3 text-sm ${className}`}>
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-royal" />{t("complianceReview.note")}
    </p>
  )
}
