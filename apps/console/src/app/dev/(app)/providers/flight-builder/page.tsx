"use client"

import Link from "next/link"

import { DevPage } from "@/components/dev-ui"
import { FlightBuilderDevPanel } from "@/components/flight-builder/dev-panel"
import { Arrow, PageHead } from "@/components/ui"
import { useT } from "@/lib/i18n"

export default function FlightBuilderProviderPage() {
  const t = useT()
  return (
    <div>
      <PageHead kicker={<Link href="/providers" className="hover:underline"><Arrow back /> {t("dnav.providers")}</Link>} title={t("fb.dev.title")}><span className="text-meta text-steel">{t("fb.dev.desc")}</span></PageHead>
      <DevPage><FlightBuilderDevPanel /></DevPage>
    </div>
  )
}
