"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import type { VerificationQueueItem } from "@unitravel/contracts"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { Chips, ListCard, ListPage, Pager, tableClass, Toolbar, usePaged } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useT } from "@/lib/i18n"

/** Identity verification queue (ADR-0005): customers who confirmed their passport details, oldest first. */
export default function VerificationQueue() {
  const q = useQuery({ queryKey: ["verifications"], queryFn: () => api<VerificationQueueItem[]>("/v1/admin/verifications"), refetchInterval: 30_000 })
  const t = useT()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [doc, setDoc] = useState<"" | "PASSPORT" | "OTHER">("")
  const docLabel = (type: string) => (type === "PASSPORT" ? t("pg.ver.passport") : t("pg.ver.nid"))
  const matched = useMemo(() => { const n = search.trim().toLowerCase(); return (q.data ?? []).filter((v) => !n || v.travellerName.toLowerCase().includes(n) || v.nationality.toLowerCase().includes(n)) }, [q.data, search])
  const rows = useMemo(() => matched.filter((v) => !doc || (doc === "PASSPORT") === (v.documentType === "PASSPORT")), [matched, doc])
  const paged = usePaged(rows)
  const passports = matched.filter((v) => v.documentType === "PASSPORT").length
  return (
    <ListPage>
      <PageHead title={t("nav.passport")} />
      <Toolbar query={search} onQuery={setSearch} placeholder={t("pg.ver.search")} count={q.data ? rows.length : undefined}>
        <Chips label={t("pg.c.document")} value={doc} options={[{ value: "", label: t("pg.all"), count: matched.length }, { value: "PASSPORT", label: t("pg.ver.passport"), count: passports }, { value: "OTHER", label: t("pg.ver.nid"), count: matched.length - passports }]} onChange={setDoc} />
      </Toolbar>
      {q.error ? <div className="px-6 py-3"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={5} className="px-6" /> : !rows.length ? <EmptyState title={t("pg.ver.none")} hint={t("list.updated")} className="py-10" /> : (
        <>
          <ul className="space-y-2 px-4 md:hidden" data-testid="verification-cards">
            {paged.rows.map((v) => (
              <li key={v.id}>
                <Link href={`/verifications/${v.id}`} className="block min-h-11 rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)] active:bg-hover">
                  <span className="flex items-center justify-between gap-2"><span className="font-medium" dir="ltr">{v.travellerName}</span><StateChip value="SUBMITTED" /></span>
                  <span className="mt-1 block text-steel">{v.nationality} · {docLabel(v.documentType)}</span>
                  <span className="num mt-1 block text-meta text-steel">{t("ver.waiting")} {rel(v.submittedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <ListCard fill className="hidden md:flex">
            <TableScroll>
              <table className={tableClass} data-testid="verifications">
                <thead><tr><th>{t("pg.c.traveller")}</th><th>{t("pg.c.nationality")}</th><th>{t("pg.c.document")}</th><th>{t("ver.waiting")}</th></tr></thead>
                <tbody>
                  {paged.rows.map((v) => (
                    <tr key={v.id} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(`/verifications/${v.id}`) }}>
                      <td><Link href={`/verifications/${v.id}`} className="inline-block py-1 font-medium hover:underline" dir="ltr">{v.travellerName}</Link></td>
                      <td>{v.nationality}</td>
                      <td>{docLabel(v.documentType)}</td>
                      <td className="num text-steel" title={fmtDateTime(v.submittedAt)}>{rel(v.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Pager {...paged} className="border-t border-rule" />
          </ListCard>
          <div className="md:hidden"><Pager {...paged} /></div>
        </>
      )}
    </ListPage>
  )
}
