import type { MetadataRoute } from "next"

import { entryPath, getSitemap } from "@/lib/cms"
import { siteMenu } from "@/lib/site-server"

const SITE = process.env.PUBLIC_WEB_URL ?? "http://localhost:4000"
const LOCALES = ["en", "fa"] as const
const STATIC = ["", "/blog", "/destinations", "/glossary", "/faq", "/travel-rules", "/flights/guide", "/track", "/support", "/terms", "/privacy"]
const SERVICES: Record<string, string> = { hotels: "/hotels", trains: "/trains", buses: "/buses", stays: "/stays", visa: "/visa", tours: "/tours", cip: "/cip", cargo: "/cargo", insurance: "/insurance", card: "/card", club: "/club" }

/** Static routes, switched-on service pages, and published CMS entries only (the API never returns drafts). */
export const dynamic = "force-dynamic"
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [menu, cms] = await Promise.all([siteMenu(), getSitemap()])
  const paths = [...STATIC, ...Object.entries(SERVICES).filter(([k]) => menu[k] === true).map(([, p]) => p)]
  const alt = (p: string) => ({ languages: Object.fromEntries(LOCALES.map((l) => [l, `${SITE}/${l}${p}`])) })
  const fixed = LOCALES.flatMap((l) => paths.map((p) => ({ url: `${SITE}/${l}${p}`, alternates: alt(p) })))
  const entries = cms.ok
    ? cms.data.flatMap((e) => {
        const p = entryPath(e.kind, e.slug)
        return p && (e.locale === "en" || e.locale === "fa") ? [{ url: `${SITE}/${e.locale}${p}`, lastModified: e.updatedAt ? new Date(e.updatedAt) : undefined }] : []
      })
    : []
  return [...fixed, ...entries]
}
