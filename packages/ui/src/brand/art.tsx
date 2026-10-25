import type { ReactNode } from "react"

import { cn } from "../lib/utils"

/**
 * The brand's signature shape: a sweeping orange ribbon under a white wave, closing a dark band
 * (the curve that separates text from photography on the brand artwork). Decorative.
 */
export function Ribbon({ className, fill = "var(--background)" }: { className?: string; fill?: string }) {
  return (
    <svg viewBox="0 0 1440 120" preserveAspectRatio="none" className={cn("pointer-events-none block h-[60px] w-full md:h-[110px]", className)} aria-hidden>
      <defs>
        <linearGradient id="ribbon-o" x1="0" x2="1"><stop offset="0" stopColor="#ffac50" /><stop offset=".55" stopColor="#ff8617" /><stop offset="1" stopColor="#ff8617" stopOpacity=".2" /></linearGradient>
      </defs>
      <path d="M0 78C330 120 760 112 1060 58 1230 28 1350 16 1440 18v14C1340 30 1230 44 1066 72 760 126 330 132 0 92Z" fill="url(#ribbon-o)" />
      <path d="M0 92C330 132 760 126 1066 72 1230 44 1340 30 1440 32V120H0Z" fill={fill} />
    </svg>
  )
}

/** Dashed flight path ending in a map pin, with a small plane travelling along it (offset-path). Decorative. */
export function FlightPath({ className, d = "M20 150C160 40 330 20 470 70S700 150 780 60", pin = [780, 60] as [number, number], plane = true, tone = "onDark" }: { className?: string; d?: string; pin?: [number, number]; plane?: boolean; tone?: "onDark" | "onLight" }) {
  const stroke = tone === "onDark" ? "rgba(255,255,255,.7)" : "rgba(12,103,185,.55)"
  return (
    <svg viewBox="0 0 800 180" className={cn("pointer-events-none overflow-visible", className)} aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="7 9" strokeLinecap="round" className="animate-dash" />
      <g transform={`translate(${pin[0] - 14} ${pin[1] - 38})`}>
        <circle cx="14" cy="38" r="10" fill="#ff8617" opacity=".35" className="animate-pulse-ring" style={{ transformOrigin: "14px 38px" }} />
        <path d="M14 0C6.3 0 0 6.1 0 13.7 0 24 14 38 14 38s14-14 14-24.3C28 6.1 21.7 0 14 0Z" fill="#ff8617" />
        <circle cx="14" cy="13.5" r="5" fill="#fff" />
      </g>
      {plane && (
        <g className="fly-path" style={{ offsetPath: `path("${d}")` }}>
          <path transform="scale(-1 1) translate(-12 -12)" fill="#fff" d="M2 13.2 9.5 12 14 3h2.6l-2.2 9 7.1-.6 2.2-3h1.8l-1 4.8 1 4.8h-1.8l-2.2-3-7.1-.6 2.2 9H14l-4.5-9L2 15.2z" />
        </g>
      )}
    </svg>
  )
}

/** Round outline icon tile used by the trust strip and service rows (brand artwork footer icons). */
export function IconBadge({ children, tone = "onLight", className }: { children: ReactNode; tone?: "onDark" | "onLight"; className?: string }) {
  return (
    <span className={cn("relative grid size-14 shrink-0 place-items-center rounded-full border-2 [&>svg]:size-6", tone === "onDark" ? "border-orange/80 bg-white/5 text-white" : "border-orange bg-white text-navy-900 shadow-[var(--shadow-card)]", className)}>
      {children}
    </span>
  )
}

/** Slowly rotating globe line-art for dark bands. Decorative. */
export function GlobeLines({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 400" className={cn("pointer-events-none", className)} aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <circle cx="200" cy="200" r="190" />
        <g className="animate-orbit" style={{ transformOrigin: "200px 200px" }}>
          {[40, 90, 140, 190].map((rx) => <ellipse key={rx} cx="200" cy="200" rx={rx} ry="190" />)}
        </g>
        {[-120, -60, 0, 60, 120].map((y) => { const r = Math.sqrt(190 * 190 - y * y); return <ellipse key={y} cx="200" cy={200 + y} rx={r} ry={r * 0.08} /> })}
      </g>
    </svg>
  )
}
