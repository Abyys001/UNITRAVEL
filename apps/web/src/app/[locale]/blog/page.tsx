import type { Metadata } from "next"
import Link from "next/link"

import { type Locale, translate } from "@unitravel/i18n"

import { Breadcrumbs, EntryCardLink, Pagination } from "@/components/cms"
import { type CmsLocale, listEntries } from "@/lib/cms"

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; category?: string; tag?: string; page?: string }> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const locale = (await params).locale as Locale
  const sp = await searchParams
  const filtered = Boolean(sp.q || sp.category || sp.tag || (sp.page && sp.page !== "1"))
  return {
    title: translate(locale, "cms.blogTitle"), description: translate(locale, "cms.blogLead"),
    alternates: { canonical: `/${locale}/blog`, languages: { en: "/en/blog", fa: "/fa/blog" } },
    // Filtered and paged lists are for visitors; only the first page is for search engines.
    robots: filtered ? { index: false, follow: true } : undefined,
  }
}

const first = (s?: string) => (s ?? "").trim().slice(0, 80) || undefined

export default async function Page({ params, searchParams }: Props) {
  const locale = (await params).locale as Locale
  const sp = await searchParams
  const q = first(sp.q), category = first(sp.category), tag = first(sp.tag)
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const [res, all] = await Promise.all([
    listEntries({ kind: "ARTICLE", locale: locale as CmsLocale, q, category, tag, page }),
    listEntries({ kind: "ARTICLE", locale: locale as CmsLocale, pageSize: 50 }),
  ])
  const base = `/${locale}/blog`
  const url = (o: { category?: string; tag?: string; page?: number }) => {
    const u = new URLSearchParams()
    const c = "category" in o ? o.category : category
    const t = "tag" in o ? o.tag : tag
    if (q) u.set("q", q)
    if (c) u.set("category", c)
    if (t) u.set("tag", t)
    if (o.page && o.page > 1) u.set("page", String(o.page))
    const s = u.toString()
    return s ? `${base}?${s}` : base
  }
  const categories = all.ok ? [...new Set(all.data.items.map((e) => e.category).filter((c): c is string => Boolean(c)))] : []
  const chip = (active: boolean) => `inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition-colors pointer-coarse:min-h-11 ${active ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white/70 text-navy-950 hover:bg-white"}`
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <Breadcrumbs locale={locale} trail={[{ label: translate(locale, "cms.home"), href: `/${locale}` }, { label: translate(locale, "nav.blog") }]} />
      <h1 className="font-display text-3xl md:text-4xl">{translate(locale, "cms.blogTitle")}</h1>
      <span aria-hidden className="mt-4 block h-1 w-16 rounded-full bg-orange" />
      <p className="mt-4 max-w-2xl leading-8 text-steel">{translate(locale, "cms.blogLead")}</p>

      <form role="search" action={base} className="mt-6 flex flex-col gap-3 sm:flex-row">
        {category && <input type="hidden" name="category" value={category} />}
        {tag && <input type="hidden" name="tag" value={tag} />}
        <label className="flex-1"><span className="sr-only">{translate(locale, "cms.searchLabel")}</span>
          <input type="search" name="q" defaultValue={q} maxLength={80} placeholder={translate(locale, "cms.searchPlaceholder")} className="field h-12 w-full" />
        </label>
        <button type="submit" className="btn-orange !rounded-xl pointer-coarse:min-h-11">{translate(locale, "cms.search")}</button>
      </form>

      {(categories.length > 0 || tag) && (
        <nav aria-label={translate(locale, "cms.categoryLabel")} className="mt-5 flex flex-wrap gap-2">
          <Link href={url({ category: undefined, page: 1 })} aria-current={!category ? "true" : undefined} className={chip(!category)}>{translate(locale, "cms.allCategories")}</Link>
          {categories.map((c) => <Link key={c} href={url({ category: c, page: 1 })} aria-current={category === c ? "true" : undefined} className={chip(category === c)}>{c}</Link>)}
          {tag && <Link href={url({ tag: undefined, page: 1 })} className={chip(true)}>#{tag} · {translate(locale, "cms.clearTag")}</Link>}
        </nav>
      )}

      <div className="mt-8" aria-live="polite">
        {!res.ok ? (
          <p role="status" className="card-brand p-6 text-steel" data-testid="cms-unavailable">{translate(locale, "cms.unavailable")}</p>
        ) : res.data.items.length === 0 ? (
          <p role="status" className="card-brand p-6 text-steel" data-testid="cms-empty">{translate(locale, q || category || tag ? "cms.noMatch" : "cms.noPosts")}</p>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{res.data.items.map((e) => <EntryCardLink key={e.slug} e={e} locale={locale} base="/blog" />)}</ul>
            <Pagination locale={locale} page={res.data.page} total={res.data.total} pageSize={res.data.pageSize} hrefFor={(p) => url({ page: p })} />
          </>
        )}
      </div>
    </div>
  )
}
