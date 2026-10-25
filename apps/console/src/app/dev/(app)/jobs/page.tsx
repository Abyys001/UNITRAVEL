"use client"

import { useQuery } from "@tanstack/react-query"
import { CheckCircle2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { useConfirm } from "@/components/confirm"
import { Chips, ListCard, Pager, Toolbar, usePaged } from "@/components/data-list"
import { DataTable } from "@/components/dev-ui"
import { PageHead, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"

interface Dead { id: string; queue: string; name: string; failedReason: string; attemptsMade: number; timestamp: string; data: unknown }

/** Dead letters (ch. 16.2 §3): payloads arrive with personal data redacted; retry or discard is audited. */
export default function JobsPage() {
  const q = useQuery({ queryKey: ["dead-letters"], queryFn: () => api<Dead[]>("/v1/dev/queues/dead-letters"), refetchInterval: 15_000 })
  const [open, setOpen] = useState<string | null>(null)
  const [queue, setQueue] = useState("")
  const [text, setText] = useState("")
  const t = useT()
  const { ask, dialog } = useConfirm()
  const retry = useAct((j: Dead) => api(`/v1/dev/jobs/${j.queue}/${encodeURIComponent(j.id)}/retry`, { body: {} }), { success: t("jobs.retried"), invalidate: [["dead-letters"]] })
  const discard = useAct((j: Dead) => api(`/v1/dev/jobs/${j.queue}/${encodeURIComponent(j.id)}/discard`, { body: {} }), { success: t("jobs.discarded"), invalidate: [["dead-letters"]] })
  const all = q.data ?? []
  const queues = useMemo(() => [...new Set(all.map((j) => j.queue))].sort(), [all])
  const rows = useMemo(() => all.filter((j) => (!queue || j.queue === queue) && (!text || `${j.name} ${j.id} ${j.failedReason}`.toLowerCase().includes(text.toLowerCase()))), [all, queue, text])
  const paged = usePaged(rows)
  return (
    <div>
      {dialog}
      <PageHead kicker={t("dnav.control")} title={t("jobs.title")}><span className="text-[12px] text-steel">{t("jobs.desc")}</span></PageHead>
      {q.error ? <div className="p-4 md:p-6"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={6} /> : !all.length ? (
        <ListCard className="mt-4"><EmptyState icon={<CheckCircle2 className="size-4 text-success" />} title={t("jobs.none")} hint={t("jobs.noneHint")} className="py-10" /></ListCard>
      ) : (
        <>
          <Toolbar query={text} onQuery={setText} placeholder={t("jobs.search")} count={rows.length}>
            <Chips label={t("jobs.queue")} value={queue} onChange={setQueue} options={[{ value: "", label: t("list.all"), count: all.length }, ...queues.map((x) => ({ value: x, label: x, count: all.filter((j) => j.queue === x).length }))]} />
          </Toolbar>
          <ListCard>
            {!rows.length ? <EmptyState title={t("list.noMatch")} className="py-8" /> : (
              <DataTable data-testid="dead-letters">
                <thead><tr>{[t("hl.c.queue"), t("jobs.c.job"), t("jobs.c.failed"), t("jobs.c.attempts"), t("jobs.c.reason"), ""].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>
                  {paged.rows.map((j) => {
                    const k = `${j.queue}/${j.id}`
                    return [
                      <tr key={k} className="align-top">
                        <td className="font-medium" dir="ltr">{j.queue}</td>
                        <td dir="ltr"><span className="font-mono text-[12px]">{j.name}</span> <span className="num text-steel">#{j.id}</span></td>
                        <td className="whitespace-nowrap text-[12.5px]">{fmtDateTime(j.timestamp)}</td>
                        <td className="num">{j.attemptsMade}</td>
                        <td className="min-w-48 max-w-md text-danger"><p className="line-clamp-2 break-all" title={j.failedReason}>{j.failedReason}</p></td>
                        <td className="whitespace-nowrap"><Button size="xs" variant="ghost" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>{t("jobs.payload")}</Button><Button size="xs" variant="outline" onClick={() => retry.mutate(j)}>{t("jobs.retry")}</Button> <Button size="xs" variant="ghost" onClick={() => ask({ title: t("confirm.discard.title"), description: t("confirm.discard.body", { job: `${j.name} #${j.id}` }), label: t("confirm.discard.label"), destructive: true, run: () => discard.mutateAsync(j) })}>{t("jobs.discard")}</Button></td>
                      </tr>,
                      open === k && <tr key={`${k}-p`}><td colSpan={6} className="!bg-surface-sunk"><p className="mb-2 break-all whitespace-pre-wrap text-danger" data-testid="full-reason">{j.failedReason}</p><pre className="max-h-72 overflow-auto font-mono text-[11.5px]" dir="ltr">{JSON.stringify(j.data, null, 2)}</pre></td></tr>,
                    ]
                  })}
                </tbody>
              </DataTable>
            )}
            <Pager {...paged} className="border-t border-rule" />
          </ListCard>
        </>
      )}
    </div>
  )
}
