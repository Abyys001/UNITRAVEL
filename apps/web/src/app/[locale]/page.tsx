"use client"

import { ArrowRight, BadgeCheck, HandCoins, Headset, Languages, Package, ShieldCheck, Smartphone } from "lucide-react"
import Link from "next/link"

import { FlightPath, GlobeLines, IconBadge, Ribbon } from "@unitravel/ui/brand/art"
import { Reveal } from "@unitravel/ui/brand/reveal"

import { HeroVideo } from "@/components/hero-video"
import { SearchForm, type SearchParamsShape } from "@/components/search-form"
import { useI18n } from "@/lib/i18n"

// Seeded cities only (packages/db reference data); tiles prefill a search, never show prices or availability.
const ROUTES = [
  { code: "IST", en: "Istanbul", fa: "استانبول", photo: "istanbul", from: "THR" },
  { code: "EVN", en: "Yerevan", fa: "ایروان", photo: "yerevan", from: "THR" },
  { code: "LON", en: "London", fa: "لندن", photo: "london", from: "THR" },
  { code: "THR", en: "Tehran", fa: "تهران", photo: "tehran", from: "LON" },
] as const
const CITY = { THR: { en: "Tehran", fa: "تهران" }, LON: { en: "London", fa: "لندن" } } as const

function searchQuery(from: keyof typeof CITY, to: (typeof ROUTES)[number], locale: "en" | "fa") {
  const p: SearchParamsShape = {
    trip: "ONE_WAY", from: { kind: "CITY", code: from, label: CITY[from][locale] }, to: { kind: "CITY", code: to.code, label: to[locale] },
    date: new Date(Date.now() + 23 * 86400_000).toISOString().slice(0, 10), adt: 1, chd: [], inf: 0, cabin: "ECONOMY", flex: false, st: true, ac: false, on: true, gw: true, stops: 2, lay: [240, 360],
  }
  return `/search?q=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(p)))))}`
}

