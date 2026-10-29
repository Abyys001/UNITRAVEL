import { z } from "zod"

import { CmsEntryPage, CmsEntryView, GlossaryTermView, type CmsKind } from "@unitravel/contracts"

export type CmsLocale = "en" | "fa"

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4100"

export type CmsResult<T> = { ok: true; data: T } | { ok: false; status: number }

async function get<T>(path: string, schema: z.ZodType<T>, locale: string): Promise<CmsResult<T>> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate: 60 }, headers: { accept: "application/json", "accept-language": locale } })
    if (!res.ok) return { ok: false, status: res.status }
    const parsed = schema.safeParse(await res.json())
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: 502 }
  } catch {
    return { ok: false, status: 503 }
  }
}

export interface ListParams { kind?: CmsKind; locale: CmsLocale; category?: string; tag?: string; q?: string; page?: number; pageSize?: number }

export function listEntries(p: ListParams) {
  const q = new URLSearchParams({ locale: p.locale })
  for (const k of ["kind", "category", "tag", "q"] as const) if (p[k]) q.set(k, p[k]!)
  if (p.page && p.page > 1) q.set("page", String(p.page))
  q.set("pageSize", String(p.pageSize ?? 12))
  return get(`/v1/cms/entries?${q}`, CmsEntryPage, p.locale)
}

export const getEntry = (kind: CmsKind, slug: string, locale: CmsLocale) => get(`/v1/cms/entries/${kind}/${encodeURIComponent(slug)}?locale=${locale}`, CmsEntryView, locale)

export const resolveEntry = (kind: CmsKind, slug: string, locale: CmsLocale) =>
  get(`/v1/cms/resolve/${kind}/${encodeURIComponent(slug)}?locale=${locale}`, z.object({ redirectTo: z.string() }), locale)

export function listGlossary(locale: string) {
  return get("/v1/cms/glossary", z.array(GlossaryTermView), locale)
}

const SitemapItem = z.object({ kind: z.string(), locale: z.string(), slug: z.string(), updatedAt: z.string().optional() })
export type SitemapItem = z.infer<typeof SitemapItem>
export const getSitemap = () => get("/v1/cms/sitemap", z.union([z.array(SitemapItem), z.object({ items: z.array(SitemapItem) }).transform((v) => v.items), z.object({ entries: z.array(SitemapItem) }).transform((v) => v.entries)]), "en")

/** Public path for an entry; GUIDE and LEGAL/PAGE entries have their own sections. */
export function entryPath(kind: string, slug: string): string | null {
  if (kind === "ARTICLE") return `/blog/${slug}`
  if (kind === "GUIDE") return `/guides/${slug}`
  if (kind === "LEGAL") return `/legal/${slug}`
  if (kind === "PAGE") return `/info/${slug}`
  return null
}
