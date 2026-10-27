import { ChevronDown } from "lucide-react"
import Link from "next/link"

import type { Block, Item, Locale } from "@unitravel/i18n"

/** Static long-form blocks (FAQ, travel rules, buying guide). No hooks, so server pages and client bands share it. */
export function Blocks({ blocks, locale }: { blocks: Block[]; locale: Locale }) {
  return (
    <div className="space-y-4 leading-8 text-steel">
      {blocks.map((b, i) => {
        if (b.kind === "p") return <p key={i}>{b.text}</p>
        if (b.kind === "link") return <p key={i}><Link href={`/${locale}${b.href}`} className="font-semibold text-royal underline underline-offset-4 hover:text-navy-900">{b.text}</Link></p>
        const Tag = b.kind === "ol" ? "ol" : "ul"
        // Persian numerals for ordered steps under RTL; bullets keep the brand orange marker.
        const cls = b.kind === "ol" ? "list-decimal rtl:[list-style-type:persian] marker:font-bold marker:text-navy-900" : "list-disc marker:text-orange"
        return <Tag key={i} className={`${cls} space-y-2 ps-6`}>{b.items.map((t, j) => <li key={j} className="ps-1">{t}</li>)}</Tag>
      })}
    </div>
  )
}

/** Native details/summary accordion: keyboard and screen-reader behaviour comes from the browser. */
export function FaqAccordion({ items, locale }: { items: Item[]; locale: Locale }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
      {items.map((q) => (
        <details key={q.id} id={q.id} className="group" data-testid="faq-item">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 text-start font-bold leading-snug text-navy-950 hover:bg-cloud md:px-6 [&::-webkit-details-marker]:hidden">
            <span>{q.heading}</span>
            <ChevronDown aria-hidden className="mt-0.5 size-5 shrink-0 text-royal transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-5 pb-5 md:px-6"><Blocks blocks={q.blocks} locale={locale} /></div>
        </details>
      ))}
    </div>
  )
}

/** Page frame shared by the three content pages: brand card, orange rule, notice at the end. */
export function ContentPage({ title, notice, children }: { title: string; notice: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <div className="card-brand p-6 md:p-10">
        <h1 className="font-display text-3xl md:text-4xl">{title}</h1>
        <span aria-hidden className="mt-4 block h-1 w-16 rounded-full bg-orange" />
        <div className="mt-6">{children}</div>
        <p className="mt-10 border-t border-line pt-4 text-sm leading-6 text-steel" data-testid="general-notice">{notice}</p>
      </div>
    </article>
  )
}

/** Serialised for a JSON-LD script: "<" is escaped so content can never close the script element. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}

const plain = (blocks: Block[]) => blocks.flatMap((b) => (b.kind === "ol" ? b.items.map((t, i) => `${i + 1}. ${t}`) : b.kind === "ul" ? b.items.map((t) => `- ${t}`) : b.kind === "link" ? [] : [b.text])).join("\n")

export const faqPageSchema = (items: Item[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((q) => ({ "@type": "Question", name: q.heading, acceptedAnswer: { "@type": "Answer", text: plain(q.blocks) } })),
})
