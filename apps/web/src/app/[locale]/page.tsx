"use client"

import { ArrowRight, Package } from "lucide-react"
import Link from "next/link"

import { RouteArt } from "@/components/route-art"
import { SearchForm } from "@/components/search-form"
import { useI18n } from "@/lib/i18n"

export default function Home() {
  const { t, href } = useI18n()
  const steps = [["home.step1", "home.step1Body"], ["home.step2", "home.step2Body"], ["home.step3", "home.step3Body"], ["home.step4", "home.step4Body"]] as const
  return (
    <>
      <section className="relative overflow-hidden bg-ink text-paper">
        <div className="absolute inset-0 opacity-90"><RouteArt /></div>
        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 pb-14 pt-12 md:grid-cols-[1.05fr_1fr] md:pt-20">
          <div className="self-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-copper">{t("home.eyebrow")}</p>
            <h1 className="font-display mt-4 text-4xl leading-[1.05] md:text-6xl">{t("home.title")}</h1>
            <p className="mt-5 max-w-xl text-lg text-[#d8e2ee]">{t("home.lead")}</p>
            <p className="mt-6 max-w-xl border-s-2 border-copper ps-4 text-sm text-[#b9c8da]">{t("home.honest")}</p>
          </div>
          <div className="text-ink"><SearchForm /></div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="font-display text-3xl">{t("home.stepsTitle")}</h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-4">
          {steps.map(([h, b], i) => (
            <li key={h} className="border-t border-ink/15 pt-4">
              <span className="font-mono text-xs text-copper-700">0{i + 1}</span>
              <h3 className="mt-2 text-lg font-semibold">{t(h)}</h3>
              <p className="mt-1 text-sm text-slate">{t(b)}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="mx-auto max-w-6xl px-4">
        <div className="flex flex-col items-start justify-between gap-4 rounded-lg border border-border bg-sand p-6 md:flex-row md:items-center">
          <div className="flex gap-4"><Package className="mt-1 size-6 shrink-0 text-copper-700" /><div><h2 className="font-display text-2xl">{t("home.cargoTitle")}</h2><p className="mt-1 max-w-xl text-slate">{t("home.cargoBody")}</p></div></div>
          <Link href={href("/cargo")} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-primary-foreground hover:bg-deep">{t("home.cargoCta")}<ArrowRight className="size-4 rtl:rotate-180" /></Link>
        </div>
      </section>
    </>
  )
}
