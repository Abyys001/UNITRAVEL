"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Armchair, BedDouble, Bus, ClipboardList, CreditCard, FileText, Globe, House, Languages, LifeBuoy, Mail, Package, Phone, Plane, SearchCheck, ShieldCheck, Stamp, Star, TrainFront, Truck, type LucideIcon } from "lucide-react"
import Link from "next/link"

import type { MenuKey } from "@unitravel/contracts"
import { IconBadge } from "@unitravel/ui/brand/art"
import { Reveal } from "@unitravel/ui/brand/reveal"

import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { useSite } from "@/lib/site"

type Pattern = "feature" | "request" | "apply" | "track" | "member" | "soon"
type Service = { key: Exclude<MenuKey, "track" | "support">; icon: LucideIcon; path: string; pattern: Pattern }

// One row per service in the client's menu (UniTravel-Content.docx §1). Pattern follows how the service really works.
const SERVICES: Service[] = [
  { key: "flights", icon: Plane, path: "#search", pattern: "feature" },
  { key: "hotels", icon: BedDouble, path: "/hotels", pattern: "request" },
  { key: "trains", icon: TrainFront, path: "/trains", pattern: "request" },
  { key: "buses", icon: Bus, path: "/buses", pattern: "request" },
  { key: "stays", icon: House, path: "/stays", pattern: "request" },
  { key: "visa", icon: Stamp, path: "/visa", pattern: "apply" },
  { key: "tours", icon: Globe, path: "/tours", pattern: "request" },
  { key: "cip", icon: Armchair, path: "/cip", pattern: "request" },
  { key: "cargo", icon: Package, path: "/cargo", pattern: "track" },
  { key: "insurance", icon: ShieldCheck, path: "/insurance", pattern: "apply" },
  { key: "card", icon: CreditCard, path: "/card", pattern: "soon" },
  { key: "club", icon: Star, path: "/club", pattern: "member" },
]

const chip = "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold"

