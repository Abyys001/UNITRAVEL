"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import type { VisaOverview } from "@unitravel/contracts"

import { BentoGrid, BentoTile, EmptyState, Stat, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { ListPage } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { Country } from "@/components/visa"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { useT } from "@/lib/i18n"

/** Visa checker overview (ADR-0033): coverage, what is stale or contested, and whether research can run at all. */
export default function VisaOverviewPage() {
  const t = useT()
  const q = useQuery({ queryKey: ["visa", "overview"], queryFn: () => api<VisaOverview>("/v1/admin/visa/overview"), refetchInterval: 60_000 })
  const o = q.data
  return (
    <ListPage>
      <PageHead kicker={t("nav.visa")} title={t("vz.overview")} />
      <p className="px-4 pb-3 text-meta text-steel md:px-6">{t("vz.overview.note")}</p>
      {q.error ? <div className="px-4 md:px-6"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !o ? <ListSkeleton rows={4} className="px-4 md:px-6" /> : (
        <div className="space-y-4 px-4 pb-6 md:px-6" data-testid="visa-overview">
          <div className={o.researchConfigured ? "rounded-lg border border-success-border bg-success-subtle p-3 text-meta text-success-subtle-fg" : "rounded-lg border border-warning-border bg-warning-subtle p-3 text-meta text-warning-subtle-fg"} role="status" data-testid="visa-research-status">
            <StatusChip tone={o.researchConfigured ? "ok" : "warn"}>{o.researchConfigured ? t("vz.research.on") : t("vz.research.off")}</StatusChip>
            <span className="ms-2">{o.researchConfigured ? t("vz.research.on.hint") : t("vz.research.off.hint")}</span>
          </div>
          <BentoGrid>
            <BentoTile size="s"><Stat label={t("vz.rules")} value={o.rules} /></BentoTile>
            <BentoTile size="s"><Stat label={t("vz.v.VERIFIED")} value={o.byVerification.VERIFIED ?? 0} tone="ok" /></BentoTile>
            <BentoTile size="s"><Stat label={t("vz.v.OVERRIDDEN")} value={o.byVerification.OVERRIDDEN ?? 0} tone="info" /></BentoTile>
            <BentoTile size="s"><Stat label={t("vz.v.UNVERIFIED")} value={o.byVerification.UNVERIFIED ?? 0} /></BentoTile>
            <BentoTile size="s"><Link href="/visa/conflicts" className="block h-full"><Stat label={t("nav.visaConflicts")} value={o.conflicts} tone={o.conflicts ? "danger" : "default"} hint={t("vz.conflicts.hint")} /></Link></BentoTile>
            <BentoTile size="s"><Link href="/visa/rules?stale=true" className="block h-full"><Stat label={t("vz.stale")} value={o.stale} tone={o.stale ? "warn" : "default"} hint={t("vz.stale.hint")} /></Link></BentoTile>
            <BentoTile size="s"><Link href="/visa/runs?status=FAILED" className="block h-full"><Stat label={t("vz.failed24h")} value={o.failedRuns24h} tone={o.failedRuns24h ? "danger" : "default"} hint={t("vz.runs24h", { n: o.runs24h })} /></Link></BentoTile>
          </BentoGrid>
          <BentoTile title={t("vz.staleDest")}>
            {o.staleDestinations.length === 0 ? <EmptyState title={t("vz.staleDest.none")} /> : (
              <ul className="divide-y divide-rule" data-testid="visa-stale-destinations">
                {o.staleDestinations.map((d) => (
                  <li key={d.destination} className="flex flex-wrap items-center justify-between gap-2 py-2 text-meta">
                    <Link className="font-medium underline-offset-2 hover:underline" href={`/visa/rules?destination=${d.destination}&stale=true`}><Country code={d.destination} /></Link>
                    <span className="text-steel">{t("vz.staleDest.row", { n: d.rules, d: d.oldestVerifiedAt ? fmtDate(d.oldestVerifiedAt) : t("vz.never") })}</span>
                  </li>
                ))}
              </ul>
            )}
          </BentoTile>
        </div>
      )}
    </ListPage>
  )
}
