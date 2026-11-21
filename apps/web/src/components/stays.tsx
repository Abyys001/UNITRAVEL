"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, BedDouble, Check, MapPin, ReceiptText, Search, ShieldCheck, Users, X } from "lucide-react"
import Link from "next/link"
import { useMemo, useRef, useState } from "react"

import type { CuratedListingView, PublicListingsView } from "@unitravel/contracts"
import { Ribbon } from "@unitravel/ui/brand/art"
import { EmptyState, ErrorState, LoadingState } from "@unitravel/ui/product/states"

import { Auto } from "@/components/badges"
import { type ComboItem, ComboField, CounterField, DateRangeField } from "@/components/form"
import { ServiceIntro } from "@/components/service-intro"
import { Field, inDays, ServiceFormFrame, today, Unavailable } from "@/components/service-form"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { cityKey, cityMatches, cityOfPlace, fold, STAY_CITIES, STAY_DESTINATIONS, STAY_GROUPS, STAY_REGIONS, type StayCity, type StayGroup, type StayRegion } from "@/lib/iran-destinations"
import { useSite } from "@/lib/site"

const NOTE_MAX = 1000
const REQUEST_ID = "stay-request"

function CityPhoto({ city, className, sizes = "(min-width: 1024px) 25vw, 50vw" }: { city: StayCity; className?: string; sizes?: string }) {
  return (
    <picture>
      <source srcSet={`${city.photo}.avif`} type="image/avif" sizes={sizes} />
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-encoded AVIF/WebP set */}
      <img src={`${city.photo}.webp`} alt="" loading="lazy" decoding="async" className={className} />
    </picture>
  )
}

function Hero() {
  const { t } = useI18n()
  const points = [{ icon: Users, text: t("stays.pointCurated") }, { icon: ReceiptText, text: t("stays.pointQuote") }, { icon: ShieldCheck, text: t("stays.pointNotBooking") }]
  return (
    <section className="relative isolate overflow-hidden bg-navy-950 text-white" data-testid="stays-hero">
      <picture>
        <source srcSet="/media/photos/iran/isfahan.avif" type="image/avif" />
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-encoded AVIF/WebP set */}
        <img src="/media/photos/iran/isfahan.webp" alt="" className="absolute inset-0 -z-10 size-full object-cover" />
      </picture>
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgb(6_31_76/0.95)_0%,rgb(8_47_107/0.82)_55%,rgb(12_103_185/0.35)_100%)] rtl:bg-[linear-gradient(260deg,rgb(6_31_76/0.95)_0%,rgb(8_47_107/0.82)_55%,rgb(12_103_185/0.35)_100%)]" />
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-12 md:px-6 md:pb-12 md:pt-20">
        <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/90 backdrop-blur"><span className="size-1.5 rounded-full bg-orange" />{t("stays.eyebrow")}</p>
        <h1 className="font-display mt-5 max-w-3xl text-[2.2rem] leading-[1.12] md:text-5xl">{t("stays.title")}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white/85">{t("stays.lead")}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a href={`#${REQUEST_ID}`} className="btn-orange">{t("stays.ctaRequest")}<ArrowRight className="arrow-nudge size-4 rtl:rotate-180" aria-hidden /></a>
          <a href="#destinations" className="btn-glass">{t("stays.ctaBrowse")}</a>
        </div>
        <ul className="mt-8 grid max-w-4xl gap-3 sm:grid-cols-3">
          {points.map(({ icon: Icon, text }) => <li key={text} className="glass flex items-center gap-3 rounded-2xl p-3.5 text-sm font-semibold"><Icon className="size-5 shrink-0 text-cyan" aria-hidden />{text}</li>)}
        </ul>
      </div>
      <Ribbon className="relative" />
    </section>
  )
}

