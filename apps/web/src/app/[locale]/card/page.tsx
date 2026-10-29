"use client"

import { CreditCard, LifeBuoy } from "lucide-react"
import Link from "next/link"

import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

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
  if (!loaded) return <div className="mx-auto max-w-3xl px-4 py-8"><LoadingState label={t("nav.card")} /></div>
  if (!on("card")) return <Unavailable title={t("card.title")} />
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{t("card.title")}</h1>
      <span aria-hidden className="mt-4 block h-1 w-16 rounded-full bg-orange" />
      <p className="mt-4 leading-8 text-steel">{t("card.lead")}</p>
      <div className="mt-6" data-testid="card-soon">
        <EmptyState icon={<CreditCard />} title={t("card.soonTitle")} body={t("card.soonBody")} action={<Link href={href("/support")} className="btn-orange mt-2 inline-flex"><LifeBuoy aria-hidden className="size-4" />{t("nav.support")}</Link>} />
      </div>
      <p className="mt-4 text-sm text-steel">{t("card.help")}</p>
    </div>
  )
}
