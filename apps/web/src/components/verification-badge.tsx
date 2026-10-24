"use client"

import type { VerificationStatus } from "@unitravel/contracts"
import { VerificationBadge as Badge } from "@unitravel/ui/product/verification-badge"

import { useI18n } from "@/lib/i18n"

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const { t } = useI18n()
  return <Badge status={status} label={t(`identity.status.${status}`)} />
}
