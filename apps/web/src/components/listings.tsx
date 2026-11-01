"use client"

import { useQuery } from "@tanstack/react-query"
import { Plane, Search } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import type { FlightListingsView, ListingVertical, PublicListingsView } from "@unitravel/contracts"
import { ServiceScene, type SceneKind } from "@unitravel/ui/brand/scenes"
import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { Auto, Ltr } from "@/components/badges"
import { VerticalRequest } from "@/components/vertical-request"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useSite } from "@/lib/site"

const META = {
  BUS: { path: "buses", menu: "buses", title: "listings.busesTitle", scene: "bus", req: { type: "BUS", kind: "ground" } },
  TRAIN: { path: "trains", menu: "trains", title: "listings.trainsTitle", scene: "train", req: { type: "TRAIN", kind: "ground" } },
  STAY: { path: "stays", menu: "stays", title: "listings.staysTitle", scene: "stay", req: { type: "STAY", kind: "stay" } },
} as const satisfies Record<ListingVertical, { path: string; menu: string; title: string; scene: SceneKind; req: unknown }>

function Hero({ title, lead, scene }: { title: string; lead: string; scene: SceneKind }) {
  return (
    <div className="grid items-center gap-6 md:grid-cols-[1fr_16rem]">
      <div><h1 className="font-display text-3xl md:text-4xl">{title}</h1><p className="mt-3 max-w-2xl leading-7 text-steel">{lead}</p></div>
      <ServiceScene kind={scene} className="hidden aspect-[5/3] md:block" />
    </div>
  )
}

function DestinationFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n()
  return (
    <label className="relative mt-6 block max-w-md">
      <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-steel" />
      <input type="search" className="field h-11 w-full ps-10" dir="auto" placeholder={t("listings.searchPlaceholder")} aria-label={t("listings.searchPlaceholder")} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** Buses, trains, villas and stays: staff-curated, indicative rows (ADR-0021). The request form sits under the list. */
export function GroundListing({ vertical }: { vertical: ListingVertical }) {
  const m = META[vertical]
  const { t, locale, money, date } = useI18n()
  const { on, loaded } = useSite()
  const [to, setTo] = useState("")
  const q = useQuery({ queryKey: ["listings", vertical, to], queryFn: () => api<PublicListingsView>(`/v1/listings/${m.path}${to.trim() ? `?to=${encodeURIComponent(to.trim())}` : ""}`), enabled: loaded && on(m.menu), staleTime: 60_000 })
  if (loaded && !on(m.menu)) return <VerticalRequest {...m.req} />
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <Hero title={t(m.title)} lead={t("listings.groundLead")} scene={m.scene} />
      <DestinationFilter value={to} onChange={setTo} />
      {q.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}
      {q.data && q.data.items.length === 0 && <EmptyState className="mt-6" compact title={t("listings.empty")} />}
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="listing-grid">
        {q.data?.items.map((i) => (
          <li key={i.id} className="card-brand flex flex-col p-5">
            <span className="w-fit rounded-full bg-orange/15 px-3 py-1 text-xs font-bold text-orange-700">{t("listings.indicative")}</span>
            <h2 className="mt-3 font-display text-xl" dir="auto">{i.title[locale]}</h2>
            <p className="mt-1 text-sm text-steel" dir="auto">{i.fromPlace ? <Auto>{i.fromPlace}</Auto> : null}{i.fromPlace ? " → " : ""}<Auto>{i.toPlace}</Auto>{i.operator ? ` · ${i.operator}` : ""}</p>
            {i.summary[locale] && <p className="mt-2 flex-1 text-sm leading-6" dir="auto">{i.summary[locale]}</p>}
            <div className="mt-3 text-sm">
              {i.price ? <p><span className="text-steel">{t("listings.quotedPrice")}: </span><span className="font-bold">{money(i.price)}</span></p> : null}
              {i.validUntil ? <p className="text-xs text-steel">{t("listings.validUntil", { date: date(i.validUntil, { dateOnly: true }) })}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      <h2 className="mt-12 font-display text-2xl">{t("listings.requestForm")}</h2>
      <div className="mt-4"><VerticalRequest {...m.req} embedded /></div>
    </div>
  )
}

/** Flights: only what live sources returned recently, each with its label and fetch time. Never a price; no source means an honest empty state. */
export function FlightListings() {
  const { t, href, date } = useI18n()
  const [to, setTo] = useState("")
  const q = useQuery({ queryKey: ["listings", "flights", to], queryFn: () => api<FlightListingsView>(`/v1/listings/flights${to.trim() ? `?to=${encodeURIComponent(to.trim().toUpperCase())}` : ""}`), staleTime: 60_000 })
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <Hero title={t("listings.flightsTitle")} lead={t("listings.flightsLead")} scene="flight" />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="flex-1"><DestinationFilter value={to} onChange={setTo} /></div>
        <Link href={href("/")} className="btn-orange">{t("listings.searchFlights")}</Link>
      </div>
      {q.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}
      {q.data && q.data.items.length === 0 && (
        <EmptyState className="mt-6" icon={<Plane />} title={q.data.notice === "NO_SOURCES" ? t("listings.emptyFlights") : t("listings.empty")} action={<Link href={href("/support")} className="btn-orange mt-2 inline-flex">{t("listings.askTeam")}</Link>} />
      )}
      <ul className="mt-6 grid gap-4 sm:grid-cols-2" data-testid="flight-listings">
        {q.data?.items.map((f, n) => (
          <li key={`${f.origin}${f.destination}${f.departureDate}${n}`} className="card-brand p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-display text-2xl"><Ltr>{f.origin}</Ltr> <Plane aria-hidden className="inline size-4 rotate-45 text-royal rtl:-rotate-45 rtl:-scale-x-100" /> <Ltr>{f.destination}</Ltr></p>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${f.label === "SANDBOX" ? "bg-warning-subtle text-warning-subtle-fg" : "bg-royal/10 text-royal"}`}>{f.label === "SANDBOX" ? t("listings.sandbox") : t("listings.cached", { time: date(f.fetchedAt, { withTime: true }) })}</span>
            </div>
            <p className="mt-2 text-sm text-steel">{date(f.departureDate, { dateOnly: true })} · {f.stops === 0 ? t("listings.direct") : t("listings.stops", { n: f.stops })} · {Math.floor(f.durationMin / 60)}h {f.durationMin % 60}m</p>
            {f.carriers.length > 0 && <p className="mt-1 text-sm"><Auto>{f.carriers.join(", ")}</Auto></p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
