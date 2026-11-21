"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useState } from "react"

import { formatTn, KIND_KEY } from "@/components/cargo-ops"
import { Scanner } from "@/components/scanner"
import { Arrow, PageHead } from "@/components/ui"
import { api, ApiError, errText } from "@/lib/api"
import { useT } from "@/lib/i18n"

type Found = { trackingNumber: string; jobs: { assignmentId: string; kind: "COLLECTION" | "HANDLING" | "DELIVERY"; status: string; ref: string }[] }

/** ADR-0045/0046: scan a label or NFC tag (or type the number) → the agent's own open job for that shipment. */
function ScanPage() {
  const t = useT()
  const router = useRouter()
  const params = useSearchParams()
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null)
  const [choice, setChoice] = useState<Found | null>(null)

  const lookup = useCallback(async (tn: string) => {
    setChoice(null)
    setMsg({ tone: "info", text: t("agt.scan.looking", { tn: formatTn(tn) }) })
    try {
      const r = await api<Found>(`/v1/agent/jobs/by-tracking/${tn}`)
      if (r.jobs.length === 1) { router.push(`/agent/${r.jobs[0]!.assignmentId}`); return }
      setMsg(null); setChoice(r)
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ApiError && e.problem.status === 404 ? t("agt.scan.none", { tn: formatTn(tn) }) : errText(e) })
    }
  }, [router, t])

  useEffect(() => { const tn = params.get("tn")?.toUpperCase(); if (tn && /^UT\d{11}$/.test(tn)) void lookup(tn) }, [params, lookup])

  return (
    <div className="mx-auto max-w-lg px-4 pb-10 md:px-6">
      <div className="pt-5"><Link href="/agent" className="inline-flex items-center gap-1 text-meta font-medium text-link"><Arrow back />{t("agt.title")}</Link></div>
      <PageHead title={t("agt.scan.title")} />
      <Scanner onTn={lookup} />
      {msg && <p role={msg.tone === "error" ? "alert" : "status"} className={msg.tone === "error" ? "mt-3 rounded-sm bg-danger-subtle px-2 py-1.5 text-danger" : "mt-3 text-meta text-steel"}>{msg.text}</p>}
      {choice && (
        <div className="mt-3" data-testid="scan-choice">
          <p className="text-meta text-steel">{t("agt.scan.pick", { tn: formatTn(choice.trackingNumber) })}</p>
          <ul className="mt-2 grid gap-2">
            {choice.jobs.map((j) => <li key={j.assignmentId}><Link href={`/agent/${j.assignmentId}`} className="flex items-center justify-between rounded-lg border border-rule bg-surface-raised px-3 py-3 font-medium hover:border-control"><span>{t(KIND_KEY[j.kind])} <span className="ref text-meta text-steel">{j.ref}</span></span><Arrow /></Link></li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function AgentScan() {
  return <Suspense><ScanPage /></Suspense>
}
