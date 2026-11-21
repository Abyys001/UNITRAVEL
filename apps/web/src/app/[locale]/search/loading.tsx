"use client"

import { Skeleton } from "@unitravel/ui/components/skeleton"

import { useI18n } from "@/lib/i18n"

export default function Loading() {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10" role="status" aria-busy="true" data-testid="search-loading">
      <span className="sr-only">{t("guide.flights.loading")}</span>
      <Skeleton className="h-9 w-2/3 max-w-md" />
      <Skeleton className="mb-6 mt-3 h-5 w-40" />
      <ul className="mt-6 space-y-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="card-brand rounded-2xl p-4 sm:p-5">
            <Skeleton className="mb-4 h-4 w-48 max-w-full" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-16 shrink-0" />
              <Skeleton className="h-3 min-w-0 flex-1" />
              <Skeleton className="h-10 w-16 shrink-0" />
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-dashed border-haze pt-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-24 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
