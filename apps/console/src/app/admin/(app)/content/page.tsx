"use client"

import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import type { CmsKind, CmsStatus } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { asPaged, type EntryRow, KINDS, type Paged, StatusPill, STATUSES, useContentLabels } from "@/components/content"
import { Chips, ListCard, ListPage, Pager, tableClass, Toolbar } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { useSession } from "@/lib/session"

const SIZE = 25

/** Content entries (ADR-0017). Reading needs `cms.read`; creating needs `cms.write`. */
export default function ContentList() {
  const L = useContentLabels()
  const { t } = L
  const { can } = useSession()
  const router = useRouter()
  const [status, setStatus] = useState<CmsStatus | "">("")
  const [kind, setKind] = useState<CmsKind | "">("")
  const [locale, setLocale] = useState<"en" | "fa" | "">("")
  const [search, setSearch] = useState("")
  const [term, setTerm] = useState("")
  const [page, setPage] = useState(0)
  useEffect(() => { const h = setTimeout(() => setTerm(search.trim()), 300); return () => clearTimeout(h) }, [search])
  useEffect(() => { setPage(0) }, [status, kind, locale, term])
  const params = new URLSearchParams({ page: String(page + 1), pageSize: String(SIZE) })
  if (status) params.set("status", status)
  if (kind) params.set("kind", kind)
  if (locale) params.set("locale", locale)
  if (term) params.set("q", term)
  const q = useQuery({ queryKey: ["cms", "entries", params.toString()], queryFn: async () => asPaged(await api<Paged<EntryRow> | EntryRow[]>(`/v1/admin/cms/entries?${params}`)), placeholderData: (p) => p })
  const rows = q.data?.items ?? []
  const total = q.data?.total ?? 0
  const pager = { page, pages: Math.max(1, Math.ceil(total / SIZE)), setPage, total, size: SIZE }
  const href = (e: EntryRow) => `/content/${e.id}`
  const claims = (e: EntryRow) => (e.claimsToVerify.length ? <StatusChip tone="warn">{t("cms.claims.n", { n: e.claimsToVerify.length })}</StatusChip> : <span className="text-steel">—</span>)
  return (
    <ListPage>
      <PageHead title={t("nav.content")}>
        {can("cms.write") && <Button size="sm" onClick={() => router.push("/content/new")} data-testid="cms-new"><Plus aria-hidden />{t("cms.new")}</Button>}
      </PageHead>
      <Toolbar query={search} onQuery={setSearch} placeholder={t("cms.search")} count={q.data ? total : undefined}>
        <Chips label={t("pg.c.status")} value={status} options={[{ value: "" as const, label: t("pg.all") }, ...STATUSES.map((s) => ({ value: s, label: L.status(s) }))]} onChange={setStatus} />
        <label className="w-full sm:w-40">
          <span className="sr-only">{t("cms.c.kind")}</span>
          <NativeSelect className="field-input" value={kind} onChange={(e) => setKind(e.target.value as CmsKind | "")} data-testid="cms-kind-filter">
            <option value="">{t("cms.c.kind")}: {t("pg.all")}</option>
            {KINDS.map((k) => <option key={k} value={k}>{L.kind(k)}</option>)}
          </NativeSelect>
        </label>
        <label className="w-full sm:w-36">
          <span className="sr-only">{t("cms.c.locale")}</span>
          <NativeSelect className="field-input" value={locale} onChange={(e) => setLocale(e.target.value as "en" | "fa" | "")} data-testid="cms-locale-filter">
            <option value="">{t("cms.c.locale")}: {t("pg.all")}</option>
            <option value="en">English</option>
            <option value="fa">فارسی</option>
          </NativeSelect>
        </label>
      </Toolbar>
      {q.error ? <div className="px-6 py-3"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={6} className="px-6" /> : !rows.length ? <EmptyState title={t("cms.none")} /> : (
        <>
          <ul className="space-y-2 px-4 md:hidden" data-testid="cms-cards">
            {rows.map((e) => (
              <li key={e.id}>
                <Link href={href(e)} className="block min-h-11 rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)] active:bg-hover">
                  <span className="flex items-center justify-between gap-2"><span className="font-medium" dir="auto">{e.title}</span><StatusPill status={e.status} label={L.status(e.status)} /></span>
                  <span className="mt-1 block text-steel">{L.kind(e.kind)} · {e.locale.toUpperCase()} · <span className="ref">{e.slug}</span></span>
                  <span className="mt-1 flex items-center gap-2 text-meta text-steel"><span className="num">{fmtDate(e.updatedAt)}</span>{e.claimsToVerify.length > 0 && claims(e)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <ListCard fill className="hidden md:flex">
            <TableScroll>
              <table className={tableClass} data-testid="cms-entries">
                <thead><tr><th>{t("cms.c.title")}</th><th>{t("cms.c.kind")}</th><th>{t("cms.c.locale")}</th><th>{t("pg.c.status")}</th><th>{t("cms.c.claims")}</th><th>{t("cms.c.updated")}</th></tr></thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="cursor-pointer" onClick={(ev) => { if (!(ev.target as HTMLElement).closest("a")) router.push(href(e)) }}>
                      <td><Link href={href(e)} className="inline-block py-1 font-medium hover:underline" dir="auto">{e.title}</Link><span className="ref block text-meta text-steel">{e.slug}</span></td>
                      <td>{L.kind(e.kind)}</td>
                      <td className="uppercase">{e.locale}</td>
                      <td><StatusPill status={e.status} label={L.status(e.status)} /></td>
                      <td>{claims(e)}</td>
                      <td className="num whitespace-nowrap text-steel">{fmtDate(e.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Pager {...pager} className="border-t border-rule" />
          </ListCard>
          <div className="md:hidden"><Pager {...pager} /></div>
        </>
      )}
    </ListPage>
  )
}
