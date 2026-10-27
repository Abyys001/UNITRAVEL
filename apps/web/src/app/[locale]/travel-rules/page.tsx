import type { Metadata } from "next"

import { type Locale, translate, travelRules } from "@unitravel/i18n"

import { Blocks, ContentPage } from "@/components/content-blocks"

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = (await params).locale as Locale
  return { title: translate(locale, "content.travelRulesTitle") }
}

export default async function Page({ params }: Props) {
  const locale = (await params).locale as Locale
  return (
    <ContentPage title={translate(locale, "content.travelRulesTitle")} notice={translate(locale, "content.generalNotice")}>
      <div className="space-y-8">
        {travelRules[locale].map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`} className="font-display mb-3 text-xl text-navy-950 md:text-2xl">{s.heading}</h2>
            <Blocks blocks={s.blocks} locale={locale} />
          </section>
        ))}
      </div>
    </ContentPage>
  )
}
