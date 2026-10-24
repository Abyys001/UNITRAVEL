import { useId } from "react"

import { cn } from "../lib/utils"

/** Vector redraw of the Uni Travel globe-and-swoosh mark (source: unitravels.co.uk share image). Static copy: assets/brand/logo/mark.svg. */
export function LogoMark({ size = 40, className, title }: { size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "")
  return (
    <svg width={size} height={size} viewBox="-4 -4 128 128" className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <radialGradient id={`${id}g`} cx="38%" cy="32%" r="75%"><stop offset="0" stopColor="#8fd4ff" /><stop offset=".45" stopColor="#2a9bf5" /><stop offset="1" stopColor="#0a4596" /></radialGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0c67b9" /><stop offset="1" stopColor="#061f4c" /></linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#e4f4ff" /></linearGradient>
        <linearGradient id={`${id}o`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#ff8617" /><stop offset="1" stopColor="#ffac50" /></linearGradient>
        <clipPath id={`${id}c`}><circle cx="60" cy="60" r="45" /></clipPath>
      </defs>
      <circle cx="60" cy="60" r="58" fill={`url(#${id}r)`} />
      <circle cx="60" cy="60" r="54.5" fill="none" stroke="#a9dcfb" strokeWidth="2.2" opacity=".9" />
      <circle cx="60" cy="60" r="45" fill={`url(#${id}g)`} />
      <g clipPath={`url(#${id}c)`}>
        <g fill="none" stroke="#ffffff" strokeOpacity=".28" strokeWidth="1.1">
          <ellipse cx="60" cy="60" rx="20" ry="45" /><ellipse cx="60" cy="60" rx="36" ry="45" />
          <path d="M15 60h90M20 38h80M20 82h80" />
        </g>
        <path fill="#d7efff" fillOpacity=".85" d="M33 30c6-5 15-6 21-3 3 2 1 6-2 7-4 1-5 4-3 7 2 4 7 3 9 7 2 5-2 9-6 12-3 3-3 8-6 10-3-4-2-9-5-12-4-3-9-4-11-9-2-6 0-14 3-19z" />
        <path fill="#d7efff" fillOpacity=".7" d="M66 22c7-1 15 2 20 7-4 0-7 2-6 5 1 4 6 4 7 8-4 2-9-1-12 2-2 2 0 6-3 7-3-3-6-6-6-11 0-6 6-8 0-12z" />
        <path fill="#d7efff" fillOpacity=".55" d="M74 62c5-1 9 2 10 6 1 5-2 10-6 13-3-3-6-7-6-12 0-3 0-5 2-7z" />
      </g>
      <circle cx="60" cy="60" r="45" fill="none" stroke="#061f4c" strokeOpacity=".25" strokeWidth="1" />
      <path fill={`url(#${id}o)`} d="M6 88c28 22 80 10 104-40-14 36-62 54-104 40z" />
      <path fill={`url(#${id}s)`} d="M-2 74c30 30 88 14 112-42-6 2-10 4-13 6-20 40-60 52-99 36z" />
      <g transform="translate(83 11) rotate(-38 13 13)">
        <path fill="#ffffff" stroke="#0c67b9" strokeWidth="1.1" strokeLinejoin="round" d="M2 13.2 9.5 12 14 3h2.6l-2.2 9 7.1-.6 2.2-3h1.8l-1 4.8 1 4.8h-1.8l-2.2-3-7.1-.6 2.2 9H14l-4.5-9L2 15.2z" />
      </g>
    </svg>
  )
}

/**
 * Mark + wordmark. "UNI TRAVEL" in Montserrat 800 with "یونی تراول" beneath, as on the brand artwork.
 * `tone` follows the surface: onDark = white/sky wordmark, onLight = navy/royal.
 */
export function Logo({ variant = "horizontal", tone = "onLight", size = 40, className }: { variant?: "mark" | "horizontal" | "stacked"; tone?: "onDark" | "onLight"; size?: number; className?: string }) {
  if (variant === "mark") return <LogoMark size={size} className={className} title="Uni Travel" />
  const dark = tone === "onDark"
  const word = (
    <span className={cn("flex flex-col leading-none", variant === "stacked" && "items-center")} dir="ltr">
      <span className="font-[family-name:var(--font-montserrat)] font-extrabold tracking-[0.02em]" style={{ fontSize: size * 0.5 }}>
        <span className={dark ? "text-white" : "text-navy-950"}>UNI</span> <span className={dark ? "text-[#8fd4ff]" : "text-royal"}>TRAVEL</span>
      </span>
      <span lang="fa" dir="rtl" className={cn("mt-1 flex items-center gap-1.5 font-[family-name:var(--font-vazirmatn)] font-bold", dark ? "text-orange-300" : "text-orange-700")} style={{ fontSize: size * 0.3 }}>
        <span aria-hidden className={cn("h-px flex-1", dark ? "bg-white/30" : "bg-navy-950/20")} />یونی تراول<span aria-hidden className={cn("h-px flex-1", dark ? "bg-white/30" : "bg-navy-950/20")} />
      </span>
    </span>
  )
  return (
    <span className={cn("inline-flex items-center", variant === "stacked" ? "flex-col gap-3" : "gap-2.5", className)} aria-label="Uni Travel" role="img">
      <LogoMark size={variant === "stacked" ? size * 2 : size} />
      {word}
    </span>
  )
}
