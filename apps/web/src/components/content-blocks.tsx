import Link from "next/link"

import type { Block, Item, Locale, Term } from "@unitravel/i18n"

/** Static long-form blocks (FAQ, travel rules, buying guide). No hooks, so server pages and client bands share it. */
export function Blocks({ blocks, locale }: { blocks: Block[]; locale: Locale }) {
  return (
    <div className="space-y-4 leading-8 text-steel">
      {blocks.map((b, i) => {
        if (b.kind === "p") return <p key={i}>{b.text}</p>
        if (b.kind === "dl") return <Terms key={i} items={b.items} />
        if (b.kind === "link") return <p key={i}><Link href={`/${locale}${b.href}`} className="font-semibold text-royal underline underline-offset-4 hover:text-navy-900">{b.text}</Link></p>
        const Tag = b.kind === "ol" ? "ol" : "ul"
        // Persian numerals for ordered steps under RTL; bullets keep the brand orange marker.
        const cls = b.kind === "ol" ? "list-decimal rtl:[list-style-type:persian] marker:font-bold marker:text-navy-900" : "list-disc marker:text-orange"
        return <Tag key={i} className={`${cls} space-y-2 ps-6`}>{b.items.map((t, j) => <li key={j} className="ps-1">{t}</li>)}</Tag>
      })}
    </div>
  )
}

/** Term and definition list; a short code (BB, 4★) is shown as a left-to-right badge. */
export function Terms({ items, className = "" }: { items: Term[]; className?: string }) {
  return (
    <dl className={`divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white ${className}`}>
      {items.map((x) => (
        <div key={x.term} className="grid gap-1 px-5 py-4 sm:grid-cols-[minmax(10rem,14rem)_1fr] sm:gap-6">
          <dt className="flex items-center gap-2 font-bold text-navy-950">{x.code && <span className="ltr rounded-md bg-cloud px-2 py-0.5 text-xs font-bold text-royal" dir="ltr">{x.code}</span>}{x.term}</dt>
          <dd className="leading-7 text-steel">{x.text}</dd>
        </div>
      ))}
    </dl>
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

const plain = (blocks: Block[]) => blocks.flatMap((b) => (b.kind === "ol" ? b.items.map((t, i) => `${i + 1}. ${t}`) : b.kind === "ul" ? b.items.map((t) => `- ${t}`) : b.kind === "link" ? [] : b.kind === "dl" ? b.items.map((t) => `${t.term}: ${t.text}`) : [b.text])).join("\n")

export const faqPageSchema = (items: Item[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((q) => ({ "@type": "Question", name: q.heading, acceptedAnswer: { "@type": "Answer", text: plain(q.blocks) } })),
})
