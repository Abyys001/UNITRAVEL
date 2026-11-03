"use client"

import type { ProviderRunView, ProviderUsageView, ProviderView } from "@unitravel/contracts"
import { useQuery } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"
import Link from "next/link"

import { BentoTile, Skeleton, Stat, StatusChip, TileError } from "@/components/bento"
import { Section } from "@/components/dev-ui"
import { APIFY } from "@/components/flight/apify-source"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"

const RUNS_PAGE = 100
const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`)
const BANNER_TONE = { NONE: "ok", CUSTOMER_POOL_EMPTY: "warn", CREDENTIAL_INVALID: "danger", CREDENTIAL_MISSING: "danger" } as const

export const DEV_APIFY_USAGE = `/v1/dev/providers/${APIFY}/usage`
export const ADMIN_APIFY_USAGE = `/v1/admin/providers/${APIFY}/usage`

/**
 * Apify spend per budget pool, runs this month, last connection test and banner state (ADR-0032 B7). Mount for `provider.config.read` only.
 * The run count, connection test and provider link read `/v1/dev/*`, which the admin host refuses, so they only show with `devDetails`.
 */
export function ApifyUsageTile({ endpoint = DEV_APIFY_USAGE, devDetails = true }: { endpoint?: string; devDetails?: boolean }) {
  const t = useT()
  const usage = useQuery({ queryKey: ["apify-usage", endpoint], queryFn: () => api<ProviderUsageView>(endpoint), refetchInterval: 60_000 })
  const runs = useQuery({ queryKey: ["apify-runs", RUNS_PAGE], queryFn: () => api<ProviderRunView[]>(`/v1/dev/providers/${APIFY}/runs?limit=${RUNS_PAGE}`), refetchInterval: 60_000, enabled: devDetails })
  const prov = useQuery({ queryKey: ["provider", APIFY], queryFn: () => api<ProviderView>(`/v1/dev/providers/${APIFY}`), enabled: devDetails })
  const u = usage.data
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
  const thisMonth = runs.data?.filter((r) => Date.parse(r.createdAt) >= monthStart.getTime()).length
  // The run list is capped; a full page of this month's runs means there are at least that many.
  const runsLabel = thisMonth == null ? "—" : thisMonth === RUNS_PAGE ? `${RUNS_PAGE}+` : String(thisMonth)
  return (
    <BentoTile size="full" title={t("apify.usage.title")} tone={u && u.banner !== "NONE" ? "alert" : "default"} data-testid="apify-usage"
      aside={devDetails ? <Link href={`/providers/${APIFY}`} className="inline-flex min-h-6 items-center font-medium text-link hover:underline pointer-coarse:min-h-11">{t("apify.usage.open")}</Link> : undefined}>
      {usage.isError ? <TileError error={usage.error} onRetry={() => void usage.refetch()} /> : !u ? <Skeleton className="h-20" /> : (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2"><StatusChip tone={BANNER_TONE[u.banner]} className="whitespace-normal">{t(`apify.banner.${u.banner}`)}</StatusChip>{u.apify && <span className="text-meta text-steel">{t("apify.usage.apify", { used: usd(u.apify.monthlyUsageUsd), limit: usd(u.apify.maxMonthlyUsageUsd) })}</span>}</p>
          <div className={devDetails ? "grid gap-4 sm:grid-cols-3 lg:grid-cols-5" : "grid gap-4 sm:grid-cols-3"}>
            {(["customer", "prewarm", "staff"] as const).map((k) => {
              const p = u.ledger.pools[k]
              return <Stat key={k} label={t(`apify.pool.${k}`)} value={usd(p.spentUsd)} tone={p.remainingUsd <= 0 ? "danger" : "default"} hint={t("apify.usage.of", { budget: usd(p.budgetUsd), left: usd(p.remainingUsd) })} />
            })}
            {devDetails && <Stat label={t("apify.usage.runs")} value={runs.isError ? "—" : runsLabel} hint={t("apify.usage.hour", { n: u.ledger.customerRunsThisHour, max: u.ledger.customerRunsPerHour })} />}
            {devDetails && <Stat label={t("apify.usage.tested")} value={<span className="text-lead">{fmtDateTime(prov.data?.credentials.testedAt)}</span>} hint={u.month} />}
          </div>
        </div>
      )}
    </BentoTile>
  )
}

const HELP: { key: MsgKey; link?: { href: string; label: MsgKey } }[] = [
  { key: "apify.help.1", link: { href: "https://console.apify.com/settings/integrations", label: "apify.help.tokens" } },
  { key: "apify.help.2" },
  { key: "apify.help.3", link: { href: "https://console.apify.com/settings/integrations", label: "apify.help.tokens" } },
  { key: "apify.help.4", link: { href: "https://console.apify.com/billing/limits", label: "apify.help.limits" } },
]
/** Read-only for every `provider.config.read` holder (ADR-0032 B2); it never shows or asks for more than the token. */
export function ApifyHelp() {
  const t = useT()
  return (
    <Section title={t("apify.help.title")} data-testid="apify-help">
      <ol className="list-decimal space-y-2 ps-5 text-meta">
        {HELP.map((h) => (
          <li key={h.key}>{t(h.key)}{h.link && <> <a href={h.link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-link hover:underline">{t(h.link.label)}<ExternalLink aria-hidden className="size-3.5" /></a></>}</li>
        ))}
      </ol>
    </Section>
  )
}
