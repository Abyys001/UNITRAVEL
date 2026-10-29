import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound, permanentRedirect } from "next/navigation"

import type { CmsEntryView, CmsKind } from "@unitravel/contracts"
import { type Locale, translate } from "@unitravel/i18n"

import { Breadcrumbs, EntryCardLink, entryDate, ServiceCtas, ShareLinks, Toc } from "@/components/cms"
import { jsonLd } from "@/components/content-blocks"
import { type CmsLocale, entryPath, getEntry, listEntries, resolveEntry } from "@/lib/cms"
import { renderMarkdown } from "@/lib/markdown"
import { siteMenu } from "@/lib/site-server"

const SITE = process.env.PUBLIC_WEB_URL ?? "http://localhost:4000"
const BASE: Record<string, string> = { ARTICLE: "/blog", GUIDE: "/guides", LEGAL: "/legal", PAGE: "/info" }
const LIST_LABEL: Record<string, "nav.blog" | "cms.guides" | "cms.legal" | "cms.info"> = { ARTICLE: "nav.blog", GUIDE: "cms.guides", LEGAL: "cms.legal", PAGE: "cms.info" }
/** A GUIDE whose category is "destination" lives under /destinations (one canonical address, ADR-0017). */
export const DESTINATION = "destination"
type Section = "default" | "destinations"
const basePath = (kind: CmsKind, section: Section) => (section === "destinations" ? "/destinations" : BASE[kind]!)

/** Entry, or a redirect when the slug was changed; anything else (drafts, removed, API down) is a 404. */
async function load(kind: CmsKind, slug: string, locale: CmsLocale, section: Section): Promise<CmsEntryView> {
  const r = await getEntry(kind, slug, locale)
  if (r.ok) {
    const isDest = kind === "GUIDE" && r.data.category === DESTINATION
    if (section === "destinations" && !isDest) notFound()
    if (section === "default" && isDest) permanentRedirect(`/${locale}/destinations/${slug}`)
    return r.data
  }
  if (r.status === 404) {
    const to = await resolveEntry(kind, slug, locale)
    if (to.ok) {
      const t = to.data.redirectTo
      permanentRedirect(t.startsWith("/") ? (/^\/(en|fa)\//.test(t) ? t : `/${locale}${t}`) : `/${locale}${section === "destinations" ? `/destinations/${t}` : entryPath(kind, t) ?? BASE[kind]}`)
    }
  }
  notFound()
}

export async function entryMetadata(kind: CmsKind, params: Promise<{ locale: string; slug: string }>, section: Section = "default"): Promise<Metadata> {
  const { locale, slug } = await params
  const r = await getEntry(kind, slug, locale as CmsLocale)
  if (!r.ok) return {}
  const e = r.data
  if (section === "default" && kind === "GUIDE" && e.category === DESTINATION) return {}
  const path = `${basePath(kind, section)}/${slug}`
  const title = e.seoTitle ?? e.title
  const description = e.seoDescription ?? (e.summary || undefined)
  const languages: Record<string, string> = { [locale]: `/${locale}${path}` }
  if (e.alternateLocale) languages[e.alternateLocale] = `/${e.alternateLocale}${path}`
  return {
    title, description,
    alternates: { canonical: `/${locale}${path}`, languages },
    openGraph: { type: "article", title, description, url: `/${locale}${path}`, locale: locale === "fa" ? "fa_IR" : "en_GB", publishedTime: e.publishedAt ?? undefined, modifiedTime: e.updatedAt, images: e.featuredImage ? [{ url: e.featuredImage, alt: e.imageAlt ?? undefined }] : undefined },
    twitter: { card: e.featuredImage ? "summary_large_image" : "summary", title, description },
  }
}

export async function EntryPage({ kind, params, section = "default" }: { kind: CmsKind; params: Promise<{ locale: string; slug: string }>; section?: Section }) {
  const { locale: l, slug } = await params
  const locale = l as Locale
  const e = await load(kind, slug, locale, section)
  const article = kind === "ARTICLE" || kind === "GUIDE"
  const nonce = (await headers()).get("x-nonce") ?? undefined
  const [menu, related] = await Promise.all([siteMenu(), article ? listEntries({ kind, locale, category: e.category ?? undefined, pageSize: 4 }) : null])
  const { nodes, headings } = renderMarkdown(e.bodyMd, locale)
  const base = basePath(kind, section)
  const url = `${SITE}/${locale}${base}/${slug}`
  const listLabel = translate(locale, section === "destinations" ? "nav.destinations" : LIST_LABEL[kind]!)
  const more = related?.ok ? related.data.items.filter((x) => x.slug !== slug).slice(0, 3) : []
  const ld = {
    "@context": "https://schema.org", "@type": article ? "Article" : "WebPage", headline: e.title, description: e.summary || undefined, inLanguage: locale, mainEntityOfPage: url,
    datePublished: e.publishedAt ?? undefined, dateModified: e.updatedAt, image: e.featuredImage ? [e.featuredImage] : undefined,
    author: { "@type": "Organization", name: "Uni Travel" }, publisher: { "@type": "Organization", name: "Uni Travel" },
  }
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: translate(locale, "cms.home"), item: `${SITE}/${locale}` },
      { "@type": "ListItem", position: 2, name: listLabel, item: `${SITE}/${locale}${base}` },
      { "@type": "ListItem", position: 3, name: e.title, item: url },
    ],
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <Breadcrumbs locale={locale} trail={[{ label: translate(locale, "cms.home"), href: `/${locale}` }, { label: listLabel, href: kind === "LEGAL" || kind === "PAGE" ? undefined : `/${locale}${base}` }, { label: e.title }]} />
      <article className="card-brand p-6 md:p-10">
        {e.category && <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">{e.category}</p>}
        <h1 className="mt-1 font-display text-3xl leading-tight md:text-4xl">{e.title}</h1>
        {e.summary && <p className="mt-4 text-lg leading-8 text-steel">{e.summary}</p>}
        <p className="mt-4 text-sm text-steel">
          {e.publishedAt && <span>{translate(locale, "cms.published", { date: entryDate(e.publishedAt, locale) })} · </span>}
          <span>{translate(locale, "cms.updated", { date: entryDate(e.updatedAt, locale) })}</span>
        </p>
        <span aria-hidden className="mt-4 block h-1 w-16 rounded-full bg-orange" />
        {e.featuredImage && /^(https:\/\/|\/(?!\/))/.test(e.featuredImage) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.featuredImage} alt={e.imageAlt ?? ""} decoding="async" className="mt-6 aspect-[16/9] w-full rounded-xl object-cover" />
        )}
        <div className="mt-6"><Toc headings={headings} locale={locale} /></div>
        <div className="break-words" data-testid="entry-body">{nodes}</div>
        <ShareLinks url={url} title={e.title} locale={locale} />
        {article && <p className="mt-8 border-t border-line pt-4 text-sm leading-6 text-steel" data-testid="general-notice">{translate(locale, "content.generalNotice")}</p>}
      </article>
      <ServiceCtas services={section === "destinations" ? [...new Set([...e.relatedServices, "flights", "track", "support"])] : e.relatedServices} menu={menu} locale={locale} />
      {more.length > 0 && (
        <section aria-labelledby="related-title" className="mt-10">
          <h2 id="related-title" className="font-display text-xl text-navy-950">{translate(locale, section === "destinations" ? "nav.destinations" : "cms.related")}</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3">{more.map((x) => <EntryCardLink key={x.slug} e={x} locale={locale} base={base} />)}</ul>
        </section>
      )}
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLd([ld, crumbs]) }} />
    </div>
  )
}
