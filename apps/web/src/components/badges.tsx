"use client"

import type { CustomerItinerary, RiskFlag } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"

const tone = {
  live: "border-cyan bg-info-subtle text-info-subtle-fg",
  cached: "border-steel/40 text-steel",
  priced: "border-success bg-success text-white",
  manual: "border-orange-700 text-orange-700",
  fake: "border-danger text-danger bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgb(192_54_44/.1)_4px,rgb(192_54_44/.1)_8px)]",
  risk: "border-danger text-danger",
  gateway: "border-royal text-royal",
  single: "border-navy-950/30 text-navy-950",
}

export function Tag({ children, kind }: { children: React.ReactNode; kind: keyof typeof tone }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone[kind]}`}>{children}</span>
}

/** Truth badges (ch. 18.6): where each price came from and when — text, never colour alone. */
export function TruthBadges({ it, compact = false }: { it: CustomerItinerary; compact?: boolean }) {
  const { t, date } = useI18n()
  const time = (iso: string) => date(iso, { withTime: true, dateOnly: false })
  const rungs = [...new Set(it.truth.map((x) => x.rung))]
  return (
    <div className="flex flex-wrap gap-1.5" aria-label={t("truth.sources")}>
      {it.truth.some((x) => x.fake) && <Tag kind="fake">{t("truth.FAKE")}</Tag>}
      {rungs.map((r) => {
        const item = it.truth.filter((x) => x.rung === r).sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt))[0]!
        const kind = r === "LIVE_OFFER" ? "live" : r === "CACHED_OFFER" ? "cached" : r === "PRICED_OFFER" ? "priced" : "manual"
        return <Tag key={r} kind={kind}>{t(`truth.${r}`, { time: time(item.fetchedAt).split(",").pop()!.trim() })}</Tag>
      })}
      {it.ticketing === "SEPARATE_TICKETS" ? <Tag kind="risk">{t("truth.SEPARATE_TICKETS")}</Tag> : !compact && <Tag kind="single">{t("truth.SINGLE_TICKET")}</Tag>}
      {it.construction === "GATEWAY" && <Tag kind="gateway">{t("truth.GATEWAY")}</Tag>}
    </div>
  )
}

export function RiskFlags({ flags }: { flags: RiskFlag[] }) {
  const { t } = useI18n()
  if (!flags.length) return null
  return <ul className="flex flex-wrap gap-1.5">{flags.map((f) => <li key={f}><Tag kind={f === "TERMINAL_UNKNOWN" || f === "TERMINAL_CHANGE" ? "cached" : "risk"}>{t(`risk.${f}`)}</Tag></li>)}</ul>
}

/** Flight numbers, references and times are LTR isolates inside Persian text (ch. 29.4). */
export function Ltr({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <bdi dir="ltr" className={`ltr ${className}`}>{children}</bdi>
}
