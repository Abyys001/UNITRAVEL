"use client"

import { LiveFlights } from "@/components/live-flights"
import { SearchForm } from "@/components/search-form"
import { useI18n } from "@/lib/i18n"

/** Flights: the search form, then the live traffic board (ADR-0027). Cached routes are no longer listed here (owner, 1 Nov 2026). */
export function FlightListings() {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <h1 className="sr-only">{t("listings.flightsTitle")}</h1>
      <SearchForm />
      <LiveFlights />
    </div>
  )
}
