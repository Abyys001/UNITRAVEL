"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { Empty, ErrorLine, PageHead, Tag } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import type { CaseView } from "@/lib/types"

const STATUSES = ["OPEN", "ESCALATED", "RELEASED", "DECLINED", ""]

/** Compliance officers' own queue (ch. 15.7): what triggered each hold, newest first. */
function Cases() {
  const params = useSearchParams()
  const router = useRouter()
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
        <nav className="flex gap-1">{STATUSES.map((s) => <Link key={s || "all"} href={`/compliance?status=${s}`} className={cn("rounded-sm border px-2 py-1", status === s ? "border-ink bg-ink text-paper" : "border-rule-strong")}>{s || "All"}</Link>)}</nav>
      </PageHead>
      <div className="px-5 py-3">
        <ErrorLine error={q.error} />
        {!q.data ? <p className="text-slate">Loading…</p> : !q.data.length ? <Empty>No {status.toLowerCase()} cases.</Empty> : (
          <table className="w-full bg-white" data-testid="cases">
            <thead className="bg-paper"><tr className="border-b border-rule">{["Request", "Trigger", "Summary", "Evidence", "Opened", "Four-eyes", "Status"].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {q.data.map((c, i) => (
                <tr key={c.id} onClick={() => setFocus(i)} onDoubleClick={() => router.push(`/compliance/${c.id}`)} className={cn("border-b border-rule/70", i === focus && "row-focus")}>
                  <td className="px-2 py-1.5"><Link href={`/compliance/${c.id}`} className="num hover:underline">{c.requestRef}</Link></td>
                  <td className="px-2 py-1.5"><Tag value={c.trigger} /></td>
                  <td className="max-w-md px-2 py-1.5" dir="auto">{c.summary}</td>
                  <td className="px-2 py-1.5 text-slate">{c.evidence.slice(0, 2).map((e) => `${e.label}${e.score != null ? ` (${Math.round(e.score * 100)}%)` : ""}`).join(" · ")}</td>
                  <td className="num px-2 py-1.5 text-[12px]" title={fmtDateTime(c.openedAt)}>{rel(c.openedAt)}</td>
                  <td className="px-2 py-1.5">{c.requiresFourEyes ? "required" : "—"}{c.pendingOverride && <span className="block text-[11px] text-copper-700">override awaiting 2nd</span>}</td>
                  <td className="px-2 py-1.5"><Tag value={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function CasesPage() { return <Suspense><Cases /></Suspense> }
