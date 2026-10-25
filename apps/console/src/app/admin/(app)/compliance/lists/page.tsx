"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { ListCard, tableClass } from "@/components/data-list"
import { Field, PageHead, Panel, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
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
      <PageHead title={t("nav.lists")}>{can("compliance.case.decide") && <Button size="sm" variant="outline" onClick={() => sync.mutate()} loading={sync.isPending}>Sync now</Button>}</PageHead>
      {q.data && (
        <p className="flex flex-wrap gap-x-5 gap-y-1 px-4 pt-4 text-[12.5px] text-steel md:px-6" data-testid="lists-summary">
          <span>{t("lists.versions")}: <b className="num font-semibold text-ink">{q.data.filter((l) => l.status === "ACTIVE").length}</b></span>
          <span>{t("lists.entries")}: <b className="num font-semibold text-ink">{q.data.filter((l) => l.status === "ACTIVE").reduce((n, l) => n + l.entryCount, 0).toLocaleString("en-GB")}</b></span>
          <span>{t("lists.fetched")}: <b className="font-semibold text-ink">{q.data.length ? rel(q.data.map((l) => l.fetchedAt).sort().at(-1)) : "—"}</b></span>
          <span>{t("lists.errors")}: <b className={`num font-semibold ${q.data.some((l) => l.error) ? "text-danger" : "text-ink"}`}>{q.data.filter((l) => l.error).length}</b></span>
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 px-4 pt-4 md:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Ingested versions">
          {q.error ? <TileError error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <ListSkeleton rows={4} className="p-0" /> : !q.data.length ? <EmptyState title="No lists ingested yet." /> : (
            <ListCard className="mx-0"><TableScroll><table className={tableClass} data-testid="lists">
              <thead><tr>{(["pg.c.list", "pg.c.version", "lists.entries", "pg.c.fetched", "pg.c.source", "pg.c.status"] as MsgKey[]).map((h) => <th key={h}>{t(h)}</th>)}</tr></thead>
              <tbody>{q.data.map((l) => <tr key={l.id} className="align-top"><td className="num">{l.listId}</td><td className="num text-[12px]">{l.version.slice(0, 12)}</td><td className="num">{l.entryCount.toLocaleString("en-GB")}</td><td className="whitespace-nowrap text-[12px]">{fmtDateTime(l.fetchedAt)}</td><td className="max-w-56 truncate text-[12px] text-steel" title={l.sourceUrl} dir="ltr">{l.sourceUrl}</td><td><StateChip value={l.status} />{l.error && <span className="block text-[12px] text-danger">{l.error}</span>}</td></tr>)}</tbody>
            </table></TableScroll></ListCard>
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
                <p className="text-[11px] break-words text-steel">Tokens: {res.tokens.map((t) => `${t.token}→${t.phonetic}`).join(" · ")}</p>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}
