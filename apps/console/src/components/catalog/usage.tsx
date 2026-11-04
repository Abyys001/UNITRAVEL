"use client"

import type { CatalogUsage } from "@unitravel/contracts"
import { useQuery } from "@tanstack/react-query"

import { Stat, StatusChip } from "@/components/bento"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"

import { CATALOG, KEYS, usd } from "./shared"

export const useCatalogUsage = (enabled = true) =>
  useQuery({ queryKey: KEYS.usage, queryFn: () => api<CatalogUsage>(`${CATALOG}/usage`), refetchInterval: 60_000, enabled })

/** Banners (paused, schema alert) and the spend figures of the pacer (ADR-0034 C2). Prices here are staff-only and indicative. */
export function CatalogUsageBody({ u }: { u: CatalogUsage }) {
  const t = useT()
  return (
    <div className="space-y-3" data-testid="catalog-usage">
      <div className="flex flex-wrap items-center gap-2">
        {u.paused
          ? <span data-testid="catalog-paused"><StatusChip tone="warn" className="whitespace-normal">{t("cat.paused")}{u.pauseReason ? `: ${u.pauseReason}` : ""}</StatusChip></span>
          : <StatusChip tone="ok">{t("cat.running")}</StatusChip>}
        {u.overBudget && <span data-testid="catalog-over"><StatusChip tone="danger" className="whitespace-normal">{t("cat.overBudget")}</StatusChip></span>}
        <span className="text-caption text-steel">{t("cat.indicative")}</span>
      </div>
      {u.schemaAlert && <p role="alert" className="rounded-md bg-danger-subtle px-2.5 py-1.5 text-meta text-danger" data-testid="catalog-schema-alert">{t("cat.schemaAlert", { why: u.schemaAlert })}</p>}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={t("cat.u.spent")} value={usd(u.spentUsd)} tone={u.overBudget ? "danger" : "default"} hint={t("cat.u.spentHint", { budget: usd(u.budgetUsd), src: t(u.spentSource === "apify" ? "cat.u.srcApify" : "cat.u.srcLedger") })} />
        <Stat label={t("cat.u.projected")} value={usd(u.projectedUsd)} tone={u.overBudget ? "danger" : "default"} hint={t("cat.u.cycleEnd", { d: u.cycleEnd ? fmtDate(u.cycleEnd) : "—" })} />
        <Stat label={t("cat.u.available")} value={usd(u.availableUsd)} hint={t("cat.u.availableHint")} />
        <Stat label={t("cat.u.reserve")} value={usd(u.reserveLeftUsd)} hint={u.reserveReleased ? t("cat.u.released") : t("cat.u.held")} />
        <Stat label={t("cat.u.rows")} value={<span className="num">{Math.round(u.rowsPerDay)}</span>} hint={t("cat.u.runs", { n: u.runsPerDay.toFixed(1) })} />
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-meta sm:grid-cols-2">
        <div className="flex justify-between gap-3"><dt className="text-steel">{t("cat.u.correction")}</dt><dd className="num">×{u.costCorrection.toFixed(2)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-steel">{t("cat.u.cap")}</dt><dd className="num">{usd(u.accountCapUsd)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-steel">{t("cat.u.lastTick")}</dt><dd className="min-w-0 text-end">{u.lastTick ? <>{u.lastTick.outcome} · <span className="num">{fmtDateTime(u.lastTick.at)}</span> · {t("cat.u.tickSlots", { n: u.lastTick.slots, usd: usd(u.lastTick.tickBudgetUsd) })}</> : "—"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-steel">{t("cat.u.nextTick")}</dt><dd className="num">{fmtDateTime(u.nextTickAt)}</dd></div>
      </dl>
    </div>
  )
}
