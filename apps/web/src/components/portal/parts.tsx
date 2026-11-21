"use client"

import { CreditCard } from "lucide-react"
import type { ReactNode } from "react"

import type { PortalStep } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"
import { trackPath } from "@/lib/portal-api"

/** Customer page for a request reference; the prefix says which kind it is (UT-F flight, UT-C cargo, UT-S service). Unknown shapes go to the tracking detail. */
export function requestPath(ref: string): string {
  if (ref.startsWith("UT-F-")) return `/requests/${ref}`
  if (ref.startsWith("UT-C-")) return `/cargo/${ref}`
  if (ref.startsWith("UT-S-")) return `/services/${ref}`
  return trackPath(ref)
}

/** A titled, solid section card. `tone="urgent"` adds a heavier border and an orange start edge for what needs the customer now. */
export function PortalSection({ id, title, action, tone = "default", children, className = "" }: { id: string; title: string; action?: ReactNode; tone?: "default" | "urgent"; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`portal-card relative min-w-0 p-5 md:p-6 ${tone === "urgent" ? "border-2 !border-orange-700" : ""} ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-display text-xl">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function StatusPill({ children }: { children: ReactNode }) {
  return <span className="inline-flex shrink-0 items-center rounded-full border border-(--rule-strong) bg-(--surface) px-3 py-1 text-xs font-semibold text-(color:--ink)">{children}</span>
}

export const linkClass = "font-semibold text-royal underline underline-offset-4 hover:text-navy-900"
export const ctaClass = "inline-flex items-center justify-center rounded-xl border-2 border-navy-950 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-navy-950 hover:text-white pointer-coarse:min-h-11"

/** Segmented progress with the position written out ("Step 2 of 5: Quote ready"), so state never relies on colour. */
export function StepProgress({ steps, title }: { steps: PortalStep[]; title: string }) {
  const { t, locale } = useI18n()
  if (!steps.length) return null
  const idx = steps.findIndex((s) => s.state === "CURRENT")
  const n = (v: number) => v.toLocaleString(locale === "fa" ? "fa-IR" : "en")
  const at = idx >= 0 ? idx : steps.every((s) => s.state === "DONE") ? steps.length - 1 : 0
  return (
    <div>
      <ol aria-label={t("portal.stepsLabel", { title })} className="flex gap-1">
        {steps.map((s) => (
          <li key={s.code} aria-current={s.state === "CURRENT" ? "step" : undefined} className={`h-2 flex-1 rounded-full ${s.state === "DONE" ? "bg-navy-900" : s.state === "CURRENT" ? "bg-orange-700" : "bg-haze"}`}>
            <span className="sr-only">{s.label} ({t(`portal.stepState.${s.state}`)})</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm text-(color:--ink-muted)">{t("portal.stepOf", { n: n(at + 1), total: n(steps.length) })}: <span className="font-semibold text-(color:--ink)">{steps[at].label}</span></p>
    </div>
  )
}

/**
 * Travel Card tile (ADR-0040 D7). `COMING_SOON` is the only state in use: a badge and a short explanation, no actions.
 * `ACTIVE` exists so turning the card on changes this tile, not the dashboard layout.
 */
export function TravelCardTile({ status, children }: { status: "COMING_SOON" | "ACTIVE"; children?: ReactNode }) {
  const { t } = useI18n()
  return (
    <section aria-labelledby="card-h" className="portal-card flex min-w-0 gap-4 p-5" data-testid="travel-card-tile" data-status={status}>
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-950 text-white"><CreditCard className="size-5" /></span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="card-h" className="font-display text-lg">{status === "ACTIVE" ? t("portal.card.active") : t("portal.card.title")}</h2>
          {status === "COMING_SOON" && <span className="rounded-full border border-orange-700 px-2.5 py-0.5 text-xs font-bold text-orange-700">{t("portal.card.soon")}</span>}
        </div>
        {status === "COMING_SOON" ? <p className="mt-2 text-sm leading-6 text-(color:--ink-muted)">{t("portal.card.body")}</p> : children}
      </div>
    </section>
  )
}
