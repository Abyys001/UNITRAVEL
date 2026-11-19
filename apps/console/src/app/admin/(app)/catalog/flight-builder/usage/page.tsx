"use client"

import Link from "next/link"

import { UsageDashboard } from "@/components/flight-builder/usage"
import { Arrow, PageHead } from "@/components/ui"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/** Search Usage dashboard (ADR-0037): the owner's quota observations; nothing is decremented automatically. */
export default function FlightBuilderUsagePage() {
  const t = useT()
  const { can } = useSession()
  return (
    <div>
      <PageHead kicker={<Link href="/catalog/flight-builder" className="hover:underline"><Arrow back /> {t("fb.title")}</Link>} title={t("fb.usage.title")}><span className="text-meta text-steel">{t("fb.usage.desc")}</span></PageHead>
      <div className="px-4 pb-8 md:px-6"><UsageDashboard canRecord={can("catalog.capture")} /></div>
    </div>
  )
}
