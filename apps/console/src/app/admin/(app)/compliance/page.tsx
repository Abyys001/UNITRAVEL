"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { Chips, ListCard, ListPage, Pager, tableClass, Toolbar, usePaged } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import type { CaseView } from "@/lib/types"

const STATUSES = ["OPEN", "ESCALATED", "RELEASED", "DECLINED"] as const
const STATUS_LABEL: Record<string, MsgKey> = { OPEN: "cstatus.OPEN", ESCALATED: "cstatus.ESCALATED", RELEASED: "cstatus.RELEASED", DECLINED: "cstatus.DECLINED" }

/** Compliance officers' own queue (ch. 15.7): what triggered each hold, newest first. */
function Cases() {
  const params = useSearchParams()
  const router = useRouter()
  const t = useT()
  const status = params.get("status") ?? "OPEN"
  const q = useQuery({ queryKey: ["cases", status], queryFn: () => api<CaseView[]>(`/v1/admin/compliance/cases${status ? `?status=${status}` : ""}`), refetchInterval: 20_000 })
  const [search, setSearch] = useState("")
  const filtered = useMemo(() => { const n = search.trim().toLowerCase(); return (q.data ?? []).filter((c) => !n || c.requestRef.toLowerCase().includes(n) || c.summary.toLowerCase().includes(n)) }, [q.data, search])
  const paged = usePaged(filtered)
  const [focus, setFocus] = useState(0)
  useEffect(() => { setFocus(0) }, [paged.page, status, search])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [role=dialog]")) return
      const n = paged.rows.length
      if (e.key === "j") setFocus((f) => Math.min(f + 1, n - 1))
      if (e.key === "k") setFocus((f) => Math.max(f - 1, 0))
      if (e.key === "Enter" && paged.rows[focus]) router.push(`/compliance/${paged.rows[focus]!.id}`)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  const cols: MsgKey[] = ["pg.c.request", "pg.c.trigger", "pg.c.summary", "pg.c.evidence", "pg.c.opened", "pg.c.fourEyes", "pg.c.status"]
  return (
    <ListPage>
      <PageHead title={t("nav.cases")} />
      <Toolbar query={search} onQuery={setSearch} placeholder={t("pg.cases.search")} count={q.data ? filtered.length : undefined}>
        <Chips label={t("cstatus.label")} value={status as (typeof STATUSES)[number] | ""} options={[...STATUSES.map((x) => ({ value: x, label: t(STATUS_LABEL[x]!) })), { value: "", label: t("nav.all") }]} onChange={(v) => router.replace(`/compliance?status=${v}`)} />
      </Toolbar>
      {q.error ? <div className="px-6 py-3"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={6} className="px-6" /> : !filtered.length ? <EmptyState title={t("cstatus.none", { s: status in STATUS_LABEL ? t(STATUS_LABEL[status]!).toLowerCase() : status.toLowerCase() || t("nav.compliance").toLowerCase() })} hint={t("state.nothing")} /> : (
        <>
          <ul className="space-y-2 px-4 md:hidden" data-testid="cases-cards">
            {paged.rows.map((c) => (
              <li key={c.id}>
                <Link href={`/compliance/${c.id}`} className="block min-h-11 rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)] active:bg-hover">
                  <span className="flex items-center justify-between gap-2"><span className="ref font-medium">{c.requestRef}</span><StateChip value={c.status} /></span>
                  <span className="mt-1 block" dir="auto">{c.summary}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5"><StateChip value={c.trigger} />{c.requiresFourEyes && <StatusChip tone="warn">{t("comp.fourEyes")}</StatusChip>}{c.pendingOverride && <StatusChip tone="danger">{t("comp.override")}</StatusChip>}<span className="num text-meta text-steel">{rel(c.openedAt)}</span></span>
                </Link>
              </li>
            ))}
          </ul>
          <ListCard fill className="hidden md:flex">
            <TableScroll>
              <table className={tableClass} data-testid="cases">
                <thead><tr>{cols.map((h) => <th key={h}>{t(h)}</th>)}</tr></thead>
                <tbody>
                  {paged.rows.map((c, i) => (
                    <tr key={c.id} onClick={() => setFocus(i)} onDoubleClick={() => router.push(`/compliance/${c.id}`)} className={cn(i === focus && "row-focus")}>
                      <td className="whitespace-nowrap"><Link href={`/compliance/${c.id}`} className="ref inline-block py-1 font-semibold text-ink hover:text-link hover:underline">{c.requestRef}</Link></td>
                      <td><StateChip value={c.trigger} /></td>
                      <td className="max-w-md" dir="auto"><span className="line-clamp-2" title={c.summary}>{c.summary}</span></td>
                      <td className="max-w-72 text-meta text-steel">{(() => { const ev = c.evidence.slice(0, 2).map((e) => `${e.label}${e.score != null ? ` (${Math.round(e.score * 100)}%)` : ""}`).join(" · "); return <span className="line-clamp-2" title={ev}>{ev}</span> })()}</td>
                      <td className="num whitespace-nowrap text-steel" title={fmtDateTime(c.openedAt)}>{rel(c.openedAt)}</td>
                      <td className="text-steel">{c.requiresFourEyes ? t("comp.fourEyes.required") : "—"}{c.pendingOverride && <span className="block text-caption text-orange-700">{t("comp.override")}</span>}</td>
                      <td><StateChip value={c.status} /></td>
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

export default function CasesPage() { return <Suspense><Cases /></Suspense> }
