"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { Empty, ErrorLine, PageHead, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"

interface Dead { id: string; queue: string; name: string; failedReason: string; attemptsMade: number; timestamp: string; data: unknown }

/** Dead letters (ch. 16.2 §3): payloads arrive with personal data redacted; retry or discard is audited. */
export default function JobsPage() {
  const q = useQuery({ queryKey: ["dead-letters"], queryFn: () => api<Dead[]>("/v1/dev/queues/dead-letters"), refetchInterval: 15_000 })
  const [open, setOpen] = useState<string | null>(null)
  const retry = useAct((j: Dead) => api(`/v1/dev/jobs/${j.queue}/${encodeURIComponent(j.id)}/retry`, { body: {} }), { success: "Job queued for retry", invalidate: [["dead-letters"]] })
  const discard = useAct((j: Dead) => api(`/v1/dev/jobs/${j.queue}/${encodeURIComponent(j.id)}/discard`, { body: {} }), { success: "Job discarded", invalidate: [["dead-letters"]] })
  return (
    <div>
      <PageHead kicker="Control room" title="Dead letters"><span className="text-slate">{q.data?.length ?? 0} failed jobs</span></PageHead>
      <div className="px-5 py-3">
        <ErrorLine error={q.error} />
        {!q.data ? <p className="text-slate">Loading…</p> : !q.data.length ? <Empty>No failed jobs. Good.</Empty> : (
          <table className="w-full bg-white" data-testid="dead-letters">
            <thead className="bg-paper"><tr className="border-b border-rule">{["Queue", "Job", "Failed", "Attempts", "Reason", ""].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {q.data.map((j) => {
                const k = `${j.queue}/${j.id}`
                return [
                  <tr key={k} className="border-b border-rule/70 align-top">
                    <td className="px-2 py-1.5 font-mono text-[12px]">{j.queue}</td>
                    <td className="px-2 py-1.5 font-mono text-[12px]">{j.name} <span className="text-slate">#{j.id}</span></td>
                    <td className="px-2 py-1.5 text-[12px]">{fmtDateTime(j.timestamp)}</td>
                    <td className="num px-2 py-1.5">{j.attemptsMade}</td>
                    <td className="max-w-md px-2 py-1.5 text-brick">{j.failedReason}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><Button size="xs" variant="ghost" onClick={() => setOpen(open === k ? null : k)}>Payload</Button><Button size="xs" variant="outline" onClick={() => retry.mutate(j)}>Retry</Button> <Button size="xs" variant="ghost" onClick={() => discard.mutate(j)}>Discard</Button></td>
                  </tr>,
                  open === k && <tr key={`${k}-p`}><td colSpan={6} className="bg-ledger px-2 py-2"><pre className="max-h-72 overflow-auto font-mono text-[11px]">{JSON.stringify(j.data, null, 2)}</pre></td></tr>,
                ]
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
