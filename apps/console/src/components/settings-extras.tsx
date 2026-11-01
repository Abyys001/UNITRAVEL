"use client"

import { Plus, Trash2 } from "lucide-react"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { type Issue, friendlyIssue } from "@/components/schema-form"
import { Arrow, Field } from "@/components/ui"
import { useT } from "@/lib/i18n"

interface Extras {
  payment?: { offlineInstructions: { en: string; fa: string } | null }
  listings?: { flightRoutes: { from: string; to: string }[] }
}

/** Marker so a SchemaForm hides exactly these two groups; this form edits them whole (see SETTINGS_EXTRA_PATHS). */
export const SETTINGS_EXTRA_PATHS = ["payment", "listings"] as const

/**
 * Two settings the generic form cannot edit well: `payment.offlineInstructions` (nullable en/fa text, ADR-0020) and
 * `listings.flightRoutes` (a list of origin and destination pairs, ADR-0021). Both are plain settings, validated by the
 * same AppSettings schema as everything else on the page; this form only gives them proper inputs.
 */
export function SettingsExtras<D extends object>({ draft, onChange, issues }: { draft: D; onChange: (next: D) => void; issues: Issue[] }) {
  const t = useT()
  const d = draft as D & Extras
  const text = d.payment?.offlineInstructions ?? null
  const routes = d.listings?.flightRoutes ?? []
  const setText = (patch: Partial<{ en: string; fa: string }>) => {
    const next = { en: text?.en ?? "", fa: text?.fa ?? "", ...patch }
    // Both empty means "not decided yet": the payment page then shows no instructions at all (null, never a blank string).
    onChange({ ...d, payment: { ...d.payment, offlineInstructions: next.en.trim() || next.fa.trim() ? next : null } })
  }
  const setRoutes = (next: { from: string; to: string }[]) => onChange({ ...d, listings: { ...d.listings, flightRoutes: next } })
  const err = (prefix: string) => issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`))
  const iata = (v: string) => v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3)
  return (
    <div className="mt-4 space-y-4" data-testid="settings-extras">
      <fieldset className="rounded-lg border border-rule bg-surface p-4">
        <legend className="px-1.5 text-meta font-semibold text-ink">{t("set.pay.title")}</legend>
        <p className="mb-3 text-meta text-steel">{t("set.pay.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`${t("set.pay.text")} (English)`}><textarea className="field-input min-h-24" value={text?.en ?? ""} onChange={(e) => setText({ en: e.target.value })} dir="ltr" lang="en" data-testid="offline-en" /></Field>
          <Field label={`${t("set.pay.text")} (فارسی)`}><textarea className="field-input min-h-24 font-fa" value={text?.fa ?? ""} onChange={(e) => setText({ fa: e.target.value })} dir="rtl" lang="fa" data-testid="offline-fa" /></Field>
        </div>
        <p className="mt-2 text-caption text-steel">{text ? t("set.pay.set") : t("set.pay.unset")}</p>
        {err("payment").slice(0, 3).map((i) => <p key={i.path + i.message} className="mt-1 text-meta text-danger"><span dir="ltr">{i.path}</span>: {friendlyIssue(i.message, t)}</p>)}
      </fieldset>
      <fieldset className="rounded-lg border border-rule bg-surface p-4">
        <legend className="px-1.5 text-meta font-semibold text-ink">{t("set.routes.title")}</legend>
        <p className="mb-3 text-meta text-steel">{t("set.routes.hint")}</p>
        {!routes.length && <p className="mb-2 text-steel" data-testid="routes-empty">{t("set.routes.none")}</p>}
        <ul className="space-y-2" data-testid="flight-routes">
          {routes.map((r, i) => {
            const bad = err(`listings.flightRoutes.${i}`).length > 0
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <input aria-label={t("set.routes.from", { n: i + 1 })} className={cn("field-input num w-24 uppercase", bad && "border-danger")} value={r.from} maxLength={3} placeholder="IKA" dir="ltr" onChange={(e) => setRoutes(routes.map((x, j) => (j === i ? { ...x, from: iata(e.target.value) } : x)))} />
                <Arrow className="text-steel" />
                <input aria-label={t("set.routes.to", { n: i + 1 })} className={cn("field-input num w-24 uppercase", bad && "border-danger")} value={r.to} maxLength={3} placeholder="LHR" dir="ltr" onChange={(e) => setRoutes(routes.map((x, j) => (j === i ? { ...x, to: iata(e.target.value) } : x)))} />
                <Button type="button" variant="ghost" size="icon-sm" className="text-steel hover:text-danger" aria-label={t("set.routes.remove", { n: i + 1 })} onClick={() => setRoutes(routes.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
                {bad && <span className="text-meta text-danger">{t("set.routes.bad")}</span>}
              </li>
            )
          })}
        </ul>
        {routes.length < 30 && <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setRoutes([...routes, { from: "", to: "" }])}><Plus aria-hidden />{t("set.routes.add")}</Button>}
        {err("listings").filter((i) => !i.path.startsWith("listings.flightRoutes.")).slice(0, 3).map((i) => <p key={i.path + i.message} className="mt-1 text-meta text-danger"><span dir="ltr">{i.path}</span>: {friendlyIssue(i.message, t)}</p>)}
      </fieldset>
    </div>
  )
}
