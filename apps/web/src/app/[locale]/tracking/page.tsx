"use client"

import { Barcode, Lock, Truck } from "lucide-react"
import Link from "next/link"

import { CargoTrackingForm } from "@/components/cargo-tracking-form"
import { ServiceHero } from "@/components/service-hero"
import { useI18n } from "@/lib/i18n"

/** Public cargo tracking entry (ADR-0042): no sign-in; the number leads to /tracking/<number>. */
export default function CargoTrackingPage() {
  const { t, href } = useI18n()
  return (
    <>
      <ServiceHero testId="cargo-tracking-hero" compact photo="cargo" eyebrow={t("cargoTracking.eyebrow")} title={t("cargoTracking.title")} accent={t("cargoTracking.accent")} lead={t("cargoTracking.lead")}>
        <CargoTrackingForm className="mt-6 max-w-2xl" />
      </ServiceHero>
      <div className="mx-auto grid max-w-5xl gap-5 px-4 pb-16 pt-8 md:grid-cols-2 md:px-6">
        <section className="card-brand flex gap-4 p-5" aria-labelledby="where-h">
          <Barcode aria-hidden className="mt-0.5 size-6 shrink-0 text-royal" />
          <div><h2 id="where-h" className="font-semibold">{t("cargoTracking.whereTitle")}</h2><p className="mt-1 text-sm leading-6 text-steel">{t("cargoTracking.where")}</p></div>
        </section>
        <section className="card-brand flex gap-4 p-5">
          <Lock aria-hidden className="mt-0.5 size-6 shrink-0 text-royal" />
          <p className="text-sm leading-6 text-steel">{t("cargoTracking.privacy")}</p>
        </section>
        <p className="md:col-span-2"><Link href={href("/shipments")} className="inline-flex items-center gap-2 text-sm font-semibold text-royal underline underline-offset-4 pointer-coarse:min-h-11"><Truck className="size-4" aria-hidden />{t("cargoTracking.mine")}</Link></p>
      </div>
    </>
  )
}