function CityCard({ city, count, selected, feature, onSelect }: { city: StayCity; count: number; selected: boolean; feature: boolean; onSelect: () => void }) {
  const { t, locale } = useI18n()
  const n = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB").format(count)
  return (
    <li className={feature ? "col-span-2" : ""}>
      <button
        type="button" aria-pressed={selected} onClick={onSelect} data-testid={`city-${city.slug}`}
        className={`group relative isolate block h-44 w-full overflow-hidden rounded-[20px] bg-navy-950 text-start text-white outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-orange focus-visible:ring-offset-2 md:h-52 ${selected ? "ring-[3px] ring-orange ring-offset-2" : ""}`}
      >
        <CityPhoto city={city} sizes={feature ? "(min-width: 1024px) 50vw, 100vw" : undefined} className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none" />
        <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-navy-950/90 via-navy-950/35 to-transparent" />
        <span className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          {count > 0 ? <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-navy-950">{count === 1 ? t("stays.listedOne") : t("stays.listedMany", { n })}</span> : <span />}
          {selected && <span className="flex size-7 items-center justify-center rounded-full bg-orange text-navy-950"><Check className="size-4" aria-label={t("stays.selected")} /></span>}
        </span>
        <span className="absolute inset-x-0 bottom-0 p-4">
          <span className={`font-display block leading-tight ${feature ? "text-2xl md:text-3xl" : "text-xl"}`}>{t(cityKey(city, "name"))}</span>
          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-white/90 md:text-sm">{t(cityKey(city, "blurb"))}</span>
        </span>
      </button>
    </li>
  )
}

function ListingCard({ item, onRequest }: { item: CuratedListingView; onRequest: () => void }) {
  const { t, locale, money, date } = useI18n()
  const city = cityOfPlace(item.toPlace)
  return (
    <li className="card-brand flex flex-col overflow-hidden">
      <div className="relative isolate h-36 bg-navy-900">
        {city && <CityPhoto city={city} sizes="(min-width: 1024px) 33vw, 100vw" className="absolute inset-0 -z-10 size-full object-cover" />}
        <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-navy-950/70 to-transparent" />
        <span className="absolute bottom-3 start-3 inline-flex items-center gap-1.5 text-sm font-semibold text-white"><MapPin className="size-4" aria-hidden /><Auto>{item.toPlace}</Auto></span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <span className="w-fit rounded-full bg-orange/15 px-3 py-1 text-xs font-bold text-orange-700">{t("listings.indicative")}</span>
        <h3 className="mt-3 font-display text-xl" dir="auto">{item.title[locale]}</h3>
        {item.operator && <p className="mt-1 text-sm text-steel" dir="auto">{item.operator}</p>}
        {item.summary[locale] && <p className="mt-2 flex-1 text-sm leading-6" dir="auto">{item.summary[locale]}</p>}
        <div className="mt-3 text-sm">
          {item.price && <p><span className="text-steel">{t("listings.quotedPrice")}: </span><span className="font-bold">{money(item.price)}</span></p>}
          {item.validUntil && <p className="text-xs text-steel">{t("listings.validUntil", { date: date(item.validUntil, { dateOnly: true }) })}</p>}
        </div>
        <button type="button" className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-navy-900 px-4 text-sm font-semibold text-navy-950 transition-colors hover:bg-navy-950 hover:text-white" data-testid="listing-request" onClick={onRequest}>{t("listings.requestThis")}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></button>
      </div>
    </li>
  )
}

/** Search over the whole destination list (both languages); the picked name goes into the request in the visitor's language. */
function DestinationCombo({ id, value, onChange }: { id: string; value: string; onChange: (name: string) => void }) {
  const { t, locale } = useI18n()
  const items = useMemo<ComboItem[]>(() => {
    const collate = new Intl.Collator(locale)
    const order = (g: StayGroup) => STAY_GROUPS.indexOf(g)
    return [...STAY_DESTINATIONS]
      .sort((a, b) => order(a.group) - order(b.group) || collate.compare(a[locale], b[locale]))
      .map((d) => ({ value: d.id, label: d[locale], keywords: [d.en, d.fa, d.id], group: d.group, sublabel: d.featured ? t("guide.services.form.featured") : undefined }))
  }, [locale, t])
  const known = new Set(STAY_DESTINATIONS.map((d) => d.id))
  const current = STAY_DESTINATIONS.find((d) => [d.en, d.fa].includes(value))?.id ?? ""
  return (
    <div className="min-w-0">
      <input id={id} hidden value={value} onChange={(e) => { if (STAY_DESTINATIONS.some((d) => [d.en, d.fa].includes(e.target.value))) onChange(e.target.value) }} />
    <ComboField
      id={id} label={t("services.location")} items={items} value={current} required placeholder={t("guide.services.form.destinationSearch")} hint={t("guide.services.form.destinationHint")} emptyText={t("guide.services.form.destinationNoMatch")} testId="stay-location"
      groupLabel={(g) => t(`stays.regions.${g as StayGroup}`)}
      onChange={(v) => onChange(STAY_DESTINATIONS.find((d) => d.id === v && known.has(v))?.[locale] ?? "")}
      renderValue={(item, valueId) => (
        <>
          <MapPin className="size-5 shrink-0 text-orange-700" aria-hidden />
          <span id={valueId} dir="auto" className={`min-w-0 flex-1 truncate ${item || value ? "font-semibold text-navy-950" : "text-steel"}`}>{item?.label ?? (value || t("guide.common.selectPlaceholder"))}</span>
        </>
      )}
      renderItem={(item) => (
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="block min-w-0 truncate text-sm text-navy-950">{item.label}</span>
          {item.sublabel ? <span className="shrink-0 rounded-full bg-orange/15 px-2 py-0.5 text-[11px] font-semibold text-orange-700">{item.sublabel}</span> : null}
        </span>
      )}
    />
    </div>
  )
}

interface StayForm { location: string; checkIn: string; checkOut: string; guests: number; rooms: number; note: string }

/** Villas and stays: destinations to ask about, staff-curated indicative listings (ADR-0021), then the request (ADR-0015). No listing is invented. */
export function StayListing() {
  const { t, locale } = useI18n()
  const { on, loaded } = useSite()
  const enabled = loaded && on("stays")
  const q = useQuery({ queryKey: ["listings", "STAY"], queryFn: () => api<PublicListingsView>("/v1/listings/stays"), enabled, staleTime: 60_000 })
  const [search, setSearch] = useState("")
  const [region, setRegion] = useState<StayRegion | "all">("all")
  const [city, setCity] = useState<StayCity | null>(null)
  const [f, setF] = useState<StayForm>(() => ({ location: "", checkIn: inDays(30), checkOut: inDays(33), guests: 2, rooms: 1, note: "" }))
  const patch = (p: Partial<StayForm>) => setF((s) => ({ ...s, ...p }))
  const requestRef = useRef<HTMLDivElement>(null)
  const noteCount = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB")

  const items = useMemo(() => q.data?.items ?? [], [q.data])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) { const c = cityOfPlace(i.toPlace); if (c) m.set(c.slug, (m.get(c.slug) ?? 0) + 1) }
    return m
  }, [items])
  const cities = STAY_CITIES.filter((c) => (region === "all" || c.region === region) && cityMatches(c, search))
  const needle = fold(search)
  const listed = items.filter((i) => {
    if (city && cityOfPlace(i.toPlace)?.slug !== city.slug) return false
    if (!needle) return true
    const place = cityOfPlace(i.toPlace)
    return [i.toPlace, i.title[locale], i.summary[locale] ?? ""].some((s) => fold(s).includes(needle)) || (!!place && cityMatches(place, needle))
  })
  const toRequest = () => requestRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  const selectCity = (c: StayCity) => {
    if (city?.slug === c.slug) { setCity(null); return }
    setCity(c)
    patch({ location: t(cityKey(c, "name")) })
  }

  if (loaded && !enabled) return <Unavailable title={t("services.staysTitle")} />
  const details = { location: f.location.trim(), checkIn: f.checkIn, checkOut: f.checkOut, guests: f.guests, rooms: f.rooms, ...(f.note.trim() ? { note: f.note.trim() } : {}) }
  const valid = f.location.trim().length >= 2 && f.checkOut > f.checkIn && f.guests >= 1 && f.rooms >= 1
  const featured = region === "all" && !search.trim()
  const tab = (active: boolean) => `min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors ${active ? "border-navy-950 bg-navy-950 text-white" : "border-line bg-white text-navy-950 hover:border-navy-900"}`

  return (
    <>
      <Hero />
      <div className="mx-auto max-w-6xl px-4 pb-14 md:px-6">
        <ServiceIntro service="stays" className="mt-6 md:mt-8" />
        <section id="destinations" className="scroll-mt-24 pt-6 md:pt-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-display text-3xl md:text-4xl">{t("stays.destinationsTitle")}</h2>
              <p className="mt-2 max-w-2xl leading-7 text-steel">{t("stays.destinationsLead")}</p>
            </div>
            <label className="relative block w-full shrink-0 lg:w-72">
              <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-steel" />
              <input type="search" className="field h-11 w-full ps-10" dir="auto" placeholder={t("listings.searchPlaceholder")} aria-label={t("stays.filterLabel")} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="stay-search" />
            </label>
          </div>
          <div role="group" aria-label={t("stays.regionsLabel")} className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
            {(["all", ...STAY_REGIONS.filter((r) => STAY_CITIES.some((c) => c.region === r))] as const).map((r) => <button key={r} type="button" aria-pressed={region === r} className={tab(region === r)} onClick={() => setRegion(r)}>{t(`stays.regions.${r}`)}</button>)}
          </div>
          <ul className="mt-5 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4" data-testid="city-grid">
            {cities.map((c, i) => <CityCard key={c.slug} city={c} count={counts.get(c.slug) ?? 0} selected={city?.slug === c.slug} feature={featured && i === 0} onSelect={() => selectCity(c)} />)}
            <li>
              <a href={`#${REQUEST_ID}`} className="flex h-44 flex-col justify-center rounded-[20px] border border-dashed border-steel/50 bg-white/70 p-4 transition-colors hover:border-orange md:h-52">
                <MapPin className="size-6 text-orange-700" aria-hidden />
                <span className="font-display mt-3 block text-lg leading-snug">{t("stays.elsewhereTitle")}</span>
                <span className="mt-1 block text-sm leading-5 text-steel">{t("stays.elsewhereBody")}</span>
              </a>
            </li>
          </ul>
          <p className="mt-3 text-xs text-steel">{t("stays.photoNote")} <a href="/media/CREDITS.md" className="underline underline-offset-2">{t("stays.photoCredits")}</a></p>
        </section>

        <section className="mt-12" aria-labelledby="stay-listings">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="stay-listings" className="font-display text-2xl md:text-3xl">{city ? t("stays.listingsIn", { city: t(cityKey(city, "name")) }) : t("stays.listingsTitle")}</h2>
              <p className="mt-1 text-sm text-steel">{t("stays.listingsLead")}</p>
            </div>
            {city && <button type="button" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-royal underline underline-offset-2" onClick={() => setCity(null)}><X className="size-4" aria-hidden />{t("stays.clearCity")}</button>}
          </div>
          {q.isLoading && <LoadingState className="mt-5" label={t("common.loading")} rows={2} />}
          {q.isError && <ErrorState compact className="mt-5" title={t("guide.services.form.listingsErrorTitle")} body={t("guide.services.form.listingsErrorBody")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />}
          {q.data && listed.length === 0 && (
            <div className="mt-5" data-testid="stay-listings-empty">
              <EmptyState compact icon={<BedDouble />} title={t("stays.noneTitle")} body={items.length ? t("stays.noneBody") : t("stays.noneAll")} action={<button type="button" className="btn-orange mt-2 inline-flex" onClick={toRequest}>{city ? t("stays.askInCity", { city: t(cityKey(city, "name")) }) : t("stays.ctaRequest")}</button>} />
            </div>
          )}
          {listed.length > 0 && (
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="listing-grid">
              {listed.map((i) => (
                <ListingCard key={i.id} item={i} onRequest={() => {
                  setF((s) => ({ ...s, location: i.toPlace, note: s.note.trim() ? s.note : t("stays.interestedIn", { title: i.title[locale] }).slice(0, NOTE_MAX) }))
                  toRequest()
                }} />
              ))}
            </ul>
          )}
        </section>

        <div id={REQUEST_ID} ref={requestRef} className="mt-14 scroll-mt-24">
          <ServiceFormFrame type="STAY" menuKey="stays" title={t("listings.requestForm")} lead={t("stays.requestLead")} details={details} valid={valid} embedded>
            <div className="sm:col-span-2"><DestinationCombo id="s-loc" value={f.location} onChange={(location) => patch({ location })} /></div>
            <div className="text-sm sm:col-span-2">
              <p className="font-medium">{t("stays.dates")}</p>
              <div className="mt-1"><DateRangeField idIn="s-in" idOut="s-out" checkIn={f.checkIn} checkOut={f.checkOut} min={today()} onChange={patch} /></div>
            </div>
            <CounterField variant="field" id="s-guests" label={t("services.guests")} value={f.guests} min={1} max={20} onChange={(guests) => patch({ guests })} />
            <CounterField variant="field" id="s-rooms" label={t("services.rooms")} value={f.rooms} min={1} max={10} onChange={(rooms) => patch({ rooms })} />
            <div className="sm:col-span-2">
              <Field id="s-note" label={t("services.note")} optional>
                <textarea id="s-note" className="field block h-32 w-full resize-none overflow-y-auto py-2.5 leading-6" dir="auto" maxLength={NOTE_MAX} placeholder={t("stays.notePlaceholder")} aria-describedby="s-note-count" value={f.note} onChange={(e) => patch({ note: e.target.value })} />
                <p id="s-note-count" className="mt-1 text-end text-xs text-steel">{t("stays.noteCount", { n: noteCount.format(f.note.length), max: noteCount.format(NOTE_MAX) })}</p>
              </Field>
            </div>
          </ServiceFormFrame>
        </div>
      </div>
    </>
  )
}
