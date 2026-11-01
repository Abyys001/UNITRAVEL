"use client"

import Link from "next/link"

import { cn } from "@unitravel/ui/lib/utils"

import { Skeleton, Sparkline } from "@/components/bento"
import { useNum } from "@/components/charts"

/**
 * One headline number with an optional trend line. The sparkline is only drawn from real series the caller passes
 * (daily counts from the metrics endpoint, or counts seen in this tab); with fewer than two points it is left out.
 */
export function Kpi({ label, value, href, sub, subTone, spark, sparkLabel, tone, loading, compact }: { label: string; value: number | undefined; href: string | null; sub?: React.ReactNode; subTone?: "danger" | "ok" | "muted"; spark?: number[]; sparkLabel?: string; tone?: "danger"; loading: boolean; compact?: boolean }) {
  const fmt = useNum()
  const inner = (
    <>
      <p className="text-meta font-medium text-steel">{label}</p>
      {loading ? <Skeleton className="mt-3 h-8 w-16" /> : <p className={cn("num leading-none font-semibold tracking-tight", compact ? "mt-1.5 text-title" : "mt-2 text-display", tone === "danger" && value ? "text-danger" : "text-ink")}>{value === undefined ? "—" : fmt(value)}</p>}
      <div className={cn("flex items-end justify-between gap-3", compact ? "mt-2 min-h-5" : "mt-3 min-h-6")}>
        <p className={cn("text-meta", subTone === "danger" ? "font-medium text-danger" : subTone === "ok" ? "text-success" : "text-steel")}>{loading ? "" : sub}</p>
        {spark && spark.length > 1 && <Sparkline values={spark} label={sparkLabel} className="h-6 w-24 shrink-0 text-viz-1" height={24} />}
      </div>
    </>
  )
  const cls = cn("bento-tile block transition-colors", compact ? "min-h-24 p-3.5" : "min-h-32")
  return href ? <Link href={href} className={cn(cls, "hover:border-rule-strong hover:bg-hover/40")}>{inner}</Link> : <div className={cls}>{inner}</div>
}
