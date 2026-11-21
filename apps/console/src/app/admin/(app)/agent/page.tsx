"use client"

import { useQuery } from "@tanstack/react-query"
import { CalendarClock, MapPin, Package, ScanLine, Truck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { buttonVariants } from "@unitravel/ui/components/button"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { AgentAvatar, type AgentJob, type AgentMe, formatTn, KIND_KEY, milestoneTone } from "@/components/cargo-ops"
import { Chips, ListPage } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"

/** ADR-0043: the Agent Dashboard. The agent's own jobs only (the API answers 404 for anything else). Mobile first. */
export default function AgentJobs() {
  const t = useT()
  const [scope, setScope] = useState<"open" | "done">("open")
  const q = useQuery({ queryKey: ["agent-jobs", scope], queryFn: () => api<{ agent: AgentMe; jobs: AgentJob[] }>(`/v1/agent/jobs?scope=${scope}`), refetchInterval: 30_000 })
  return (
    <ListPage>
      <PageHead title={t("agt.title")} />
      <div className="px-4 pb-3 md:px-6"><Link href="/agent/scan" className={buttonVariants({ className: "w-full pointer-coarse:min-h-12 md:w-auto" })} data-testid="agent-scan"><ScanLine className="size-5" aria-hidden />{t("agt.scan")}</Link></div>
      {q.data && (
        <div className="mx-4 mb-3 flex items-center gap-3 rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3 shadow-[var(--tile-shadow)] md:mx-6" data-testid="agent-header">
          <AgentAvatar agent={q.data.agent} size={48} self />
          <div className="min-w-0"><p className="font-semibold" dir="auto">{q.data.agent.displayName}</p><p className="ref text-meta">{q.data.agent.agentCode} · <span className="font-sans text-steel">{q.data.agent.agentTypeLabel}{q.data.agent.vehicle ? ` · ${q.data.agent.vehicle}` : ""}</span></p></div>
        </div>
      )}
      <div className="px-4 pb-3 md:px-6"><Chips label={t("agt.scope")} value={scope} onChange={(v) => setScope((v || "open") as "open" | "done")} options={[{ value: "open", label: t("agt.open") }, { value: "done", label: t("agt.done") }]} /></div>
      {q.error ? <div className="px-4"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={4} className="px-4" /> : !q.data.jobs.length ? <EmptyState title={scope === "open" ? t("agt.none") : t("agt.noneDone")} /> : (
        <ul className="grid gap-3 px-4 pb-8 md:grid-cols-2 md:px-6 xl:grid-cols-3" data-testid="agent-jobs">
          {q.data.jobs.map((j) => {
            const target = j.kind === "DELIVERY" ? j.dropoff : j.pickup
            return (
              <li key={j.assignmentId}>
                <Link href={`/agent/${j.assignmentId}`} className="block rounded-[var(--radius-card)] border border-rule bg-surface-raised p-4 shadow-[var(--tile-shadow)] transition-colors hover:border-control pointer-coarse:active:bg-hover" data-testid="agent-job">
                  <p className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-semibold"><Truck className="size-4 text-orange" aria-hidden />{t(KIND_KEY[j.kind])}{j.status === "OFFERED" && <span className="rounded-full bg-orange/15 px-2 text-caption text-orange-700">{t("agt.offered")}</span>}</span>
                    <StatusChip tone={milestoneTone(j.milestone)}>{j.milestoneLabel}</StatusChip>
                  </p>
                  <p className="ref mt-1 text-meta" dir="ltr">{j.ref}{j.trackingNumber && ` · ${formatTn(j.trackingNumber)}`}</p>
                  <p className="mt-2 flex gap-1.5 text-body"><MapPin className="mt-0.5 size-4 shrink-0 text-steel" aria-hidden /><span><span className="block font-medium" dir="auto">{target.name}</span><span className="text-meta text-steel" dir="auto">{target.address}</span></span></p>
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-meta text-steel">
                    <span className="flex items-center gap-1"><Package className="size-3.5" aria-hidden />{t("ops.c.piecesN", { n: j.pieces, kg: j.weightKg })}</span>
                    {j.scheduledFor && <span className="flex items-center gap-1"><CalendarClock className="size-3.5" aria-hidden />{fmtDateTime(j.scheduledFor)}</span>}
                    {j.attempts > 0 && <span className="text-danger">{t("ops.job.attempts", { n: j.attempts })}</span>}
                  </p>
                  {j.handlingInstructions && <p className="mt-2 rounded-md bg-danger-subtle px-2 py-1 text-meta font-medium text-danger" dir="auto">{j.handlingInstructions}</p>}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </ListPage>
  )
}
