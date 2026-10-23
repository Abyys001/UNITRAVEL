"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { Empty, ErrorLine, Field, PageHead, Panel, Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useSession } from "@/lib/session"

interface ListRow { id: string; listId: string; sourceUrl: string; version: string; fetchedAt: string; entryCount: number; status: string; error: string | null }
interface ScreenResult { result: string; hits: { matchedName: string; score: number; listId: string; externalId: string; reasons: string[]; programmes: string[] }[]; tokens: { token: string; phonetic: string }[] }

/** Sanctions list versions in force, a manual sync, and an ad-hoc name check (ch. 27.3). */
export default function ListsPage() {
  const { can } = useSession()
  const q = useQuery({ queryKey: ["sanction-lists"], queryFn: () => api<ListRow[]>("/v1/admin/compliance/lists"), refetchInterval: 30_000 })
  const sync = useAct(() => api("/v1/admin/compliance/lists/sync", { body: {} }), { success: "Sync queued — new versions appear here when ingested", invalidate: [["sanction-lists"]] })
  const [name, setName] = useState("")
  const [res, setRes] = useState<ScreenResult | null>(null)
  const screen = useAct(() => api<ScreenResult>("/v1/admin/compliance/screen", { body: { name } }), { onDone: setRes })
  return (
    <div>
      <PageHead kicker="Compliance" title="Sanctions lists">{can("compliance.case.decide") && <Button size="sm" variant="outline" onClick={() => sync.mutate()} loading={sync.isPending}>Sync now</Button>}</PageHead>
      <div className="grid gap-x-8 px-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Ingested versions">
          <ErrorLine error={q.error} />
          {!q.data ? <p className="text-slate">Loading…</p> : !q.data.length ? <Empty>No lists ingested yet.</Empty> : (
            <table className="w-full bg-white" data-testid="lists">
              <thead><tr className="border-b border-rule">{["List", "Version", "Entries", "Fetched", "Source", "Status"].map((h) => <th key={h} className="cap px-2 py-1 text-start font-normal">{h}</th>)}</tr></thead>
              <tbody>{q.data.map((l) => <tr key={l.id} className="border-b border-rule/70 align-top"><td className="px-2 py-1 font-mono">{l.listId}</td><td className="num px-2 py-1 text-[12px]">{l.version.slice(0, 12)}</td><td className="num px-2 py-1">{l.entryCount.toLocaleString("en-GB")}</td><td className="px-2 py-1 text-[12px]">{fmtDateTime(l.fetchedAt)}</td><td className="max-w-56 truncate px-2 py-1 text-[11px] text-slate" title={l.sourceUrl}>{l.sourceUrl}</td><td className="px-2 py-1"><Tag value={l.status} />{l.error && <span className="block text-[11px] text-brick">{l.error}</span>}</td></tr>)}</tbody>
            </table>
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
                <p><Tag value={res.result} /> {res.hits.length} candidate{res.hits.length === 1 ? "" : "s"}</p>
                <ul className="ledger-rows">{res.hits.slice(0, 10).map((h, i) => <li key={i} className="py-1"><span dir="auto">{h.matchedName}</span> <span className="num text-slate">{Math.round(h.score * 100)}% · {h.listId}</span></li>)}</ul>
                <p className="text-[11px] text-slate">Tokens: {res.tokens.map((t) => `${t.token}→${t.phonetic}`).join(" · ")}</p>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}
