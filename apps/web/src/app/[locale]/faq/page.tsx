import type { Metadata } from "next"
import { headers } from "next/headers"

import { faq, type Locale, translate } from "@unitravel/i18n"

import { ContentPage, faqPageSchema, jsonLd } from "@/components/content-blocks"
import { FaqAccordion } from "@/components/faq-accordion"

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = (await params).locale as Locale
  return { title: translate(locale, "content.faqTitle") }
}

export default async function Page({ params }: Props) {
  const locale = (await params).locale as Locale
  const nonce = (await headers()).get("x-nonce") ?? undefined
  return (
    <ContentPage title={translate(locale, "content.faqTitle")} notice={translate(locale, "content.generalNotice")}>
      <FaqAccordion items={faq[locale]} locale={locale} />
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLd(faqPageSchema(faq[locale])) }} />
    </ContentPage>
  )
}
