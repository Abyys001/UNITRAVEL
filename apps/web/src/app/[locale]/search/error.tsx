"use client"

import { ErrorState } from "@unitravel/ui/product/states"

import { useI18n } from "@/lib/i18n"

export default function SearchError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <ErrorState title={t("guide.flights.errorTitle")} body={t("guide.flights.errorBody")} retryLabel={t("guide.flights.retry")} onRetry={reset} />
    </div>
  )
}
