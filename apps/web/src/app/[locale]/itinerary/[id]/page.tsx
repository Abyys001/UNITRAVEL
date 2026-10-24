"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import type { CustomerItinerary, CustomerSeatMap, SearchQuery } from "@unitravel/contracts"

import { ItineraryView } from "@/components/itinerary-view"
import { SeatMapView } from "@/components/seat-map"
import { api, ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { LoadingState } from "@unitravel/ui/product/states"

export default function ItineraryPage() {
  const { id } = useParams<{ id: string }>()
  const sp = useSearchParams()
  const router = useRouter()
  const { t, href, date } = useI18n()
  const { me } = useSession()
  const [seat, setSeat] = useState<string>()
  const q = useQuery({ queryKey: ["itn", id], queryFn: () => api<{ searchId: string; itinerary: CustomerItinerary; query: SearchQuery }>(`/v1/itineraries/${id}`) })
  const maps = useQuery({ queryKey: ["seat", id], queryFn: () => api<{ available: boolean; maps: CustomerSeatMap[] }>(`/v1/itineraries/${id}/seat-maps`), enabled: !!me && !!q.data?.itinerary.components.every((c) => c.seatMapAvailable) })
  if (q.isLoading) return <div className="mx-auto max-w-4xl px-4 py-8"><LoadingState label={t("common.loading")} rows={4} /></div>
  if (q.error) return <p className="mx-auto max-w-4xl px-4 py-8">{(q.error as ApiError).message}</p>
  const { itinerary: it, searchId } = q.data!
  const fetched = it.truth.map((x) => x.fetchedAt).sort()[0]!
  const toRequest = () => {
    const next = href(`/request/new?s=${searchId}&i=${id}${seat ? `&seat=${seat}` : ""}`)
    router.push(me ? next : href(`/sign-in?next=${encodeURIComponent(next)}`))
  }
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-10">
      <Link href={sp.get("s") ? "#" : href("/")} onClick={(e) => { if (sp.get("s")) { e.preventDefault(); router.back() } }} className="mb-5 inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-royal hover:text-navy-950"><ArrowLeft className="size-4 rtl:rotate-180" />{t("common.back")}</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl md:text-4xl">{t("itinerary.title")}</h1>
        <p className="text-sm text-steel">{t("itinerary.priceInQuote")}</p>
      </div>
      <p className="mb-6 mt-2 text-sm text-steel">{t("itinerary.freshness", { time: date(fetched, { withTime: true }) })}</p>
      <ItineraryView it={it} />
      {maps.data?.available && (
        <section className="mt-8">
          <h2 className="font-display mb-3 text-xl">{t("itinerary.seatMap")}</h2>
          <SeatMapView map={maps.data.maps[0]!} chosen={seat} onChoose={setSeat} />
        </section>
      )}
      <div className="card-brand sticky bottom-3 z-20 mt-8 flex flex-col gap-3 p-4 shadow-[var(--shadow-lift)] sm:flex-row sm:items-center sm:justify-between">
        <div className="text-end">
          <button type="button" onClick={toRequest} className="btn-orange w-full sm:w-auto">{t("itinerary.request")}</button>
          <p className="mt-1 text-xs text-steel">{t("itinerary.requestNote")}</p>
        </div>
      </div>
    </div>
  )
}
