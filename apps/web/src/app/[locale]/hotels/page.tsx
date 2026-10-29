import { ArrowRight, BedDouble, Building2, CalendarDays, Car, CheckCircle2, CreditCard, Gem, Headset, MapPin, Plane, ReceiptText, Sparkles, Star, Users, type LucideIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { type Block, hotelGuide, type Item, type Locale, type Term, translate, visibleItems } from "@unitravel/i18n"
import { IconBadge, Ribbon } from "@unitravel/ui/brand/art"
import { Reveal } from "@unitravel/ui/brand/reveal"

import { jsonLd, Terms } from "@/components/content-blocks"
import { HotelRequest } from "@/components/hotel-request"
import { contentFlags } from "@/lib/site-server"

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = (await params).locale as Locale
  return { title: translate(locale, "hotels.metaTitle"), description: translate(locale, "hotels.metaDescription"), alternates: { languages: { en: "/en/hotels", fa: "/fa/hotels", "x-default": "/fa/hotels" } } }
}

const para = (i: Item | undefined) => i?.blocks.flatMap((b) => (b.kind === "p" ? [b.text] : [])) ?? []
const list = (i: Item | undefined, kind: "ol" | "ul") => i?.blocks.flatMap((b: Block) => (b.kind === kind ? b.items : [])) ?? []
const terms = (i: Item | undefined): Term[] => i?.blocks.flatMap((b) => (b.kind === "dl" ? b.items : [])) ?? []
/** "Title: body" items (steps) split at the first colon, Persian or Latin. */
const split = (s: string) => { const at = s.search(/[:：]/); return at < 0 ? [s, ""] : [s.slice(0, at).trim(), s.slice(at + 1).trim()] }

const WHY_ICONS: Record<string, LucideIcon> = { variety: BedDouble, pricing: ReceiptText, support: Headset, instalments: CreditCard }
const FACTOR_ICONS = [MapPin, Star, CalendarDays]
const TYPE_ICONS = [Car, Building2, Gem, Users, Plane]

/**
 * Hotels page (owner brief 29 Oct 2026, ADR-0017). Server-rendered so the guide is indexable. The service sections (hero
 * promise, why us, the five steps, the request form) follow `hotels.enabled` from GET /v1/site; the guide sections are
 * general information and always render. No listing, availability or price is ever shown (ADR-0004, ADR-0015).
 */
