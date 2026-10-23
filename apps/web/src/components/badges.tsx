"use client"

import type { Itinerary, RiskFlag } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"

const tone = {
  live: "border-moss/50 text-moss",
  cached: "border-slate/40 text-slate",
  priced: "border-moss bg-moss text-white",
  manual: "border-copper text-copper-700",
  fake: "border-brick text-brick bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(164,69,44,.08)_4px,rgba(164,69,44,.08)_8px)]",
  risk: "border-brick/60 text-brick",
  gateway: "border-copper/70 text-copper-700",
  single: "border-ink/30 text-ink",
}

export function Tag({ children, kind }: { children: React.ReactNode; kind: keyof typeof tone }) {
  return <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone[kind]}`}>{children}</span>
}

/** Truth badges (ch. 18.6): where each price came from and when — text, never colour alone. */
export function TruthBadges({ it, compact = false }: { it: Itinerary; compact?: boolean }) {
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