/** Service explorer: every service, flag-aware. A switched-off service is shown as not open and has no link or form. */
export function ServiceExplorer() {
  const { t, href } = useI18n()
  const { me } = useSession()
  const { loaded, on } = useSite()
  return (
    <section aria-labelledby="services" className="mx-auto max-w-7xl px-4 pt-20 md:px-6 md:pt-28" data-testid="service-explorer">
      <Reveal className="max-w-2xl">
        <h2 id="services" className="font-display text-3xl md:text-5xl">{t("home.servicesTitle")}</h2>
        <p className="mt-4 text-lg text-steel">{t("home.servicesLead")}</p>
      </Reveal>
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SERVICES.map((s, i) => {
          // Flights are always open; the travel card never leaves "soon" (no product exists); the rest follow /v1/site.
          const open = s.key === "flights" || (loaded && s.pattern !== "soon" && on(s.key))
          const label = t(`nav.${s.key}`)
          const body = t(`home.svc.${s.key}`)
          const state = !open ? t("home.st.soon") : t(`home.st.${s.pattern === "feature" ? "search" : s.pattern}`)
          if (s.pattern === "feature") {
            return (
              <Reveal as="li" key={s.key} delay={i * 60} className="sm:col-span-2 lg:row-span-2">
                <a href="#search" className="glass relative isolate flex h-full min-h-64 flex-col justify-end overflow-hidden rounded-[20px] bg-navy-950 p-6 text-white md:p-8" data-testid={`svc-${s.key}`} data-open="true">
                  <picture aria-hidden>
                    <source srcSet="/media/photos/travel.avif" type="image/avif" />
                    {/* eslint-disable-next-line @next/next/no-img-element -- pre-encoded AVIF/WebP set */}
                    <img src="/media/photos/travel.webp" alt="" loading="lazy" className="absolute inset-0 -z-10 size-full object-cover opacity-60" />
                  </picture>
                  <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-navy-950/95 via-navy-950/55 to-navy-950/20" />
                  <IconBadge tone="onDark"><s.icon aria-hidden /></IconBadge>
                  <span className={`${chip} mt-5 w-fit bg-orange text-navy-950`}>{state}</span>
                  <span className="font-display mt-3 block text-3xl">{label}</span>
                  <span className="mt-2 block max-w-md leading-relaxed text-white/85">{body}</span>
                  <span className="btn-orange mt-6 w-fit">{t("search.submit")}<ArrowRight aria-hidden className="arrow-nudge size-4 rtl:rotate-180" /></span>
                </a>
              </Reveal>
            )
          }
          const base = "liquid flex h-full flex-col gap-3 rounded-[20px] p-5"
          const head = (
            <>
              <span className="flex items-center justify-between gap-2">
                <IconBadge><s.icon aria-hidden /></IconBadge>
                <span className={`${chip} ${open ? "bg-info-subtle text-info-subtle-fg" : "bg-muted text-steel"}`}>{state}</span>
              </span>
              <span className="font-display block text-xl leading-snug">{label}</span>
              <span className="block text-sm leading-relaxed text-steel">{body}</span>
            </>
          )
          if (!open) {
            return <Reveal as="li" key={s.key} delay={i * 60}><div className={`${base} opacity-80`} data-testid={`svc-${s.key}`} data-open="false">{head}<span className="mt-auto text-sm font-semibold text-steel">{t("home.svcSoon")}</span></div></Reveal>
          }
          if (s.pattern === "track") {
            return (
              <Reveal as="li" key={s.key} delay={i * 60}>
                <div className={base} data-testid={`svc-${s.key}`} data-open="true">
                  {head}
                  <span className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
                    <Link href={href(s.path)} className="inline-flex items-center gap-1 text-royal hover:underline pointer-coarse:min-h-11">{t("home.st.request")}<ArrowRight aria-hidden className="size-4 rtl:rotate-180" /></Link>
                    <Link href={href("/shipments")} className="inline-flex items-center gap-1 text-royal hover:underline pointer-coarse:min-h-11"><Truck aria-hidden className="size-4" />{t("nav.shipments")}</Link>
                  </span>
                </div>
              </Reveal>
            )
          }
          const to = s.pattern === "member" && !me ? `/sign-in?next=${encodeURIComponent("/club")}` : s.path
          const cta = s.pattern === "member" && !me ? t("home.svcSign") : t("home.st.request")
          return (
            <Reveal as="li" key={s.key} delay={i * 60}>
              <Link href={href(to)} className={`${base} card-lift group ${s.pattern === "apply" ? "border-s-4 !border-s-orange" : ""}`} data-testid={`svc-${s.key}`} data-open="true">
                {head}
                <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-royal">{cta}<ArrowRight aria-hidden className="arrow-nudge size-4 rtl:rotate-180" /></span>
              </Link>
            </Reveal>
          )
        })}
      </ul>
    </section>
  )
}

/** Only benefits the product delivers today. Instalments, instant refunds, price alerts and round-the-clock support are not
 *  claimed here: they are unverified (docs/content/CLAIMS-TO-VERIFY.md C3, C5, C6, C9). */
export function Benefits() {
  const { t } = useI18n()
  const items: [LucideIcon, "1" | "2" | "3" | "4"][] = [[ClipboardList, "1"], [FileText, "2"], [SearchCheck, "3"], [Languages, "4"]]
  return (
    <section aria-labelledby="benefits" className="mx-auto max-w-7xl px-4 pt-20 md:px-6 md:pt-28" data-testid="benefits">
      <Reveal><h2 id="benefits" className="font-display text-3xl md:text-4xl">{t("home.benefitsTitle")}</h2></Reveal>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([Icon, n], i) => (
          <Reveal as="li" key={n} delay={i * 80} className="liquid flex items-start gap-4 rounded-[20px] p-5">
            <IconBadge><Icon aria-hidden /></IconBadge>
            <div><h3 className="font-bold leading-snug">{t(`home.benefit${n}`)}</h3><p className="mt-1 text-sm text-steel">{t(`home.benefit${n}Body`)}</p></div>
          </Reveal>
        ))}
      </ul>
    </section>
  )
}

type Card = { slug: string; title: string; summary: string; featuredImage: string | null; imageAlt: string | null }

