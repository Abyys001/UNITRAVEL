import { notFound } from "next/navigation"
import type { Metadata } from "next"

import { translate, type Locale } from "@unitravel/i18n"

import { CatalogDetailView } from "@/components/catalog-view"
import { defaultShape, fetchCatalogResult } from "@/lib/catalog-server"

type Props = { params: Promise<{ locale: string; id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = { robots: { index: false } }

/** ADR-0034: one stored itinerary, no prices. A row that has dropped out of the catalog is still shown, marked as no longer listed. */
export default async function FlightResultPage({ params }: Props) {
  const { locale, id } = await params
  if (!UUID.test(id)) notFound()
  const d = await fetchCatalogResult(id)
  if (d === undefined) notFound()
  if (d === null) return <p className="mx-auto max-w-6xl p-8">{translate(locale as Locale, "results.noSources")}</p>
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <CatalogDetailView d={d} shape={defaultShape(d.origin, d.destination, d.departureDate)} />
    </div>
  )
}
