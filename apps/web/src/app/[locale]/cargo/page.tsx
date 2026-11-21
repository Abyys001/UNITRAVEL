"use client"

import { ArrowDown, ClipboardList, PackageCheck, Plane, Scale, SearchCheck, ShieldCheck, Truck, Workflow } from "lucide-react"
import Link from "next/link"

import { CargoWizard } from "@/components/cargo-wizard/cargo-wizard"
import { ServiceHero } from "@/components/service-hero"
import { useI18n } from "@/lib/i18n"

const INTRO = [["shipTitle", "ship", PackageCheck], ["howTitle", "how", Workflow], ["needTitle", "need", ClipboardList]] as const

export default function CargoPage() {
  const { t, href } = useI18n()
  return (
    <>
      <ServiceHero testId="cargo-hero" photo="cargo" scene="cargo" eyebrow={t("cargo.eyebrow")} title={t("cargo.title")} accent={t("cargo.accent")} lead={t("cargo.heroLead")}
        perks={[{ icon: Plane, label: t("cargo.perkServices") }, { icon: Scale, label: t("cargo.perkWeight") }, { icon: Truck, label: t("cargo.perkTrack") }]}
        actions={<><a href="#cargo-form" className="btn-orange">{t("services.startRequest")}<ArrowDown className="size-4" aria-hidden /></a><Link href={href("/tracking")} className="btn-glass"><SearchCheck className="size-4" aria-hidden />{t("cargo.trackNumberLink")}</Link></>} />
      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-16 pt-8 md:px-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-8">
        <aside aria-labelledby="cargo-intro" className="grid gap-4 self-start lg:sticky lg:top-24">
          <h2 id="cargo-intro" className="font-display text-lg text-navy-950">{t("guide.cargo.intro.title")}</h2>
          <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {INTRO.map(([title, body, Icon]) => (
              <li key={title} className="card-brand p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-navy-950"><Icon className="size-4 shrink-0 text-orange" aria-hidden />{t(`guide.cargo.intro.${title}`)}</p>
                <p className="mt-1 text-sm text-steel">{t(`guide.cargo.intro.${body}`)}</p>
              </li>
            ))}
          </ul>
          <p className="flex gap-2 rounded-xl bg-cloud px-4 py-3 text-sm text-navy-900"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-navy-900" aria-hidden />{t("guide.cargo.intro.screened")}</p>
          <p className="card-brand !rounded-xl border-s-4 !border-s-danger px-4 py-3 text-sm">{t("cargo.prohibited")}</p>
        </aside>
        <div id="cargo-form" className="card-brand min-w-0 scroll-mt-24 p-4 sm:p-6">
          <CargoWizard />
        </div>
      </div>
    </>
  )
}
