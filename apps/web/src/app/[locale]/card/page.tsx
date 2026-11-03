"use client"

import { CreditCard, LifeBuoy } from "lucide-react"
import Link from "next/link"

import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { HeroBand, ServiceHero } from "@/components/service-hero"
import { Unavailable } from "@/components/service-form"
import { useI18n } from "@/lib/i18n"
import { useSite } from "@/lib/site"

/**
 * Travel card (brief §18): no card product exists, so this is a publication switch for a Coming Soon page only. It never
 * mentions fees, rates, limits or eligibility, and nothing here issues, loads or charges a card.
 */
export default function CardPage() {
  const { t, href } = useI18n()
  const { loaded, on } = useSite()
  if (!loaded) return <><HeroBand /><div className="mx-auto max-w-3xl px-4 py-8"><LoadingState label={t("nav.card")} /></div></>
  if (!on("card")) return <Unavailable title={t("card.title")} band />
  return (
    <>
      <ServiceHero testId="card-hero" compact eyebrow={t("card.soonTitle")} title={t("card.title")} accent={t("card.accent")} lead={t("card.lead")} scene="flight" />
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-8 md:px-6">
        <div className="relative mx-auto mb-8 aspect-[1.586] w-full max-w-sm overflow-hidden rounded-[22px] bg-brand p-6 text-white shadow-[var(--shadow-lift)] ring-1 ring-white/20" aria-hidden>
          <div className="bg-dots absolute inset-0 opacity-30" />
          <div className="absolute -end-10 -top-10 size-40 rounded-full bg-orange/30 blur-2xl" />
          <CreditCard className="relative size-8 text-orange" />
          <p className="font-display relative mt-10 text-2xl">{t("card.title")}</p>
          <p className="relative mt-2 inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold">{t("card.soonTitle")}</p>
        </div>
        <div data-testid="card-soon">
          <EmptyState icon={<CreditCard />} title={t("card.soonTitle")} body={t("card.soonBody")} action={<Link href={href("/support")} className="btn-orange mt-2 inline-flex"><LifeBuoy aria-hidden className="size-4" />{t("nav.support")}</Link>} />
        </div>
        <p className="mt-4 text-center text-sm text-steel">{t("card.help")}</p>
      </div>
    </>
  )
}
