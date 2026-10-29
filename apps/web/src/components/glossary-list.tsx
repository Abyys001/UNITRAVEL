"use client"

import { Link2 } from "lucide-react"
import { useMemo, useState } from "react"

import type { GlossaryTermView } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"

const CATS = ["FLIGHT", "BAGGAGE", "CLASS", "HOTEL", "ROOM", "MEAL"] as const
const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[ً-ٟ‌ـ]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک")

/** Client filter over the fetched list; each term keeps a stable #slug anchor for deep links and SEO. */
export function GlossaryList({ terms }: { terms: GlossaryTermView[] }) {
  const { t, locale } = useI18n()
  const [q, setQ] = useState("")
  const [cat, setCat] = useState<string>("")
  const shown = useMemo(() => {
    const n = norm(q.trim())
    return terms.filter((x) => (!cat || x.category === cat) && (!n || norm([x.termFa, x.termEn, x.explanationFa, x.explanationEn].join(" ")).includes(n)))
  }, [terms, q, cat])
  const slugOf = useMemo(() => new Map(terms.flatMap((x) => [[norm(x.termEn), x.slug], [norm(x.termFa), x.slug]] as [string, string][])), [terms])
  const present = CATS.filter((c) => terms.some((x) => x.category === c))
  const chip = (on: boolean) => `inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition-colors pointer-coarse:min-h-11 ${on ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white/70 text-navy-950 hover:bg-white"}`
  return (
    <div>
      <label className="block"><span className="sr-only">{t("cms.searchTermsLabel")}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("cms.searchTermsPlaceholder")} maxLength={80} className="field h-12 w-full" data-testid="glossary-search" />
      </label>
      <div role="group" aria-label={t("cms.categoryLabel")} className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={!cat} onClick={() => setCat("")} className={chip(!cat)}>{t("cms.allCategories")}</button>
        {present.map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} className={chip(cat === c)}>{t(`cms.cat.${c}`)}</button>)}
      </div>
      <p role="status" aria-live="polite" className="mt-4 text-sm text-steel">{t("cms.glossaryCount", { n: shown.length })}</p>
      {shown.length === 0 ? (
        <p className="card-brand mt-4 p-6 text-steel">{t("cms.glossaryEmpty")}</p>
      ) : (
        <ul className="mt-4 grid gap-4 md:grid-cols-2" data-testid="glossary-list">
          {shown.map((x) => {
            const own = locale === "fa" ? x.explanationFa : x.explanationEn
            return (
              <li key={x.slug} id={x.slug} className="card-brand scroll-mt-24 p-5 target:ring-2 target:ring-orange" data-testid="glossary-term">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">{t(`cms.cat.${x.category}`)}</p>
                    <h2 className="mt-1 text-lg font-bold leading-snug text-navy-950">
                      <span lang="fa" dir="rtl" className="block font-fa">{x.termFa}</span>
                      <span lang="en" dir="ltr" className="block text-base font-semibold text-steel" style={{ textAlign: "start" }}>{x.termEn}</span>
                    </h2>
                  </div>
                  <a href={`#${x.slug}`} aria-label={`${t("cms.anchor")}: ${x.termEn}`} className="grid size-9 shrink-0 place-items-center rounded-full text-royal hover:bg-cloud pointer-coarse:size-11"><Link2 aria-hidden className="size-4" /></a>
                </div>
                {own ? <p className="mt-3 leading-8 text-steel" lang={locale}>{own}</p> : (
                  <>
                    <p className="mt-3 leading-8 text-steel" lang="fa" dir="rtl">{x.explanationFa}</p>
                    <p className="mt-1 text-xs text-steel">{t("cms.noEnglish")}</p>
                  </>
                )}
                {x.related.length > 0 && (
                  <p className="mt-3 text-sm text-steel"><span className="font-semibold text-navy-950">{t("cms.relatedTerms")}: </span>
                    {x.related.map((r, i) => {
                      const s = slugOf.get(norm(r))
                      return <span key={r}>{i > 0 && ", "}{s ? <a href={`#${s}`} className="text-royal underline underline-offset-4">{r}</a> : r}</span>
                    })}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
