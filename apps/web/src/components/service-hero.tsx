"use client"

import type { LucideIcon } from "lucide-react"

import { Ribbon } from "@unitravel/ui/brand/art"
import { ServiceScene, type SceneKind } from "@unitravel/ui/brand/scenes"

/** Pre-encoded AVIF/WebP pairs under `/media/photos/`; they show a place, never a product or a property. */
export type HeroPhoto = "cargo" | "travel" | "london" | "tehran" | "istanbul" | "iran/isfahan"

const SHADE = "bg-[linear-gradient(100deg,rgb(6_31_76/0.96)_0%,rgb(8_47_107/0.86)_55%,rgb(12_103_185/0.45)_100%)] rtl:bg-[linear-gradient(260deg,rgb(6_31_76/0.96)_0%,rgb(8_47_107/0.86)_55%,rgb(12_103_185/0.45)_100%)]"

/** Wraps the first occurrence of `accent` in the orange gradient; a translation without it renders plain. */
export function Accented({ text, accent }: { text: string; accent?: string }) {
  const at = accent ? text.indexOf(accent) : -1
  if (!accent || at < 0) return <>{text}</>
  return <>{text.slice(0, at)}<span className="text-gradient-orange">{accent}</span>{text.slice(at + accent.length)}</>
}

/**
 * Night-sky header shared by every service page (DESIGN.md "Night flight"): eyebrow, display title with an orange
 * accent, lead, the service scene, glass perks and the ribbon. `children` sits under the copy (trains: the route card).
 */
export function ServiceHero({ testId, eyebrow, title, accent, lead, scene, photo, perks = [], actions, compact, children }: {
  testId: string; eyebrow: string; title: string; accent?: string; lead?: string; scene?: SceneKind; photo?: HeroPhoto
  perks?: { icon: LucideIcon; label: string }[]; actions?: React.ReactNode; compact?: boolean; children?: React.ReactNode
}) {
  return (
    <section className={`relative isolate overflow-hidden text-white ${photo ? "bg-navy-950" : "bg-brand"}`} data-testid={testId}>
      {photo ? (
        <>
          <picture>
            <source srcSet={`/media/photos/${photo}.avif`} type="image/avif" />
            {/* eslint-disable-next-line @next/next/no-img-element -- pre-encoded AVIF/WebP set */}
            <img src={`/media/photos/${photo}.webp`} alt="" className="absolute inset-0 -z-10 size-full object-cover" />
          </picture>
          <div aria-hidden className={`absolute inset-0 -z-10 ${SHADE}`} />
        </>
      ) : <div aria-hidden className="bg-dots absolute inset-0 -z-10 opacity-40" />}
      <div aria-hidden className="pointer-events-none absolute -end-24 -top-24 -z-10 size-96 rounded-full bg-cyan/20 blur-3xl" />
      <div className={`mx-auto max-w-6xl px-4 md:px-6 ${compact ? "pb-6 pt-8 md:pb-8 md:pt-12" : "pb-8 pt-10 md:pb-12 md:pt-16"}`}>
        <div className={`grid items-center gap-8 ${scene ? "lg:grid-cols-[1.3fr_1fr]" : ""}`}>
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-semibold tracking-[0.12em] text-white/90 backdrop-blur">
              <span className="size-1.5 rounded-full bg-orange" />{eyebrow}
            </p>
            <h1 className={`font-display mt-5 max-w-3xl text-balance leading-[1.1] ${compact ? "text-[2rem] md:text-5xl" : "text-[2.2rem] md:text-[3.4rem]"}`}><Accented text={title} accent={accent} /></h1>
            {lead && <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/85 md:text-lg">{lead}</p>}
            {actions && <div className="mt-6 flex flex-wrap gap-3">{actions}</div>}
          </div>
          {scene && <ServiceScene kind={scene} className="hidden aspect-[5/3] overflow-hidden rounded-[28px] bg-white/90 shadow-[var(--shadow-lift)] ring-1 ring-white/40 lg:block" />}
        </div>
        {children}
        {perks.length > 0 && (
          <ul className={`grid gap-3 ${perks.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"} ${compact ? "mt-6" : "mt-8"}`}>
            {perks.map(({ icon: Icon, label }) => (
              <li key={label} className="glass flex items-center gap-3 rounded-2xl p-3.5 text-sm font-semibold">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-orange/80"><Icon className="size-4 text-cyan" aria-hidden /></span>{label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Ribbon className="relative" />
    </section>
  )
}

/** Brand band for a hero page's loading and closed states, matching the shell band they replace. */
export function HeroBand() {
  return (
    <div aria-hidden className="relative bg-brand">
      <div className="bg-dots h-6 md:h-8" />
      <Ribbon className="relative -mt-px" />
    </div>
  )
}

/** Numbered section heading for long forms: the number is visual, the heading text carries the meaning. */
export function StepHeading({ n, icon: Icon, children, as: Tag = "h2" }: { n: number; icon: LucideIcon; children: React.ReactNode; as?: "h2" | "legend" }) {
  return (
    <Tag className="font-display flex items-center gap-3 px-0 text-lg md:text-xl">
      <span aria-hidden className="relative grid size-10 shrink-0 place-items-center rounded-full bg-navy-950 text-white">
        <Icon className="size-4" />
        <span className="absolute -end-1 -top-1 grid size-5 place-items-center rounded-full bg-orange text-[11px] font-bold text-navy-950">{n}</span>
      </span>
      {children}
    </Tag>
  )
}