/** Destination guides from the content system; hidden while none are published. Editorial only: no prices, no offers. */
export function FeaturedDestinations() {
  const { t, href, locale } = useI18n()
  const q = useQuery({
    queryKey: ["home-destinations", locale], staleTime: 5 * 60_000,
    queryFn: () => api<{ items: Card[] }>(`/v1/cms/entries?kind=GUIDE&category=destination&locale=${locale}&pageSize=4`),
  })
  const items = q.data?.items ?? []
  if (items.length === 0) return null
  return (
    <section aria-labelledby="dest" className="mx-auto max-w-7xl px-4 pt-20 md:px-6 md:pt-28" data-testid="home-destinations">
      <Reveal className="flex items-end justify-between gap-4">
        <h2 id="dest" className="font-display text-3xl md:text-4xl">{t("home.destTitle")}</h2>
        <Link href={href("/destinations")} className="inline-flex items-center gap-2 font-semibold text-royal underline-offset-4 hover:underline pointer-coarse:min-h-11">{t("home.destAll")}<ArrowRight aria-hidden className="size-4 rtl:rotate-180" /></Link>
      </Reveal>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((e) => (
          <li key={e.slug}>
            <Link href={href(`/destinations/${e.slug}`)} className="liquid card-lift flex h-full flex-col overflow-hidden rounded-[20px]">
              {e.featuredImage && /^(https:\/\/|\/(?!\/))/.test(e.featuredImage) && (
                // eslint-disable-next-line @next/next/no-img-element -- editorial image from the content system
                <img src={e.featuredImage} alt={e.imageAlt ?? ""} loading="lazy" decoding="async" className="aspect-[16/10] w-full object-cover" />
              )}
              <span className="flex flex-1 flex-col gap-1 p-4"><span className="font-display text-lg leading-snug">{e.title}</span>{e.summary && <span className="line-clamp-2 text-sm text-steel">{e.summary}</span>}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Links to help, plus phone and email only when the owner has set real ones (placeholders never reach /v1/site; no hours claimed). */
export function SupportBand() {
  const { t, href } = useI18n()
  const { me } = useSession()
  const { site } = useSite()
  const { phone, email } = site.support
  const links: [LucideIcon, string, string][] = [
    [LifeBuoy, "/support", t("home.helpContact")], [SearchCheck, "/track", t("home.helpTrack")], [FileText, "/faq", t("home.helpFaq")],
    ...(me ? [[ClipboardList, "/requests", t("home.helpRequests")] as [LucideIcon, string, string]] : []),
  ]
  return (
    <section aria-labelledby="help" className="mx-auto max-w-7xl px-4 pt-20 md:px-6 md:pt-28" data-testid="home-support">
      <Reveal className="liquid-dark grid gap-8 rounded-[28px] p-8 text-white md:grid-cols-[1fr_1.2fr] md:p-12">
        <div>
          <h2 id="help" className="font-display text-3xl md:text-4xl">{t("home.helpTitle")}</h2>
          <p className="mt-4 leading-relaxed text-white/85">{t("home.helpBody")}</p>
          {(phone || email) && (
            <p className="mt-6 space-y-2 text-sm">
              {phone && <a className="flex items-center gap-2 font-semibold underline-offset-4 hover:underline pointer-coarse:min-h-11" href={`tel:${phone.replace(/\s/g, "")}`} dir="ltr"><Phone aria-hidden className="size-4 text-orange-300" />{phone}</a>}
              {email && <a className="flex items-center gap-2 font-semibold underline-offset-4 hover:underline pointer-coarse:min-h-11" href={`mailto:${email}`} dir="ltr"><Mail aria-hidden className="size-4 text-orange-300" />{email}</a>}
            </p>
          )}
        </div>
        <ul className="grid content-center gap-3 sm:grid-cols-2">
          {links.map(([Icon, to, label]) => (
            <li key={to}><Link href={href(to)} className="btn-glass w-full justify-between pointer-coarse:min-h-11"><span className="inline-flex items-center gap-2"><Icon aria-hidden className="size-4 text-orange-300" />{label}</span><ArrowRight aria-hidden className="size-4 rtl:rotate-180" /></Link></li>
          ))}
        </ul>
      </Reveal>
    </section>
  )
}
