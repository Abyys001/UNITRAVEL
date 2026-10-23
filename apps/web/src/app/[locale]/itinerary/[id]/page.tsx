"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowLeft, RefreshCw } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import type { Itinerary, PriceCheckResult, SearchQuery, SeatMap } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { ItineraryView } from "@/components/itinerary-view"
import { SeatMapView } from "@/components/seat-map"
import { api, ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"

export default function ItineraryPage() {
  const { id } = useParams<{ id: string }>()
  const sp = useSearchParams()
  const router = useRouter()
  const { t, href, money, date } = useI18n()
  const { me } = useSession()
  const [seat, setSeat] = useState<string>()
  const q = useQuery({ queryKey: ["itn", id], queryFn: () => api<{ searchId: string; itinerary: Itinerary; query: SearchQuery }>(`/v1/itineraries/${id}`) })
  const maps = useQuery({ queryKey: ["seat", id], queryFn: () => api<{ available: boolean; maps: SeatMap[] }>(`/v1/itineraries/${id}/seat-maps`), enabled: !!me && !!q.data?.itinerary.components.every((c) => c.seatMapAvailable) })
  const check = useMutation({ mutationFn: () => api<PriceCheckResult>(`/v1/itineraries/${id}/price-check`, { method: "POST" }) })
  if (q.isLoading) return <div className="mx-auto max-w-4xl p-6"><div className="h-64 animate-pulse rounded-lg bg-muted" /></div>
  if (q.error) return <p className="mx-auto max-w-4xl p-6">{(q.error as ApiError).message}</p>
  const { itinerary: it, searchId } = q.data!
  const shown = check.data?.itinerary ?? it
  const fetched = it.truth.map((x) => x.fetchedAt).sort()[0]!
  const toRequest = () => {
    const next = href(`/request/new?s=${searchId}&i=${id}${seat ? `&seat=${seat}` : ""}`)
    router.push(me ? next : href(`/sign-in?next=${encodeURIComponent(next)}`))
  }
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Link href={sp.get("s") ? "#" : href("/")} onClick={(e) => { if (sp.get("s")) { e.preventDefault(); router.back() } }} className="mb-4 inline-flex items-center gap-1 text-sm text-slate"><ArrowLeft className="size-4 rtl:rotate-180" />{t("common.back")}</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl">{t("itinerary.title")}</h1>
        <p className="font-display text-3xl tabular-nums">{money(shown.price.total)}</p>
      </div>
      <p className="mb-5 mt-2 text-sm text-slate">{t("itinerary.freshness", { time: date(fetched, { withTime: true }) })}</p>
      <ItineraryView it={shown} />
      {check.data && (
        <p role="status" className={`mt-4 rounded-md px-3 py-2 text-sm ${check.data.outcome === "CONFIRMED" ? "bg-success-subtle text-success-subtle-fg" : "bg-warning-subtle text-warning-subtle-fg"}`}>
          {check.data.outcome === "CONFIRMED" ? t("itinerary.priceConfirmed") : check.data.outcome === "PRICE_CHANGED" ? t("itinerary.priceChanged", { old: money(check.data.previousTotal), new: money(check.data.currentTotal!) }) : t("itinerary.expired")}
        </p>
      )}
      {maps.data?.available && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">{t("itinerary.seatMap")}</h2>
          <SeatMapView map={maps.data.maps[0]!} chosen={seat} onChoose={setSeat} />
        </section>
      )}
      <div className="sticky bottom-0 mt-6 flex flex-col gap-3 border-t border-border bg-paper/95 py-4 sm:flex-row sm:items-center sm:justify-between">
        {me && <Button variant="outline" onClick={() => check.mutate()} disabled={check.isPending}><RefreshCw className={`size-4 ${check.isPending ? "animate-spin" : ""}`} />{t("itinerary.priceCheck")}</Button>}
        <div className="text-end">
          <Button size="lg" onClick={toRequest} className="w-full sm:w-auto">{t("itinerary.request")}</Button>
          <p className="mt-1 text-xs text-slate">{t("itinerary.requestNote")}</p>
        </div>
      </div>
    </div>
  )
}
