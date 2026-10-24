"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { Field, PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import type { Page } from "@/lib/types"

interface Entry { id: string; occurredAt: string; actor: string | null; actorUserId?: string | null; actorKind: string; action: string; entityType: string; entityId: string | null; contextRef: string | null; before: unknown; after: unknown; ip: string | null; requestId: string | null; hash: string }

/** Audit log (ch. 16.2 §8): filter, inspect masked before/after, export CSV (step-up, itself audited), verify the hash chain. */
export default function AuditPage() {
  const [draft, setDraft] = useState({ actor: "", action: "", entityType: "", ref: "", from: "", to: "" })
  const [f, setF] = useState(draft)
  const params = (cursor?: string) => { const u = new URLSearchParams({ limit: "100" }); for (const [k, v] of Object.entries(f)) if (v) u.set(k, k === "from" || k === "to" ? new Date(v).toISOString() : v); if (cursor) u.set("cursor", cursor); return u }
  const q = useInfiniteQuery({ queryKey: ["audit", f], queryFn: ({ pageParam }) => api<Page<Entry>>(`/v1/dev/audit-log?${params(pageParam)}`), initialPageParam: undefined as string | undefined, getNextPageParam: (p) => p.nextCursor ?? undefined })
  const rows = q.data?.pages.flatMap((p) => p.items) ?? []
  const [open, setOpen] = useState<string | null>(null)
  const [chain, setChain] = useState<{ ok: boolean; checked: number; brokenAt: number | null } | null>(null)
  const verify = async () => {
    try {
      const r = await api<{ ok: boolean; checked: number; brokenAt: number | null }>("/v1/dev/audit-log/verify")
      setChain(r.ok ? null : r)
      if (r.ok) toast.success(`Hash chain intact — ${r.checked.toLocaleString("en-GB")} entries checked.`)
    } catch (e) { toast.error(errText(e)) }
  }
  const exportCsv = async () => {
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, k === "from" || k === "to" ? new Date(v).toISOString() : v]))
      const blob = await api<Blob>("/v1/dev/audit-log/export", { body, raw: true })
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href)
      toast.success("Exported — the export itself is in the audit log")
    } catch (e) { toast.error(errText(e)) }
  }
  return (
    <div>
      <PageHead kicker="Platform" title="Audit log">
        <Button size="sm" variant="outline" onClick={() => void verify()}>Verify hash chain</Button>
        <Button size="sm" variant="outline" onClick={() => void exportCsv()}>Export CSV</Button>
      </PageHead>
      {chain && <p role="status" className={cn("px-5 py-2", chain.ok ? "bg-success-subtle text-success" : "bg-danger-subtle text-danger")} data-testid="chain">{chain.ok ? `Hash chain intact — ${chain.checked.toLocaleString("en-GB")} entries checked.` : `Chain broken at entry #${chain.brokenAt} (${chain.checked} checked).`}</p>}
      <form className="flex flex-wrap items-end gap-2 border-b border-rule bg-ledger px-5 py-2" onSubmit={(e) => { e.preventDefault(); setF(draft) }}>
        {(["actor", "action", "entityType", "ref"] as const).map((k) => <Field key={k} label={k} className="w-40"><input className="field-input font-mono" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} placeholder={k === "action" ? "config.draft_saved" : k === "ref" ? "UT-F-…" : k === "actor" ? "user id" : "flight_request"} /></Field>)}
        <Field label="From" className="w-48"><input type="datetime-local" className="field-input" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></Field>
        <Field label="To" className="w-48"><input type="datetime-local" className="field-input" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></Field>
        <Button size="sm" type="submit">Filter</Button>
      </form>
      <div className="px-5 py-3">
        {q.error ? <TileError message={errText(q.error)} onRetry={() => void q.refetch()} /> : q.isLoading ? <ListSkeleton rows={8} className="p-0" /> : !rows.length ? <EmptyState title="No entries." /> : (
          <TableScroll><table className="w-full bg-surface-raised font-mono text-[11.5px]" data-testid="audit">
            <thead className="bg-surface-raised"><tr className="border-b border-rule">{["#", "When", "Actor", "Action", "Entity", "Ref", "IP", "Hash"].map((h) => <th key={h} className="cap px-2 py-1 text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => [
              <tr key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className={cn("cursor-pointer border-b border-rule/70 hover:bg-line/30", open === r.id && "row-focus")}>
                <td className="px-2 py-1 text-steel">{r.id}</td><td className="px-2 py-1 whitespace-nowrap">{fmtDateTime(r.occurredAt)}</td><td className="max-w-40 truncate px-2 py-1">{(r.actor ?? r.actorUserId)?.slice(0, 8) ?? "—"} <span className="text-steel">{r.actorKind.toLowerCase()}</span></td><td className="px-2 py-1">{r.action}</td><td className="max-w-48 truncate px-2 py-1">{r.entityType}{r.entityId && <span className="text-steel"> {r.entityId.slice(0, 8)}</span>}</td><td className="px-2 py-1">{r.contextRef ?? ""}</td><td className="px-2 py-1 text-steel">{r.ip ?? ""}</td><td className="px-2 py-1 text-steel">{r.hash.slice(0, 8)}</td>
              </tr>,
              open === r.id && <tr key={`${r.id}-d`}><td colSpan={8} className="bg-ledger px-2 py-2"><div className="grid gap-3 md:grid-cols-2"><div><p className="cap">Before</p><pre className="max-h-60 overflow-auto whitespace-pre-wrap">{JSON.stringify(r.before, null, 2) ?? "—"}</pre></div><div><p className="cap">After</p><pre className="max-h-60 overflow-auto whitespace-pre-wrap">{JSON.stringify(r.after, null, 2) ?? "—"}</pre></div></div><p className="mt-1 text-steel">request {r.requestId ?? "—"} · hash {r.hash}</p></td></tr>,
            ])}</tbody>
          </table></TableScroll>
        )}
        {q.hasNextPage && <Button size="sm" variant="outline" className="mt-2" onClick={() => void q.fetchNextPage()}>Load older</Button>}
      </div>
    </div>
  )
}
