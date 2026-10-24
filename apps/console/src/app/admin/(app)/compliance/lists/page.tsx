"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { BentoGrid, BentoTile, EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { Field, PageHead, Panel, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface ListRow { id: string; listId: string; sourceUrl: string; version: string; fetchedAt: string; entryCount: number; status: string; error: string | null }
interface ScreenResult { result: string; hits: { matchedName: string; score: number; listId: string; externalId: string; reasons: string[]; programmes: string[] }[]; tokens: { token: string; phonetic: string }[] }

/** Sanctions list versions in force, a manual sync, and an ad-hoc name check (ch. 27.3). */
export default function ListsPage() {
  const { can } = useSession()
  const t = useT()
  const q = useQuery({ queryKey: ["sanction-lists"], queryFn: () => api<ListRow[]>("/v1/admin/compliance/lists"), refetchInterval: 30_000 })
  const sync = useAct(() => api("/v1/admin/compliance/lists/sync", { body: {} }), { success: "Sync queued — new versions appear here when ingested", invalidate: [["sanction-lists"]] })
  const [name, setName] = useState("")
  const [res, setRes] = useState<ScreenResult | null>(null)
  const screen = useAct(() => api<ScreenResult>("/v1/admin/compliance/screen", { body: { name } }), { onDone: setRes })
  return (
    <div>
      <PageHead kicker="Compliance" title="Sanctions lists">{can("compliance.case.decide") && <Button size="sm" variant="outline" onClick={() => sync.mutate()} loading={sync.isPending}>Sync now</Button>}</PageHead>
      {q.data && (
        <BentoGrid className="px-5 pt-4 pb-2 max-sm:grid-cols-2 max-sm:gap-2" data-testid="case-summary">
          <BentoTile size="s" title={t("lists.versions")}><p className="num text-[22px] leading-tight font-semibold">{q.data.length}</p></BentoTile>
          <BentoTile size="s" title={t("lists.entries")}><p className="num text-[22px] leading-tight font-semibold">{q.data.reduce((n, l) => n + l.entryCount, 0).toLocaleString("en-GB")}</p></BentoTile>
          <BentoTile size="s" title={t("lists.fetched")}><p className="num text-[15px] font-medium">{q.data.length ? rel(q.data.map((l) => l.fetchedAt).sort().at(-1)) : "—"}</p></BentoTile>
          <BentoTile size="s" title={t("lists.errors")} tone={q.data.some((l) => l.error) ? "alert" : "default"}><p className={`num text-[22px] leading-tight font-semibold ${q.data.some((l) => l.error) ? "text-danger" : ""}`}>{q.data.filter((l) => l.error).length}</p></BentoTile>
        </BentoGrid>
      )}
      <div className="grid gap-x-8 px-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Ingested versions">
          {q.error ? <TileError message={errText(q.error)} onRetry={() => void q.refetch()} /> : !q.data ? <ListSkeleton rows={4} className="p-0" /> : !q.data.length ? <EmptyState title="No lists ingested yet." /> : (
            <TableScroll><table className="w-full bg-surface-raised" data-testid="lists">
              <thead><tr className="border-b border-rule">{["List", "Version", "Entries", "Fetched", "Source", "Status"].map((h) => <th key={h} className="cap px-2 py-1 text-start font-normal">{h}</th>)}</tr></thead>
              <tbody>{q.data.map((l) => <tr key={l.id} className="border-b border-rule/70 align-top"><td className="px-2 py-1 font-mono">{l.listId}</td><td className="num px-2 py-1 text-[12px]">{l.version.slice(0, 12)}</td><td className="num px-2 py-1">{l.entryCount.toLocaleString("en-GB")}</td><td className="px-2 py-1 text-[12px]">{fmtDateTime(l.fetchedAt)}</td><td className="max-w-56 truncate px-2 py-1 text-[11px] text-steel" title={l.sourceUrl}>{l.sourceUrl}</td><td className="px-2 py-1"><StateChip value={l.status} />{l.error && <span className="block text-[11px] text-danger">{l.error}</span>}</td></tr>)}</tbody>
            </table></TableScroll>
          )}
        </Panel>
        {can("compliance.case.decide") && (
          <Panel title="Ad-hoc screening">
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); screen.mutate() }}>
              <Field label="Name (Latin or Persian)"><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} dir="auto" /></Field>
              <Button size="sm" type="submit" loading={screen.isPending}>Screen</Button>
            </form>
            {res && (
              <div className="mt-3 space-y-1" role="status">
                <p><StateChip value={res.result} /> {res.hits.length} candidate{res.hits.length === 1 ? "" : "s"}</p>
                <ul className="ledger-rows">{res.hits.slice(0, 10).map((h, i) => <li key={i} className="py-1"><span dir="auto">{h.matchedName}</span> <span className="num text-steel">{Math.round(h.score * 100)}% · {h.listId}</span></li>)}</ul>
                <p className="text-[11px] text-steel">Tokens: {res.tokens.map((t) => `${t.token}→${t.phonetic}`).join(" · ")}</p>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}
