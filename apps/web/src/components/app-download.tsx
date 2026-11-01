"use client"

import { BellRing, Headset, Languages, type LucideIcon, Route } from "lucide-react"
import { useRef } from "react"

import { IconBadge } from "@unitravel/ui/brand/art"

import { AppShowcase, WatchTeaserButton } from "@/components/phone-3d"
import { useI18n } from "@/lib/i18n"

const BENEFITS: { icon: LucideIcon; title: "appPage.b1" | "appPage.b2" | "appPage.b3" | "appPage.b4"; body: "appPage.b1Body" | "appPage.b2Body" | "appPage.b3Body" | "appPage.b4Body" }[] = [
  { icon: Route, title: "appPage.b1", body: "appPage.b1Body" },
  { icon: BellRing, title: "appPage.b2", body: "appPage.b2Body" },
  { icon: Headset, title: "appPage.b3", body: "appPage.b3Body" },
  { icon: Languages, title: "appPage.b4", body: "appPage.b4Body" },
]

/** The mobile app is paused (ADR-0026): an introduction only, with no download, TestFlight or web version options. */
export function AppDownload() {
  const { t } = useI18n()
  const video = useRef<HTMLVideoElement>(null)
  const watch = () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    video.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" })
    void video.current?.play()
  }
  const note = t("appPage.teaserNote")
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <section className="relative overflow-hidden rounded-[28px] bg-brand px-5 pt-8 text-white md:px-14 md:pt-0">
        <div aria-hidden className="bg-dots absolute inset-0 opacity-50" />
        <div className="relative grid items-center gap-6 md:grid-cols-[1.05fr_1fr]">
          <div className="text-center md:py-16 md:text-start">
            <p className="text-sm font-semibold text-white/80">{t("appPage.eyebrow")}</p>
            <h1 className="font-display mt-2 text-5xl text-orange md:text-7xl" data-testid="app-coming-soon">{t("appPage.title")}</h1>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-white/85 md:mx-0">{t("appPage.lead")}</p>
            <p className="mt-7"><WatchTeaserButton label={t("appPage.watch")} onClick={watch} /></p>
          </div>
          <AppShowcase large drifters className="pb-8 md:py-10" />
        </div>
      </section>

      <section className="mt-12 md:mt-16" aria-labelledby="app-benefits">
        <h2 id="app-benefits" className="font-display text-center text-3xl md:text-4xl">{t("appPage.benefitsTitle")}</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="card-brand p-6">
              <IconBadge><Icon aria-hidden /></IconBadge>
              <h3 className="mt-4 text-lg font-bold">{t(title)}</h3>
              <p className="mt-2 leading-7 text-steel">{t(body)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="teaser" className="mx-auto mt-12 max-w-5xl scroll-mt-24 md:mt-16" aria-labelledby="app-teaser">
        <h2 id="app-teaser" className="font-display text-center text-3xl md:text-4xl">{t("appPage.teaserTitle")}</h2>
        {note && <p className="mt-2 text-center text-steel">{note}</p>}
        <video
          ref={video}
          controls
          playsInline
          preload="metadata"
          poster="/media/app/coming-soon-poster.jpg"
          aria-label={t("appPage.video")}
          lang="fa"
          className="mt-6 block aspect-video w-full rounded-2xl bg-navy-950 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.5)]"
        >
          <source src="/media/app/coming-soon.mp4" type="video/mp4" />
        </video>
      </section>
    </div>
  )
}
