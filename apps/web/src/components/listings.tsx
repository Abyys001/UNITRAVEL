"use client"

import { PopularFlights } from "@/components/popular-flights"
import { SearchForm } from "@/components/search-form"
import { useI18n } from "@/lib/i18n"

/** Flights: the search form, then popular routes from the indicative Apify source (ADR-0032 B4). */
export function FlightListings() {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <h1 className="sr-only">{t("listings.flightsTitle")}</h1>
      <div id="flight-request" className="scroll-mt-24"><SearchForm /></div>
      <PopularFlights />
    </div>
  )
}