export default function Home() {
  const { t, href, locale } = useI18n()
  const title = t("home.title")
  const accent = t("home.titleAccent")
  const [before, after] = title.includes(accent) ? [title.slice(0, title.indexOf(accent)), title.slice(title.indexOf(accent) + accent.length)] : [title, ""]
  const steps = [["home.step1", "home.step1Body"], ["home.step2", "home.step2Body"], ["home.step3", "home.step3Body"], ["home.step4", "home.step4Body"]] as const
  const trust = [[ShieldCheck, "home.trust1", "home.trust1Body"], [Headset, "home.trust2", "home.trust2Body"], [HandCoins, "home.trust3", "home.trust3Body"], [Languages, "home.trust4", "home.trust4Body"]] as const

  return (
    <>
      {/* 1 · Video hero: booking first, over media (airline pattern), closed by the brand's orange ribbon. */}
      <section className="relative isolate overflow-hidden bg-navy-950 text-white">
        <HeroVideo name="hero" />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(100deg,rgb(6_31_76/0.94)_0%,rgb(8_47_107/0.82)_42%,rgb(12_103_185/0.35)_100%)] rtl:bg-[linear-gradient(260deg,rgb(6_31_76/0.94)_0%,rgb(8_47_107/0.82)_42%,rgb(12_103_185/0.35)_100%)]" />
        <div aria-hidden className="bg-dots absolute inset-0 opacity-40" />
        <FlightPath className="absolute end-[-4%] top-[16%] hidden w-[46%] opacity-80 lg:block rtl:-scale-x-100" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-8 pt-28 md:px-6 md:pt-36 lg:grid-cols-[1.05fr_1fr] lg:pb-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-semibold tracking-[0.12em] text-white/90 backdrop-blur">
              <span className="size-1.5 rounded-full bg-orange" />{t("home.eyebrow")}
            </p>
            <h1 className="font-display mt-6 text-[2.5rem] leading-[1.05] md:text-6xl xl:text-7xl">
              {before}<span className="text-gradient-orange">{accent}</span>{after}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/85">{t("home.lead")}</p>
            <p className="glass mt-7 flex max-w-xl gap-3 rounded-2xl p-4 text-sm leading-relaxed text-white/85">
              <BadgeCheck className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden />{t("home.honest")}
            </p>
          </div>
          <div className="relative">
            <div aria-hidden className="absolute -inset-6 -z-10 rounded-[32px] bg-orange/20 blur-3xl" />
            <SearchForm />
          </div>
        </div>
        <Ribbon className="relative" />
      </section>

      {/* 2 · Trust strip: the round outline icons from the brand artwork. */}
      <section aria-labelledby="trust" className="relative z-10 mx-auto -mt-6 max-w-7xl px-4 md:-mt-14 md:px-6">
        <h2 id="trust" className="sr-only">{t("home.trustTitle")}</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {trust.map(([Icon, h, b], i) => (
            <Reveal as="li" key={h} delay={i * 90} className="card-brand card-lift flex items-start gap-4 p-5">
              <IconBadge><Icon aria-hidden /></IconBadge>
              <div><h3 className="font-bold leading-snug">{t(h)}</h3><p className="mt-1 text-sm text-steel">{t(b)}</p></div>
            </Reveal>
          ))}
        </ul>
      </section>

      {/* 3 · How it works: four stops on a dashed flight path. */}
      <section className="mx-auto max-w-7xl px-4 py-20 md:px-6 md:py-28">
        <Reveal className="max-w-2xl">
          <h2 className="font-display text-3xl md:text-5xl">{t("home.stepsTitle")}</h2>
          <p className="mt-4 text-lg text-steel">{t("brand.tagline")}</p>
        </Reveal>
        <div className="relative mt-14">
          <svg aria-hidden viewBox="0 0 1200 60" preserveAspectRatio="none" className="absolute inset-x-0 top-7 hidden h-14 w-full md:block rtl:-scale-x-100">
            <path d="M40 40C260 -10 420 70 600 30S960 -10 1160 36" fill="none" stroke="var(--color-royal)" strokeOpacity=".45" strokeWidth="2.5" strokeDasharray="8 10" className="animate-dash" />
          </svg>
          <ol className="relative grid gap-10 md:grid-cols-4 md:gap-6">
            {steps.map(([h, b], i) => (
              <Reveal as="li" key={h} delay={i * 120} className="relative">
                <span className={`relative z-10 grid size-14 place-items-center rounded-full border-4 border-cloud font-display text-lg shadow-[var(--shadow-card)] ${i === 3 ? "bg-orange text-navy-950" : "bg-navy-900 text-white"}`}>
                  <span className="ltr">{String(i + 1).padStart(2, "0")}</span>
                </span>
                <h3 className="mt-5 text-xl font-bold">{t(h)}</h3>
                <p className="mt-2 leading-relaxed text-steel">{t(b)}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* 4 · Routes we arrange: editorial photo bento, prefilled searches only. */}
      <section className="relative overflow-hidden bg-navy-950 py-20 text-white md:py-28">
        <GlobeLines className="absolute -end-40 -top-40 size-[640px] text-white/[0.06]" />
        <div className="relative mx-auto max-w-7xl px-4 md:px-6">
          <Reveal className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl md:text-5xl">{t("home.routesTitle")}</h2>
              <p className="mt-4 text-lg text-white/75">{t("home.routesBody")}</p>
            </div>
          </Reveal>
          <ul className="mt-12 grid auto-rows-[220px] gap-4 md:grid-cols-4 md:auto-rows-[260px]">
            {ROUTES.map((r, i) => (
              <Reveal as="li" key={r.code} delay={i * 90} variant="scale" className={i === 0 ? "md:col-span-2 md:row-span-2" : i === 3 ? "md:col-span-2" : ""}>
                <Link href={href(searchQuery(r.from, r, locale))} className="group relative block size-full overflow-hidden rounded-[20px] ring-1 ring-white/10">
                  <picture>
                    <source srcSet={`/media/photos/${r.photo}.avif`} type="image/avif" />
                    {/* eslint-disable-next-line @next/next/no-img-element -- pre-encoded AVIF/WebP set */}
                    <img src={`/media/photos/${r.photo}.webp`} alt="" loading="lazy" className="size-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  </picture>
                  <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-navy-950/90 via-navy-950/20 to-transparent" />
                  <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5">
                    <span>
                      <span className="block text-xs font-semibold tracking-[0.18em] text-orange-300" dir="ltr">{r.from} → {r.code}</span>
                      <span className="font-display mt-1 block text-2xl md:text-3xl">{r[locale]}</span>
                    </span>
                    <span className="btn-glass !rounded-full !p-2.5" aria-hidden><ArrowRight className="arrow-nudge size-5 rtl:rotate-180" /></span>
                  </span>
                  <span className="sr-only">{t("home.routesCta")}</span>
                </Link>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* 5 · Cargo band. */}
      <section className="mx-auto max-w-7xl px-4 pt-20 md:px-6 md:pt-28">
        <Reveal className="card-brand grid overflow-hidden md:grid-cols-2">
          <div className="relative min-h-[240px]">
            <picture>
              <source srcSet="/media/photos/cargo.avif" type="image/avif" />
              {/* eslint-disable-next-line @next/next/no-img-element -- pre-encoded AVIF/WebP set */}
              <img src="/media/photos/cargo.webp" alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
            </picture>
            <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-navy-950/30 to-transparent rtl:bg-gradient-to-l" />
          </div>
          <div className="relative p-8 md:p-12">
            <IconBadge><Package aria-hidden /></IconBadge>
            <h2 className="font-display mt-6 text-3xl md:text-4xl">{t("home.cargoTitle")}</h2>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-steel">{t("home.cargoBody")}</p>
            <Link href={href("/cargo")} className="btn-orange mt-8">{t("home.cargoCta")}<ArrowRight className="arrow-nudge size-4 rtl:rotate-180" /></Link>
          </div>
        </Reveal>
      </section>

      {/* 6 · App promo with a real screenshot from the Flutter build. */}
      <section className="mx-auto max-w-7xl px-4 pt-20 md:px-6 md:pt-28">
        <Reveal className="relative overflow-hidden rounded-[28px] bg-brand px-6 pt-10 text-white md:px-14 md:pt-0">
          <div aria-hidden className="bg-dots absolute inset-0 opacity-50" />
          <div className="relative grid items-center gap-10 md:grid-cols-[1.2fr_1fr]">
            <div className="md:py-16">
              <IconBadge tone="onDark"><Smartphone aria-hidden /></IconBadge>
              <h2 className="font-display mt-6 text-3xl md:text-5xl">{t("home.appTitle")}</h2>
              <p className="mt-4 max-w-lg text-lg text-white/80">{t("home.appBody")}</p>
              <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold"><span className="size-2 rounded-full bg-orange" />{t("home.appSoon")}</p>
            </div>
            <div className="relative mx-auto w-[240px] md:w-[270px]">
              <div className="animate-float rounded-[38px] border-[10px] border-navy-950 bg-navy-950 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.7)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- real app screenshot */}
                <img src={`/media/app/${locale === "fa" ? "search-fa" : "search-en"}.png`} alt="" loading="lazy" className="block w-full rounded-[28px]" />
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  )
}
