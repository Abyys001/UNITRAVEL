"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { ChevronDown } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { ListCard, Pager, Toolbar, usePaged } from "@/components/data-list"
import { DataTable } from "@/components/dev-ui"
import { Field, PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { type T, useT } from "@/lib/i18n"
import { fmtDateTime } from "@/lib/format"
import type { Page } from "@/lib/types"

const blank = { actor: "", action: "", entityType: "", ref: "", from: "", to: "" }
interface Entry { id: string; occurredAt: string; actor: string | null; actorUserId?: string | null; actorKind: string; action: string; entityType: string; entityId: string | null; contextRef: string | null; before: unknown; after: unknown; ip: string | null; requestId: string | null; hash: string }

interface ChainResult { ok: boolean; checked: number; brokenAt: number | null; verified?: number; legacyUnverifiable?: number }
const chainText = (c: ChainResult, t: T) => !c.ok ? t("aud.chainBroken", { n: c.brokenAt ?? "?", c: c.checked }) : `${t("aud.chainOk", { n: (c.verified ?? c.checked).toLocaleString("en-GB") })}${c.legacyUnverifiable ? ` · ${t("aud.legacy", { n: c.legacyUnverifiable.toLocaleString("en-GB") })}` : ""}`

/** Audit log (ch. 16.2 §8): filter, inspect masked before/after, export CSV (step-up, itself audited), verify the hash chain. */
export default function AuditPage() {
  const t = useT()
  const [draft, setDraft] = useState(blank)
  const [f, setF] = useState(draft)
  const params = (cursor?: string) => { const u = new URLSearchParams({ limit: "100" }); for (const [k, v] of Object.entries(f)) if (v) u.set(k, k === "from" || k === "to" ? new Date(v).toISOString() : v); if (cursor) u.set("cursor", cursor); return u }
  const q = useInfiniteQuery({ queryKey: ["audit", f], queryFn: ({ pageParam }) => api<Page<Entry>>(`/v1/dev/audit-log?${params(pageParam)}`), initialPageParam: undefined as string | undefined, getNextPageParam: (p) => p.nextCursor ?? undefined })
  const rows = q.data?.pages.flatMap((p) => p.items) ?? []
  const [open, setOpen] = useState<string | null>(null)
  const [chain, setChain] = useState<ChainResult | null>(null)
  const verify = async () => {
    try {
      const r = await api<ChainResult>("/v1/dev/audit-log/verify")
      setChain(r)
    } catch (e) { toast.error(errText(e)) }
  }
  const exportCsv = async () => {
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, k === "from" || k === "to" ? new Date(v).toISOString() : v]))
      const blob = await api<Blob>("/v1/dev/audit-log/export", { body, raw: true })
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href)
      toast.success(t("aud.exported"))
    } catch (e) { toast.error(errText(e)) }
  }
  const paged = usePaged(rows)
  const dirty = JSON.stringify(draft) !== JSON.stringify(f)
  const fields: { k: "actor" | "action" | "entityType" | "ref"; label: string; ph: string }[] = [
    { k: "action", label: t("aud.action"), ph: "config.draft_saved" }, { k: "actor", label: t("aud.actor"), ph: t("aud.userId") },
    { k: "entityType", label: t("aud.entity"), ph: "flight_request" }, { k: "ref", label: t("aud.ref"), ph: "UT-F-…" },
  ]
  let day = ""
  return (
    <div>
      <PageHead kicker={t("dpage.platform")} title={t("dpage.audit.title")}>
        <span className="text-[12px] text-steel">{t("aud.desc")}</span>
        <Button size="sm" variant="outline" onClick={() => void verify()}>{t("aud.verify")}</Button>
        <Button size="sm" variant="outline" onClick={() => void exportCsv()}>{t("aud.export")}</Button>
      </PageHead>
      {chain && <p role="status" className={cn("mx-4 mt-4 rounded-lg border px-4 py-2.5 md:mx-6", !chain.ok ? "border-danger/50 bg-danger-subtle text-danger" : chain.legacyUnverifiable ? "border-warning-border bg-warning-subtle text-warning-subtle-fg" : "border-success-border bg-success-subtle text-success-subtle-fg")} data-testid="chain">{chainText(chain, t)}</p>}
      <form className="mx-4 mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-rule bg-surface-raised px-4 py-3 shadow-[var(--tile-shadow)] md:mx-6" onSubmit={(e) => { e.preventDefault(); setF(draft) }}>
        {fields.map(({ k, label, ph }) => <Field key={k} label={label} className="w-44"><input className="field-input" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} placeholder={ph} dir="ltr" /></Field>)}
        <Field label={t("aud.from")} className="w-48"><input type="datetime-local" className="field-input" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></Field>
        <Field label={t("aud.to")} className="w-48"><input type="datetime-local" className="field-input" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></Field>
        <Button size="sm" type="submit" disabled={!dirty}>{t("aud.filter")}</Button>
        {Object.values(f).some(Boolean) && <Button size="sm" type="button" variant="ghost" onClick={() => { setDraft(blank); setF(blank) }}>{t("list.clear")}</Button>}
      </form>
      <Toolbar count={rows.length} className="pt-3" />
      {q.error ? <div className="px-4 md:px-6"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : q.isLoading ? <ListSkeleton rows={8} /> : !rows.length ? <ListCard><EmptyState title={t("aud.none")} hint={t("aud.noneHint")} className="py-10" /></ListCard> : (
        <ListCard>
          <DataTable data-testid="audit">
            <thead><tr>{["#", t("aud.when"), t("aud.actor"), t("aud.action"), t("aud.entity"), t("aud.ref"), ""].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{paged.rows.flatMap((r) => {
              const d = r.occurredAt.slice(0, 10)
              const head = d !== day ? (day = d, <tr key={`d-${r.id}`}><th colSpan={7} scope="colgroup" className="!bg-surface-sunk/60 !py-1.5 !text-ink">{new Date(r.occurredAt).toLocaleDateString(undefined, { dateStyle: "full" })}</th></tr>) : null
              return [head,
                <tr key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className={cn("cursor-pointer", open === r.id && "bg-hover/60")}>
                  <td className="num text-steel">{r.id}</td><td className="num whitespace-nowrap text-[12.5px]">{fmtDateTime(r.occurredAt)}</td>
                  <td className="max-w-44 truncate text-[12.5px]"><span className="font-mono" dir="ltr">{(r.actor ?? r.actorUserId)?.slice(0, 8) ?? "—"}</span> <span className="rounded-full bg-surface-sunk px-1.5 text-[10.5px] text-steel">{r.actorKind.toLowerCase()}</span></td>
                  <td className="font-mono text-[12px] font-medium" dir="ltr">{r.action}</td>
                  <td className="max-w-48 truncate text-[12.5px]" dir="ltr">{r.entityType}{r.entityId && <span className="font-mono text-steel"> {r.entityId.slice(0, 8)}</span>}</td>
                  <td className="num text-[12.5px]" dir="ltr">{r.contextRef ?? ""}</td>
                  <td className="w-10 text-end"><button type="button" aria-expanded={open === r.id} aria-label={t("aud.details", { id: r.id })} onClick={(e) => { e.stopPropagation(); setOpen(open === r.id ? null : r.id) }} className="inline-grid size-8 place-items-center rounded-md text-steel hover:bg-hover hover:text-ink pointer-coarse:size-11"><ChevronDown className={cn("size-4 transition-transform", open === r.id && "rotate-180")} aria-hidden /></button></td>
                </tr>,
                open === r.id && <tr key={`${r.id}-d`}><td colSpan={7} className="!bg-surface-sunk"><div className="grid gap-4 md:grid-cols-2"><div><p className="cap">{t("aud.before")}</p><pre className="mt-1 max-h-60 overflow-auto font-mono text-[11.5px] whitespace-pre-wrap" dir="ltr">{JSON.stringify(r.before, null, 2) ?? "—"}</pre></div><div><p className="cap">{t("aud.after")}</p><pre className="mt-1 max-h-60 overflow-auto font-mono text-[11.5px] whitespace-pre-wrap" dir="ltr">{JSON.stringify(r.after, null, 2) ?? "—"}</pre></div></div><p className="mt-3 font-mono text-[11.5px] break-all text-steel" dir="ltr">IP {r.ip ?? "—"} · request {r.requestId ?? "—"} · hash {r.hash}</p></td></tr>]
            })}</tbody>
          </DataTable>
          <Pager {...paged} className="border-t border-rule" />
          {q.hasNextPage && paged.page >= paged.pages - 1 && <div className="border-t border-rule px-4 py-3 md:px-6"><Button size="sm" variant="outline" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("aud.older")}</Button></div>}
        </ListCard>
      )}
    </div>
  )
}
