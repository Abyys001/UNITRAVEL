import type { Metadata } from "next"

import { type Locale, translate } from "@unitravel/i18n"

import { Breadcrumbs, EntryCardLink, Pagination } from "@/components/cms"
import { DESTINATION } from "@/components/cms-article"
import { type CmsLocale, listEntries } from "@/lib/cms"

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = (await params).locale as Locale
  return {
    title: translate(locale, "cms.destinationsTitle"), description: translate(locale, "cms.destinationsLead"),
    alternates: { canonical: `/${locale}/destinations`, languages: { en: "/en/destinations", fa: "/fa/destinations" } },
  }
}

/** Destination guides are GUIDE entries with category "destination": editorial notes only, never prices or availability. */
export default async function Page({ params, searchParams }: Props) {
  const locale = (await params).locale as Locale
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1)
  const res = await listEntries({ kind: "GUIDE", locale: locale as CmsLocale, category: DESTINATION, page })
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <Breadcrumbs locale={locale} trail={[{ label: translate(locale, "cms.home"), href: `/${locale}` }, { label: translate(locale, "nav.destinations") }]} />
      <h1 className="font-display text-3xl md:text-4xl">{translate(locale, "cms.destinationsTitle")}</h1>
      <span aria-hidden className="mt-4 block h-1 w-16 rounded-full bg-orange" />
      <p className="mt-4 max-w-2xl leading-8 text-steel">{translate(locale, "cms.destinationsLead")}</p>
      {!res.ok ? (
        <p role="status" className="card-brand mt-8 p-6 text-steel">{translate(locale, "cms.unavailable")}</p>
      ) : res.data.items.length === 0 ? (
        <p role="status" className="card-brand mt-8 p-6 text-steel" data-testid="destinations-empty">{translate(locale, "cms.destinationsNone")}</p>
      ) : (
        <>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{res.data.items.map((e) => <EntryCardLink key={e.slug} e={e} locale={locale} base="/destinations" />)}</ul>
          <Pagination locale={locale} page={page} total={res.data.total} pageSize={res.data.pageSize} hrefFor={(p) => `/${locale}/destinations${p > 1 ? `?page=${p}` : ""}`} />
        </>
      )}
    </div>
  )
}
