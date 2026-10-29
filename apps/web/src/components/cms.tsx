import { ChevronRight, Mail, MessageCircle } from "lucide-react"
import Link from "next/link"

import type { CmsEntryCard } from "@unitravel/contracts"
import { formatDate, type Locale, type MessageKey, translate } from "@unitravel/i18n"

import type { Heading } from "@/lib/markdown"

const SERVICE_PATH: Record<string, string> = {
  flights: "/", hotels: "/hotels", trains: "/trains", buses: "/buses", stays: "/stays", visa: "/visa", tours: "/tours", cip: "/cip",
  cargo: "/cargo", insurance: "/insurance", track: "/track", support: "/support", club: "/club",
}
/** Always offered; every other service only while its flag is on (a switched-off service is never advertised). */
const ALWAYS = new Set(["flights", "track", "support"])

export const entryDate = (iso: string, locale: Locale) => formatDate(iso, { locale, calendar: locale === "fa" ? "JALALI" : "GREGORIAN", dateOnly: true, year: true })

export function Breadcrumbs({ locale, trail }: { locale: Locale; trail: { label: string; href?: string }[] }) {
  return (
    <nav aria-label={translate(locale, "cms.breadcrumbs")} className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-steel">
        {trail.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 rtl:rotate-180" />}
            {c.href ? <Link href={c.href} className="font-semibold text-royal underline-offset-4 hover:underline">{c.label}</Link> : <span aria-current="page" className="text-navy-950">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function EntryCardLink({ e, locale, base }: { e: CmsEntryCard; locale: Locale; base: string }) {
  return (
    <li>
      <Link href={`/${locale}${base}/${e.slug}`} className="card-brand card-lift group flex h-full flex-col overflow-hidden" data-testid="entry-card">
        {e.featuredImage && /^(https:\/\/|\/(?!\/))/.test(e.featuredImage) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.featuredImage} alt={e.imageAlt ?? ""} loading="lazy" decoding="async" className="aspect-[16/9] w-full object-cover" />
        )}
        <div className="flex flex-1 flex-col gap-2 p-5">
          {e.category && <span className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">{e.category}</span>}
          <h2 className="font-display text-xl leading-snug text-navy-950 group-hover:text-royal">{e.title}</h2>
          {e.summary && <p className="line-clamp-3 leading-7 text-steel">{e.summary}</p>}
          <span className="mt-auto pt-2 text-sm text-steel">{entryDate(e.publishedAt ?? e.updatedAt, locale)}</span>
        </div>
      </Link>
    </li>
  )
}

export function Toc({ headings, locale }: { headings: Heading[]; locale: Locale }) {
  if (headings.length < 3) return null
  return (
    <nav aria-labelledby="toc-title" className="card-brand mb-8 p-5">
      <h2 id="toc-title" className="text-sm font-bold uppercase tracking-[0.14em] text-orange-700">{translate(locale, "cms.contents")}</h2>
      <ol className="mt-3 space-y-1.5">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "ps-4" : ""}><a href={`#${h.id}`} className="inline-flex text-royal underline-offset-4 hover:underline pointer-coarse:min-h-11 pointer-coarse:items-center">{h.text}</a></li>
        ))}
      </ol>
    </nav>
  )
}

export function ServiceCtas({ services, menu, locale }: { services: string[]; menu: Partial<Record<string, boolean>>; locale: Locale }) {
  const shown = services.filter((s) => SERVICE_PATH[s] && (ALWAYS.has(s) || menu[s] === true))
  if (shown.length === 0) return null
  return (
    <section aria-labelledby="next-title" className="mt-10">
      <h2 id="next-title" className="font-display text-xl text-navy-950">{translate(locale, "cms.whereNext")}</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {shown.map((s) => {
          const name = translate(locale, `nav.${s}` as MessageKey)
          return <li key={s}><Link href={`/${locale}${SERVICE_PATH[s]}`} className="btn-glass-light w-full justify-between">{translate(locale, "cms.openService", { service: name })}<ChevronRight aria-hidden className="size-4 rtl:rotate-180" /></Link></li>
        })}
      </ul>
    </section>
  )
}

/** Plain links, no third-party scripts or trackers. */
export function ShareLinks({ url, title, locale }: { url: string; title: string; locale: Locale }) {
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(title)
  const cls = "btn-glass-light !px-3 !py-2 text-sm pointer-coarse:min-h-11"
  return (
    <div className="mt-8 flex flex-wrap items-center gap-2" aria-label={translate(locale, "cms.share")} role="group">
      <span className="text-sm font-bold text-navy-950">{translate(locale, "cms.share")}</span>
      <a className={cls} href={`mailto:?subject=${t}&body=${u}`}><Mail aria-hidden className="size-4" />{translate(locale, "cms.shareEmail")}</a>
      <a className={cls} href={`https://wa.me/?text=${t}%20${u}`} target="_blank" rel="noopener noreferrer"><MessageCircle aria-hidden className="size-4" />{translate(locale, "cms.shareWhatsapp")}</a>
      <a className={cls} href={`https://x.com/intent/post?text=${t}&url=${u}`} target="_blank" rel="noopener noreferrer">{translate(locale, "cms.shareX")}</a>
    </div>
  )
}

export function Pagination({ locale, page, total, pageSize, hrefFor }: { locale: Locale; page: number; total: number; pageSize: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  const cls = "btn-glass-light !px-4 !py-2 text-sm pointer-coarse:min-h-11"
  return (
    <nav aria-label={translate(locale, "cms.pagination")} className="mt-8 flex items-center justify-between gap-3">
      {page > 1 ? <Link rel="prev" href={hrefFor(page - 1)} className={cls}>{translate(locale, "cms.prev")}</Link> : <span />}
      <span className="text-sm text-steel">{translate(locale, "cms.page", { n: page, total: pages })}</span>
      {page < pages ? <Link rel="next" href={hrefFor(page + 1)} className={cls}>{translate(locale, "cms.next")}</Link> : <span />}
    </nav>
  )
}
