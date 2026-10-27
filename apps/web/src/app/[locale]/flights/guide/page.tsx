import type { Metadata } from "next"

import { type ContentFlags, flightGuide, type Locale, translate, visibleItems } from "@unitravel/i18n"

import { Blocks, ContentPage } from "@/components/content-blocks"

type Props = { params: Promise<{ locale: string }> }

// No flag source yet: visa, insurance and online card payment stay hidden until their settings are wired (later phase).
const FLAGS: ContentFlags = {}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = (await params).locale as Locale
  return { title: translate(locale, "content.flightGuideTitle") }
}

export default async function Page({ params }: Props) {
  const locale = (await params).locale as Locale
  const items = visibleItems(flightGuide[locale], FLAGS)
  return (
    <ContentPage title={translate(locale, "content.flightGuideTitle")} notice={translate(locale, "content.generalNotice")}>
      <nav aria-label={translate(locale, "content.contents")} className="rounded-2xl bg-cloud p-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-steel">{translate(locale, "content.contents")}</p>
        <ol className="mt-3 list-decimal space-y-1.5 ps-6 text-sm marker:text-steel rtl:[list-style-type:persian]">
          {items.map((s) => <li key={s.id} className="ps-1"><a href={`#${s.id}`} className="font-semibold text-royal underline-offset-4 hover:underline">{s.heading}</a></li>)}
        </ol>
      </nav>
      <div className="mt-8 space-y-8">
        {items.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24">
            <h2 id={`${s.id}-h`} className="font-display text-xl text-navy-950 md:text-2xl">{s.heading}</h2>
            {s.blocks.length > 0 && <div className="mt-3"><Blocks blocks={s.blocks} locale={locale} /></div>}
          </section>
        ))}
      </div>
    </ContentPage>
  )
}
