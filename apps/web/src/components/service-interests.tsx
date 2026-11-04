"use client"

import { useQuery } from "@tanstack/react-query"

import type { PublicServiceCatalogItem } from "@unitravel/contracts"

import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

/** Optional "also interested in" ticks (STAGE-26). Renders nothing when the catalogue is empty or fails to load: it must never block a request. */
export function ServiceInterests({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) {
  const { t, locale, money } = useI18n()
  const q = useQuery({ queryKey: ["services-catalog"], queryFn: () => api<PublicServiceCatalogItem[]>("/v1/services-catalog"), retry: false, staleTime: 5 * 60_000 })
  if (!q.data?.length) return null
  const fa = locale === "fa"
  return (
    <fieldset className="card-brand mt-6 p-5" data-testid="service-interests">
      <legend className="font-display float-start mb-1 w-full text-xl">{t("svcInterest.title")}</legend>
      <p className="clear-both text-xs text-steel">{t("svcInterest.hint")}</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {q.data.map((s) => {
          const desc = fa ? s.descriptionFa : s.descriptionEn
          const checked = value.includes(s.code)
          return (
            <li key={s.code}>
              <label className="flex h-full items-start gap-3 rounded-xl border border-line bg-cloud px-3 py-2.5 text-sm focus-within:ring-2 focus-within:ring-royal pointer-coarse:min-h-11">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-orange pointer-coarse:size-5" checked={checked} disabled={!checked && value.length >= 20}
                  onChange={(e) => onChange(e.target.checked ? [...value, s.code] : value.filter((c) => c !== s.code))} />
                <span>
                  <span className="font-medium" dir="auto">{fa ? s.nameFa : s.nameEn}</span>
                  {s.priceMinor !== undefined && s.currency && <span className="ms-2 text-steel">{t("svcInterest.price", { price: money({ amountMinor: s.priceMinor, currency: s.currency }) })}</span>}
                  {desc && <span className="mt-0.5 block text-xs text-steel" dir="auto">{desc}</span>}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}

/** What the customer asked about, on the request detail page. Names only, nothing priced. */
export function RequestedInterests({ items }: { items: { code: string; nameEn: string; nameFa: string }[] }) {
  const { t, locale } = useI18n()
  if (!items.length) return null
  return (
    <section data-testid="requested-interests">
      <h2 className="font-display mb-3 text-xl">{t("svcInterest.asked")}</h2>
      <ul className="flex flex-wrap gap-2">{items.map((s) => <li key={s.code} className="rounded-full bg-cloud px-3 py-1 text-sm" dir="auto">{locale === "fa" ? s.nameFa : s.nameEn}</li>)}</ul>
    </section>
  )
}
