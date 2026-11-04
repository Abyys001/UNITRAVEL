"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"

import { TileError, Skeleton } from "@/components/bento"
import { CoverageSection } from "@/components/catalog/coverage"
import { useCatalogSettings, SettingsSection } from "@/components/catalog/settings"
import { CATALOG, KEYS } from "@/components/catalog/shared"
import { CatalogUsageBody, useCatalogUsage } from "@/components/catalog/usage"
import { WatchlistSection } from "@/components/catalog/watchlist"
import { Section } from "@/components/dev-ui"
import { PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/** Flight catalog (ADR-0034): pacer spend, coverage per route and date, watchlist and settings. Customers never reach a provider; only this page and the pacer spend the Apify budget. */
export default function CatalogPage() {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const canManage = can("catalog.manage")
  const usage = useCatalogUsage()
  const settings = useCatalogSettings()
  const [prefill, setPrefill] = useState<{ origin: string; destination: string; n: number } | null>(null)
  const u = usage.data
  const toggle = useMutation({
    mutationFn: (pause: boolean) => api(`${CATALOG}/${pause ? "pause" : "resume"}`, { body: {} }),
    onSuccess: (_r, pause) => { toast.success(t(pause ? "cat.pausedNow" : "cat.resumedNow")); return qc.invalidateQueries({ queryKey: KEYS.all }) },
    onError: (e) => toast.error(errText(e)),
  })
  return (
    <div>
      <PageHead kicker={t("nav.tools")} title={t("cat.title")}><span className="text-meta text-steel">{t("cat.desc")}</span></PageHead>
      <div className="space-y-4 px-4 pb-8 md:px-6" data-testid="catalog-page">
        <Section title={t("cat.usage.title")} className={u?.overBudget ? "border-danger/50" : undefined}
          aside={canManage && u && (u.paused
            ? <Button size="xs" variant="outline" loading={toggle.isPending} onClick={() => toggle.mutate(false)} data-testid="catalog-resume">{t("cat.resume")}</Button>
            : <Button size="xs" variant="outline" loading={toggle.isPending} onClick={() => toggle.mutate(true)} data-testid="catalog-pause">{t("cat.pause")}</Button>)}>
          {usage.isError ? <TileError error={usage.error} onRetry={() => void usage.refetch()} /> : !u ? <Skeleton className="h-20" /> : <CatalogUsageBody u={u} />}
        </Section>
        <CoverageSection settings={settings.data?.settings} canManage={canManage} onAdd={(origin, destination) => { setPrefill({ origin, destination, n: Date.now() }); document.getElementById("catalog-watchlist")?.scrollIntoView({ behavior: "smooth", block: "center" }) }} />
        <WatchlistSection settings={settings.data?.settings} canManage={canManage} prefill={prefill} />
        <SettingsSection canManage={canManage} />
      </div>
    </div>
  )
}
