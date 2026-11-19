"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

import { CaptureForm } from "@/components/flight-builder/capture-form"
import { Arrow, Loading, PageHead } from "@/components/ui"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

function Body() {
  const t = useT()
  const { can } = useSession()
  const requestRef = useSearchParams().get("request") ?? undefined
  return (
    <div>
      <PageHead kicker={<Link href="/catalog/flight-builder" className="hover:underline"><Arrow back /> {t("fb.title")}</Link>} title={t("fb.new")}><span className="text-meta text-steel">{t("fb.new.desc")}</span></PageHead>
      <div className="mx-auto max-w-5xl px-4 pb-8 md:px-6">
        {can("catalog.capture") ? <CaptureForm requestRef={requestRef} /> : <p role="alert" className="rounded-sm bg-surface-sunk px-2 py-1.5 text-steel" data-testid="denied-state">{t("denied.body")}</p>}
      </div>
    </div>
  )
}

/** Staff capture of one option as read on the Flight Builder panel (ADR-0037). `?request=REF` links the option to that request. */
export default function NewFlightBuilderOptionPage() {
  return <Suspense fallback={<Loading />}><Body /></Suspense>
}