export default async function Page({ params }: Props) {
  const locale = (await params).locale as Locale
  const tr = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate(locale, k, v)
  const flags = await contentFlags()
  const on = flags["hotels.enabled"] === true
  const items = visibleItems(hotelGuide[locale], flags)
  const get = (id: string) => items.find((i) => i.id === id)
  const steps = list(get("steps"), "ol").map(split)
  const why = ["variety", "pricing", "support", "instalments"].map(get).filter((i): i is Item => !!i)

  const title = tr("hotels.heroTitle")
  const accent = tr("hotels.heroAccent")
  const [before, after] = title.includes(accent) ? [title.slice(0, title.indexOf(accent)), title.slice(title.indexOf(accent) + accent.length)] : [title, ""]

  const nav = [
    ...(on ? [["why", tr("hotels.whyTitle")], ["steps", tr("hotels.stepsTitle")]] : []),
    ["guide", tr("hotels.guideTitle")],
    ...items.filter((i) => ["types", "stars", "rooms", "meals", "terms", "tips"].includes(i.id)).map((i) => [i.id, i.heading]),
    ...(on ? [["request", tr("hotels.requestTitle")]] : []),
  ] as [string, string][]

  const howTo = on && steps.length ? {
    "@context": "https://schema.org", "@type": "HowTo", name: get("steps")!.heading, inLanguage: locale,
    step: steps.map(([name, text], i) => ({ "@type": "HowToStep", position: i + 1, name, text })),
  } : null
  const glossary = {
    "@context": "https://schema.org", "@type": "DefinedTermSet", name: tr("hotels.guideTitle"), inLanguage: locale,
    hasDefinedTerm: ["types", "meals", "terms"].flatMap((id) => terms(get(id))).map((x) => ({ "@type": "DefinedTerm", name: x.term, description: x.text, ...(x.code ? { termCode: x.code } : {}) })),
  }

  return (
    <>
      {howTo && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(howTo) }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(glossary) }} />

      {/* 1 · Hero: brand night band with photo; glass only on this dark surface (DESIGN.md surface rule). */}
      <section className="relative isolate overflow-hidden bg-navy-950 text-white" data-testid="hotels-hero">
        <picture>
          <source srcSet="/media/photos/travel.avif" type="image/avif" />
          {/* eslint-disable-next-line @next/next/no-img-element -- pre-encoded AVIF/WebP set */}
          <img src="/media/photos/travel.webp" alt="" className="absolute inset-0 -z-10 size-full object-cover" />
        </picture>
        <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgb(6_31_76/0.95)_0%,rgb(8_47_107/0.85)_50%,rgb(12_103_185/0.45)_100%)] rtl:bg-[linear-gradient(260deg,rgb(6_31_76/0.95)_0%,rgb(8_47_107/0.85)_50%,rgb(12_103_185/0.45)_100%)]" />
        <div aria-hidden className="bg-dots absolute inset-0 -z-10 opacity-40" />
        <div className="mx-auto max-w-7xl px-4 pb-10 pt-28 md:px-6 md:pb-16 md:pt-36">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-semibold tracking-[0.12em] text-white/90 backdrop-blur">
            <span className="size-1.5 rounded-full bg-orange" />{tr("hotels.eyebrow")}
          </p>
          <h1 className="font-display mt-6 max-w-3xl text-[2.4rem] leading-[1.08] md:text-6xl">
            {on ? <>{before}<span className="text-gradient-orange">{accent}</span>{after}</> : tr("hotels.guideTitle")}
          </h1>
          {on && <p className="mt-5 max-w-2xl text-xl font-semibold text-white">{get("online")?.heading}</p>}
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white/85">{on ? tr("hotels.heroLead") : tr("hotels.heroLeadOff")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {on
              ? <Link href="#request" className="btn-orange">{tr("hotels.ctaRequest")}<ArrowRight className="arrow-nudge size-4 rtl:rotate-180" aria-hidden /></Link>
              : <Link href={`/${locale}/support`} className="btn-orange">{tr("hotels.ctaSupport")}<ArrowRight className="arrow-nudge size-4 rtl:rotate-180" aria-hidden /></Link>}
            <Link href="#guide" className="btn-glass">{tr("hotels.ctaGuide")}</Link>
          </div>
          {on && (
            <ul className="mt-10 grid max-w-4xl gap-3 sm:grid-cols-3">
              {why.slice(0, 3).map((i) => {
                const Icon = WHY_ICONS[i.id] ?? Sparkles
                return <li key={i.id} className="glass flex items-center gap-3 rounded-2xl p-4 text-sm font-semibold"><Icon className="size-5 shrink-0 text-cyan" aria-hidden />{i.heading}</li>
              })}
            </ul>
          )}
        </div>
        <Ribbon className="relative" />
      </section>

      {/* 2 · On this page. */}
      <nav aria-label={tr("hotels.onThisPage")} className="sticky top-16 z-20 border-b border-line bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
        <ul className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-3 md:px-6 [scrollbar-width:none]">
          {nav.map(([id, label]) => (
            <li key={id} className="shrink-0"><a href={`#${id}`} className="inline-flex rounded-full border border-line px-3.5 py-1.5 text-sm font-semibold text-navy-900 hover:border-royal hover:text-royal pointer-coarse:min-h-11 pointer-coarse:items-center">{label}</a></li>
          ))}
        </ul>
      </nav>

      {/* 3 · Why Uni Travel (service on only). */}
      {on && (
        <section id="why" aria-labelledby="why-h" className="mx-auto max-w-7xl scroll-mt-32 px-4 pt-16 md:px-6 md:pt-24">
          <Reveal className="max-w-3xl">
            <h2 id="why-h" className="font-display text-3xl md:text-5xl">{get("why")?.heading}</h2>
            {para(get("why")).map((p) => <p key={p} className="mt-4 text-lg leading-8 text-steel">{p}</p>)}
          </Reveal>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {why.map((i, n) => {
              const Icon = WHY_ICONS[i.id] ?? Sparkles
              return (
                <Reveal as="li" key={i.id} delay={n * 90} className="card-brand card-lift flex items-start gap-5 p-6">
                  <IconBadge><Icon aria-hidden /></IconBadge>
                  <div><h3 className="text-xl font-bold leading-snug">{i.heading}</h3>{para(i).map((p) => <p key={p} className="mt-2 leading-7 text-steel">{p}</p>)}</div>
                </Reveal>
              )
            })}
          </ul>
        </section>
      )}

      {/* 4 · The five-step workflow (service on only). */}
      {on && steps.length > 0 && (
        <section id="steps" aria-labelledby="steps-h" className="mx-auto max-w-7xl scroll-mt-32 px-4 pt-16 md:px-6 md:pt-24" data-testid="hotel-steps">
          <Reveal className="max-w-2xl">
            <h2 id="steps-h" className="font-display text-3xl md:text-5xl">{get("steps")?.heading}</h2>
            <p className="mt-4 text-lg text-steel">{tr("hotels.stepsLead")}</p>
          </Reveal>
          <div className="relative mt-14">
            <svg aria-hidden viewBox="0 0 1200 60" preserveAspectRatio="none" className="absolute inset-x-0 top-7 hidden h-14 w-full lg:block rtl:-scale-x-100">
              <path d="M40 40C260 -10 420 70 600 30S960 -10 1160 36" fill="none" stroke="var(--color-royal)" strokeOpacity=".45" strokeWidth="2.5" strokeDasharray="8 10" className="animate-dash" />
            </svg>
            <ol className="relative grid gap-10 md:grid-cols-2 lg:grid-cols-5 lg:gap-6">
              {steps.map(([h, b], i) => (
                <Reveal as="li" key={h} delay={i * 110} className="relative">
                  <span className={`relative z-10 grid size-14 place-items-center rounded-full border-4 border-cloud font-display text-lg shadow-[var(--shadow-card)] ${i === steps.length - 1 ? "bg-orange text-navy-950" : "bg-navy-900 text-white"}`}>
                    <span className="ltr">{String(i + 1).padStart(2, "0")}</span>
                  </span>
                  <h3 className="mt-5 text-lg font-bold">{h}</h3>
                  {b && <p className="mt-2 leading-relaxed text-steel">{b}</p>}
                </Reveal>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* 5 · Hotel guide: always shown. */}
      <section id="guide" aria-labelledby="guide-h" className="mx-auto max-w-7xl scroll-mt-32 px-4 pt-16 md:px-6 md:pt-24">
        <Reveal className="max-w-3xl">
          <h2 id="guide-h" className="font-display text-3xl md:text-5xl">{tr("hotels.guideTitle")}</h2>
          <p className="mt-4 text-lg text-steel">{tr("hotels.guideLead")}</p>
        </Reveal>

        {/* Price factors and cheaper stays side by side. */}
        <div className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {get("price-factors") && (
            <Reveal className="card-brand p-6 md:p-8">
              <h3 className="font-display text-2xl">{get("price-factors")!.heading}</h3>
              {para(get("price-factors")).map((p) => <p key={p} className="mt-3 leading-8 text-steel">{p}</p>)}
              <ul className="mt-6 grid gap-4 sm:grid-cols-3">
                {terms(get("price-factors")).map((x, i) => {
                  const Icon = FACTOR_ICONS[i] ?? Sparkles
                  return <li key={x.term} className="rounded-2xl bg-cloud p-4"><Icon className="size-6 text-royal" aria-hidden /><p className="mt-3 font-bold">{x.term}</p><p className="mt-1 text-sm leading-6 text-steel">{x.text}</p></li>
                })}
              </ul>
            </Reveal>
          )}
          {get("cheap") && (
            <Reveal delay={90} className="relative overflow-hidden rounded-[24px] bg-brand p-6 text-white md:p-8">
              <div aria-hidden className="bg-dots absolute inset-0 opacity-40" />
              <div className="relative">
                <IconBadge tone="onDark"><Sparkles aria-hidden /></IconBadge>
                <h3 className="font-display mt-5 text-2xl">{get("cheap")!.heading}</h3>
                {para(get("cheap")).map((p) => <p key={p} className="mt-3 leading-7 text-white/85">{p}</p>)}
                <ul className="mt-4 space-y-3">
                  {list(get("cheap"), "ul").map((x) => <li key={x} className="flex gap-3 leading-7"><CheckCircle2 className="mt-1 size-5 shrink-0 text-orange" aria-hidden />{x}</li>)}
                </ul>
              </div>
            </Reveal>
          )}
        </div>

        {/* Accommodation types as cards. */}
        {get("types") && (
          <section id="types" aria-labelledby="types-h" className="scroll-mt-32 pt-16">
            <h3 id="types-h" className="font-display text-2xl md:text-3xl">{get("types")!.heading}</h3>
            {para(get("types")).map((p) => <p key={p} className="mt-3 max-w-3xl leading-8 text-steel">{p}</p>)}
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {terms(get("types")).map((x, i) => {
                const Icon = TYPE_ICONS[i] ?? Building2
                return (
                  <Reveal as="li" key={x.term} delay={i * 70} className="card-brand card-lift p-5">
                    <IconBadge className="size-12 [&>svg]:size-5"><Icon aria-hidden /></IconBadge>
                    <p className="mt-4 font-bold leading-snug">{x.term}</p>
                    <p className="mt-2 text-sm leading-6 text-steel">{x.text}</p>
                  </Reveal>
                )
              })}
            </ul>
          </section>
        )}

        {/* Star ratings with drawn stars. */}
        {get("stars") && (
          <section id="stars" aria-labelledby="stars-h" className="scroll-mt-32 pt-16">
            <h3 id="stars-h" className="font-display text-2xl md:text-3xl">{get("stars")!.heading}</h3>
            {para(get("stars")).map((p) => <p key={p} className="mt-3 max-w-3xl leading-8 text-steel">{p}</p>)}
            <ol className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
              {terms(get("stars")).map((x, i) => (
                <li key={x.term} className="grid items-center gap-2 px-5 py-4 sm:grid-cols-[9rem_10rem_1fr] sm:gap-6">
                  <span className="flex gap-0.5" aria-hidden dir="ltr">{Array.from({ length: 5 }, (_, s) => <Star key={s} className={`size-4 ${s <= i ? "fill-orange text-orange" : "text-line"}`} />)}</span>
                  <span className="font-bold text-navy-950">{x.term}</span>
                  <span className="leading-7 text-steel">{x.text}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Room types and meal plans. */}
        <div className="grid gap-10 pt-16 lg:grid-cols-2">
          {get("rooms") && (
            <section id="rooms" aria-labelledby="rooms-h" className="scroll-mt-32">
              <h3 id="rooms-h" className="font-display text-2xl md:text-3xl">{get("rooms")!.heading}</h3>
              {para(get("rooms")).map((p) => <p key={p} className="mt-3 leading-8 text-steel">{p}</p>)}
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {terms(get("rooms")).map((x) => (
                  <li key={x.term} className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4">
                    <BedDouble className="mt-0.5 size-5 shrink-0 text-royal" aria-hidden />
                    <div><p className="font-bold leading-snug">{x.term}</p><p className="mt-1 text-sm leading-6 text-steel">{x.text}</p></div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {get("meals") && (
            <section id="meals" aria-labelledby="meals-h" className="scroll-mt-32">
              <h3 id="meals-h" className="font-display text-2xl md:text-3xl">{get("meals")!.heading}</h3>
              {para(get("meals")).map((p) => <p key={p} className="mt-3 leading-8 text-steel">{p}</p>)}
              <Terms items={terms(get("meals"))} className="mt-6" />
            </section>
          )}
        </div>

        {/* Check-in terms and tips. */}
        <div className="grid gap-10 pt-16 lg:grid-cols-[1.3fr_1fr]">
          {get("terms") && (
            <section id="terms" aria-labelledby="terms-h" className="scroll-mt-32">
              <h3 id="terms-h" className="font-display text-2xl md:text-3xl">{get("terms")!.heading}</h3>
              <Terms items={terms(get("terms"))} className="mt-6" />
            </section>
          )}
          {get("tips") && (
            <section id="tips" aria-labelledby="tips-h" className="scroll-mt-32">
              <div className="card-brand p-6 md:p-8">
                <h3 id="tips-h" className="font-display text-2xl md:text-3xl">{get("tips")!.heading}</h3>
                <ul className="mt-6 space-y-4">
                  {list(get("tips"), "ul").map((x) => <li key={x} className="flex gap-3 leading-7 text-steel"><CheckCircle2 className="mt-1 size-5 shrink-0 text-orange" aria-hidden />{x}</li>)}
                </ul>
              </div>
            </section>
          )}
        </div>
      </section>

      {/* 6 · Request form (steps 1 and 2 of the workflow). */}
      {on && (
        <section id="request" aria-label={tr("hotels.requestTitle")} className="mx-auto max-w-3xl scroll-mt-32 px-4 pt-16 md:px-6 md:pt-24">
          <HotelRequest />
        </section>
      )}

      <p className="mx-auto max-w-3xl px-4 pb-4 pt-12 text-center text-sm leading-6 text-steel md:px-6" data-testid="general-notice">{tr("hotels.notice")}</p>
    </>
  )
}
