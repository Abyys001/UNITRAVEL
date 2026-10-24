"use client"

/**
 * Bento primitives ("Control deck", docs/design/DESIGN.md). Reuse these for any console overview screen; they only use
 * semantic tokens (surface-raised, ink, steel, rule), so dark mode, density and RTL come for free.
 *
 *   <BentoGrid>                         12 columns >= lg, 6 >= sm, 1 on phones; gap follows the density toggle
 *     <BentoTile title aside size rows tone>
 *        size: "s" (3 cols) | "m" (4) | "l" (6) | "xl" (8) | "full" (12)    rows: 1 | 2    tone: "default" | "hero" | "alert"
 *   <Stat label value delta? spark? tone? hint? />     big mono number; delta = { value:number, label:string } (shown only when non-zero)
 *   <Sparkline values label? tone? />                  inline SVG, no deps; < 2 points draws a dashed baseline, never a made-up trend
 *   <StatusChip tone="ok|warn|danger|info|neutral">    text always present, colour is secondary
 *   <Skeleton className />                             shimmer block (static under prefers-reduced-motion)
 *   <EmptyState icon title hint action />              designed empty state
 *   <TileError onRetry />                              designed error state with a retry button
 *   <ToastHost />                                      theme-aware sonner host; call toast.* from "sonner" as before
 *
 * Tiles never nest links inside links: put the link in `aside` or in the content, not around the tile.
 */
import { AlertTriangle, Inbox } from "lucide-react"
import { Toaster } from "sonner"

import { cn } from "@unitravel/ui/lib/utils"

import { useT } from "@/lib/i18n"
import { useLocale, useResolvedTheme } from "@/lib/prefs"

const SIZE = {
  s: "sm:col-span-3 lg:col-span-3", m: "sm:col-span-3 lg:col-span-4", l: "sm:col-span-6 lg:col-span-6",
  xl: "sm:col-span-6 lg:col-span-8", full: "sm:col-span-6 lg:col-span-12",
} as const
export type BentoSize = keyof typeof SIZE

export function BentoGrid({ children, className, ...rest }: React.ComponentProps<"div">) {
  return <div className={cn("bento-grid", className)} {...rest}>{children}</div>
}

export function BentoTile({ title, aside, size = "m", rows = 1, tone = "default", children, className, ...rest }: Omit<React.ComponentProps<"section">, "title"> & { title?: React.ReactNode; aside?: React.ReactNode; size?: BentoSize; rows?: 1 | 2; tone?: "default" | "hero" | "alert" }) {
  return (
    <section data-tone={tone} className={cn("bento-tile flex flex-col", SIZE[size], rows === 2 && "lg:row-span-2", className)} {...rest}>
      {(title || aside) && (
        <header className="mb-2.5 flex min-h-6 items-center justify-between gap-2">
          {title && <h2 className="cap">{title}</h2>}
          {aside && <div className="ms-auto flex items-center gap-2 text-[12px]">{aside}</div>}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

const TONE_TEXT = { default: "text-ink", ok: "text-success", warn: "text-orange-700", danger: "text-danger", info: "text-royal" } as const
export type Tone = keyof typeof TONE_TEXT

export function Sparkline({ values, label, tone = "default", className, height = 28 }: { values: number[]; label?: string; tone?: Tone; className?: string; height?: number }) {
  const w = 100
  const common = { viewBox: `0 0 ${w} ${height}`, preserveAspectRatio: "none" as const, className: cn("h-7 w-full overflow-visible", TONE_TEXT[tone], className), role: "img" as const, "aria-label": label }
  if (values.length < 2) {
    return <svg {...common} style={{ height }}><line x1="0" x2={w} y1={height - 2} y2={height - 2} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" strokeWidth="1.5" /></svg>
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 3
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, max === min ? height / 2 : height - pad - ((v - min) / span) * (height - pad * 2)] as const)
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const [lx, ly] = pts[pts.length - 1]!
  return (
    <svg {...common} style={{ height }}>
      <polygon points={`0,${height} ${line} ${w},${height}`} fill="currentColor" fillOpacity="0.12" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.2" fill="currentColor" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Stat({ label, value, delta, spark, sparkLabel, tone = "default", hint, className }: {
  label: React.ReactNode; value: React.ReactNode; delta?: { value: number; label: string }; spark?: number[]; sparkLabel?: string; tone?: Tone; hint?: React.ReactNode; className?: string
}) {
  const up = delta && delta.value > 0
  return (
    <div className={cn("flex h-full flex-col justify-between gap-2", className)}>
      <div>
        <p className="cap">{label}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <p className={cn("num text-[28px] leading-none font-semibold", TONE_TEXT[tone])}>{value}</p>
          {delta && delta.value !== 0 && (
            <span className={cn("num rounded-sm px-1 text-[11px]", up ? "bg-warning-subtle text-warning-subtle-fg" : "bg-success-subtle text-success-subtle-fg")} title={delta.label}>
              <span aria-hidden>{up ? "▲" : "▼"}</span> {Math.abs(delta.value)}<span className="sr-only"> {up ? "up" : "down"}, {delta.label}</span>
            </span>
          )}
        </div>
        {hint && <p className="mt-1 text-[11px] text-steel">{hint}</p>}
      </div>
      {spark && <Sparkline values={spark} label={sparkLabel} tone={tone} />}
    </div>
  )
}

const CHIP = {
  ok: "border-success-border bg-success-subtle text-success-subtle-fg", warn: "border-warning-border bg-warning-subtle text-warning-subtle-fg",
  danger: "border-danger/50 bg-danger-subtle text-danger", info: "border-info-border bg-info-subtle text-info-subtle-fg", neutral: "border-rule-strong text-steel",
} as const
export function StatusChip({ tone = "neutral", children, className, icon }: { tone?: keyof typeof CHIP; children: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] leading-4 whitespace-nowrap", CHIP[tone], className)}>{icon ?? <span aria-hidden className="size-1.5 rounded-full bg-current" />}{children}</span>
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton h-4 w-full", className)} />
}

export function EmptyState({ icon, title, hint, action, className }: { icon?: React.ReactNode; title: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 py-5 text-center", className)}>
      <span className="grid size-9 place-items-center rounded-full bg-surface-sunk text-steel" aria-hidden>{icon ?? <Inbox className="size-4" />}</span>
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-xs text-[12px] text-steel">{hint}</p>}
      {action}
    </div>
  )
}

export function TileError({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const t = useT()
  return (
    <div role="alert" className="flex flex-col items-center gap-1.5 py-5 text-center">
      <span className="grid size-9 place-items-center rounded-full bg-danger-subtle text-danger" aria-hidden><AlertTriangle className="size-4" /></span>
      <p className="text-danger">{message ?? t("state.error")}</p>
      {onRetry && <button type="button" onClick={onRetry} className="min-h-8 rounded-sm border border-rule-strong px-3 hover:bg-hover">{t("state.retry")}</button>}
    </div>
  )
}

/** Single toast host for the console: follows the resolved theme and mirrors to the start edge in RTL. */
export function ToastHost() {
  const theme = useResolvedTheme()
  const [locale] = useLocale()
  return <Toaster theme={theme} dir={locale === "fa" ? "rtl" : "ltr"} position={locale === "fa" ? "top-left" : "top-right"} offset={56} style={{ "--normal-bg": "var(--surface-raised)", "--normal-text": "var(--ink)", "--normal-border": "var(--rule-strong)" } as React.CSSProperties} />
}
