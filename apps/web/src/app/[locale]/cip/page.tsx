"use client"

import { ArrowDown, BadgeCheck, Handshake, LifeBuoy, PlaneLanding } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { CipFaq, CipGoodToKnow, CipHowItWorks, CipServices } from "@/components/cip/cip-content"
import { CIP_DRAFT_KEY, CipWizard } from "@/components/cip/cip-wizard"
import { ServiceHero } from "@/components/service-hero"
import { useI18n } from "@/lib/i18n"
import { useSite } from "@/lib/site"

/**
 * CIP at Tehran Imam Khomeini only (owner). The explanation is always shown; requests open only while
 * services.cip.enabled is on (O9, counsel), and the CIP:IKA REVIEW policy holds them server-side (ADR-0020, ADR-0041 D6).
 */
export default function CipPage() {
  const { t, href } = useI18n()
  const { site, loaded } = useSite()
  const enabled = loaded && site.menu.cip === true
  const [open, setOpen] = useState(false)
  const requestRef = useRef<HTMLElement>(null)
  const start = () => {
    setOpen(true)
    requestAnimationFrame(() => requestRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  // A draft (reload, or back from sign-in) reopens the request where the visitor left it.
  useEffect(() => {
    try { if (sessionStorage.getItem(`ut_draft:${CIP_DRAFT_KEY}`)) setOpen(true) } catch { /* storage unavailable */ }
  }, [])

  const cta = enabled
    ? <button type="button" className="btn-orange" onClick={start} data-testid="cip-request-start">{t("guide.cip.hero.cta")}<ArrowDown className="size-4" aria-hidden /></button>
    : <a href="#cip-services" className="btn-orange">{t("guide.cip.servicesTitle")}<ArrowDown className="size-4" aria-hidden /></a>

  return (
    <>
      <ServiceHero testId="service-hero" eyebrow={t("guide.cip.hero.eyebrow")} title={t("guide.cip.hero.title")} accent={t("guide.cip.hero.accent")} lead={t("guide.cip.hero.lead")}
        scene="cip" photo="tehran" actions={loaded ? cta : undefined}
        perks={[{ icon: PlaneLanding, label: t("guide.cip.hero.perk1") }, { icon: Handshake, label: t("guide.cip.hero.perk2") }, { icon: BadgeCheck, label: t("guide.cip.hero.perk3") }]} />

      <div className="mx-auto max-w-6xl space-y-14 px-4 pb-16 pt-10 md:px-6">
        {!loaded && <LoadingState label={t("common.loading")} rows={2} />}
        {loaded && !enabled && (
          <div data-testid="service-unavailable">
            <EmptyState icon={<LifeBuoy />} title={t("services.unavailableTitle")} body={t("guide.cip.unavailableNote")}
              action={<Link href={href("/support")} className="btn-orange mt-2 inline-flex">{t("nav.support")}</Link>} />
          </div>
        )}
        {enabled && open && (
          <section ref={requestRef} aria-labelledby="cip-request-title" className="scroll-mt-24" data-testid="cip-request">
            <h2 id="cip-request-title" className="font-display text-2xl md:text-3xl">{t("guide.cip.wizard.title")}</h2>
            <div className="mt-5 max-w-3xl rounded-3xl border border-line bg-white p-4 shadow-[var(--shadow-card)] motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:starting:translate-y-2 motion-safe:starting:opacity-0 sm:p-6">
              <CipWizard />
            </div>
          </section>
        )}
        <CipServices />
        <CipGoodToKnow />
        <CipHowItWorks />
        <CipFaq />
        {enabled && !open && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-line bg-cloud p-5 md:p-7">
            <p className="max-w-xl text-sm leading-6 text-navy-900">{t("guide.cip.good.operator")}</p>
            <button type="button" className="btn-orange" onClick={start}>{t("guide.cip.hero.cta")}</button>
          </div>
        )}
      </div>
    </>
  )
}
