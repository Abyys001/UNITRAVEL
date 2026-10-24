"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useT } from "@/lib/i18n"
import type { CaseView } from "@/lib/types"

const STATUSES = ["OPEN", "ESCALATED", "RELEASED", "DECLINED", ""]

/** Compliance officers' own queue (ch. 15.7): what triggered each hold, newest first. */
function Cases() {
  const params = useSearchParams()
  const router = useRouter()
  const t = useT()
  const status = params.get("status") ?? "OPEN"
  const q = useQuery({ queryKey: ["cases", status], queryFn: () => api<CaseView[]>(`/v1/admin/compliance/cases${status ? `?status=${status}` : ""}`), refetchInterval: 20_000 })
  const [focus, setFocus] = useState(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [role=dialog]")) return
      const n = q.data?.length ?? 0
      if (e.key === "j") setFocus((f) => Math.min(f + 1, n - 1))
      if (e.key === "k") setFocus((f) => Math.max(f - 1, 0))
      if (e.key === "Enter" && q.data?.[focus]) router.push(`/compliance/${q.data[focus]!.id}`)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  return (
    <div>
      <PageHead kicker="Compliance" title="Cases">
        <nav className="flex flex-wrap gap-1" aria-label="Case status">{STATUSES.map((x) => <Link key={x || "all"} href={`/compliance?status=${x}`} aria-current={status === x ? "page" : undefined} className={cn("inline-flex min-h-8 items-center rounded-sm border px-2.5", status === x ? "border-ink bg-ink text-surface" : "border-rule-strong hover:bg-hover")}>{x || "All"}</Link>)}</nav>
      </PageHead>
      <div className="px-5 py-3">
        {q.error ? <TileError message={errText(q.error)} onRetry={() => void q.refetch()} /> : !q.data ? <ListSkeleton rows={6} className="p-0" /> : !q.data.length ? <EmptyState title={`No ${status.toLowerCase() || "compliance"} cases.`} hint={t("state.nothing")} /> : (
          <>
            <ul className="space-y-2 md:hidden" data-testid="cases-cards">
              {q.data.map((c) => (
                <li key={c.id}>
                  <Link href={`/compliance/${c.id}`} className="block min-h-11 rounded-xl border border-rule bg-surface-raised p-3 active:bg-hover">
                    <span className="flex items-center justify-between gap-2"><span className="num font-medium">{c.requestRef}</span><StateChip value={c.status} /></span>
                    <span className="mt-1 block" dir="auto">{c.summary}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5"><StateChip value={c.trigger} />{c.requiresFourEyes && <StatusChip tone="warn">{t("comp.fourEyes")}</StatusChip>}{c.pendingOverride && <StatusChip tone="danger">{t("comp.override")}</StatusChip>}<span className="num text-[12px] text-steel">{rel(c.openedAt)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
            <TableScroll className="hidden md:block">
              <table className="w-full bg-surface-raised" data-testid="cases">
                <thead className="bg-surface-raised"><tr className="border-b border-rule">{["Request", "Trigger", "Summary", "Evidence", "Opened", "Four-eyes", "Status"].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
                <tbody>
                  {q.data.map((c, i) => (
                    <tr key={c.id} onClick={() => setFocus(i)} onDoubleClick={() => router.push(`/compliance/${c.id}`)} className={cn("border-b border-rule/70 hover:bg-hover/60", i === focus && "row-focus")}>
                      <td className="px-2 py-1.5"><Link href={`/compliance/${c.id}`} className="num inline-block py-1 hover:underline">{c.requestRef}</Link></td>
                      <td className="px-2 py-1.5"><StateChip value={c.trigger} /></td>
                      <td className="max-w-md px-2 py-1.5" dir="auto">{c.summary}</td>
                      <td className="px-2 py-1.5 text-steel">{c.evidence.slice(0, 2).map((e) => `${e.label}${e.score != null ? ` (${Math.round(e.score * 100)}%)` : ""}`).join(" · ")}</td>
                      <td className="num px-2 py-1.5 text-[12px]" title={fmtDateTime(c.openedAt)}>{rel(c.openedAt)}</td>
                      <td className="px-2 py-1.5">{c.requiresFourEyes ? "required" : "—"}{c.pendingOverride && <span className="block text-[11px] text-orange-700">override awaiting 2nd</span>}</td>
                      <td className="px-2 py-1.5"><StateChip value={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </>
        )}
      </div>
    </div>
  )
}

export default function CasesPage() { return <Suspense><Cases /></Suspense> }
