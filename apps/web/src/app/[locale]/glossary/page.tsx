import type { Metadata } from "next"

import { type Locale, translate } from "@unitravel/i18n"

import { Breadcrumbs } from "@/components/cms"
import { GlossaryList } from "@/components/glossary-list"
import { listGlossary } from "@/lib/cms"

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = (await params).locale as Locale
  return {
    title: translate(locale, "cms.glossaryTitle"), description: translate(locale, "cms.glossaryLead"),
    alternates: { canonical: `/${locale}/glossary`, languages: { en: "/en/glossary", fa: "/fa/glossary" } },
  }
}

export default async function Page({ params }: Props) {
  const locale = (await params).locale as Locale
  const res = await listGlossary(locale)
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <Breadcrumbs locale={locale} trail={[{ label: translate(locale, "cms.home"), href: `/${locale}` }, { label: translate(locale, "nav.glossary") }]} />
      <h1 className="font-display text-3xl md:text-4xl">{translate(locale, "cms.glossaryTitle")}</h1>
      <span aria-hidden className="mt-4 block h-1 w-16 rounded-full bg-orange" />
      <p className="mt-4 max-w-2xl leading-8 text-steel">{translate(locale, "cms.glossaryLead")}</p>
      <div className="mt-6">
        {!res.ok ? <p role="status" className="card-brand p-6 text-steel" data-testid="cms-unavailable">{translate(locale, "cms.glossaryUnavailable")}</p>
          : res.data.length === 0 ? <p role="status" className="card-brand p-6 text-steel" data-testid="cms-empty">{translate(locale, "cms.glossaryNone")}</p>
          : <GlossaryList terms={res.data} />}
      </div>
    </div>
  )
}
