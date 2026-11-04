import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"

import { SearchForm } from "@/components/search-form"
import { CatalogSearchView, DateLine, SearchMemory } from "@/components/catalog-view"
import { catalogQueryOf, fetchCatalogSearch, shapeFromParams } from "@/lib/catalog-server"
import { translate, type Locale } from "@unitravel/i18n"
import type { CatalogSearchResponse } from "@unitravel/contracts"

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export const metadata: Metadata = { robots: { index: false } }

/** ADR-0034: server-rendered from the stored catalog (GET /v1/flights/search); nothing here can start a provider call. */
export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params
  const shape = shapeFromParams(await searchParams)
  const t = (k: Parameters<typeof translate>[1]) => translate(locale as Locale, k)
  if (!shape) return <p className="mx-auto max-w-6xl p-8">{t("common.error")}</p>
  const q = catalogQueryOf(shape)
  const data: CatalogSearchResponse = (await fetchCatalogSearch(q)) ?? {
    tracked: false, state: "UNAVAILABLE", origin: q.from, destination: q.to, date: q.date, fetchedAt: null, results: [], dates: [], nearbyDates: [], partyNote: false,
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <SearchMemory />
      <h1 className="font-display text-3xl md:text-4xl">{shape.from.label} <ArrowRight className="mx-1 inline size-7 text-orange rtl:rotate-180" aria-label="→" /> {shape.to.label}</h1>
      <DateLine iso={shape.date} />
      <details className="card-brand mb-5"><summary className="cursor-pointer rounded-2xl px-4 py-3 text-sm font-semibold text-navy-900">{t("results.change")}</summary><div className="p-3"><SearchForm initial={shape} /></div></details>
      <CatalogSearchView data={data} shape={shape} />
    </div>
  )
}
