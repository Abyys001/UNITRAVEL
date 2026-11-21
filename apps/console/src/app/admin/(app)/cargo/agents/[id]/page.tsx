"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Camera, Printer } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"

import { StatusChip, TileError } from "@/components/bento"
import { TableScroll } from "@/components/case"
import { AgentQrButton } from "@/components/agent-qr"
import { AgentAvatar, AgentDialog, openApiPdf, type AgentRow, imageData, KIND_KEY } from "@/components/cargo-ops"
import { Kpi } from "@/components/kpi"
import { Arrow, Empty, Loading, Panel, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useCrumbLabel } from "@/lib/crumb"
import { fmtDateTime, human } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Profile {
  agent: AgentRow
  performance: { totalJobs: number; completed: number; failed: number; declined: number; open: number; failedAttempts: number; completionRate: number | null; onTimeRate: number | null; averageMinutes: number | null; trackingUpdates: number }
  jobs: { id: string; ref: string; trackingNumber: string | null; cargoStatus: string; kind: "COLLECTION" | "HANDLING" | "DELIVERY"; status: string; assignedAt: string; acceptedAt: string | null; completedAt: string | null; scheduledFor: string | null; attempts: number; declineReason: string | null }[]
  activity: { at: string; action: string; ref: string | null }[]
}

/** ADR-0043: agent profile with photo, details, performance, assigned jobs and activity history. */
export default function AgentProfilePage() {
  const { id } = useParams<{ id: string }>()
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const manage = can("cargo_agent.manage")
  const key = ["cargo-agent", id]
  const q = useQuery({ queryKey: key, queryFn: () => api<Profile>(`/v1/admin/cargo/agents/${id}`) })
  useCrumbLabel(q.data ? `${q.data.agent.agentCode} · ${q.data.agent.displayName}` : null)
  const [editing, setEditing] = useState(false)
  const [photoKey, setPhotoKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const refresh = async () => { await qc.invalidateQueries({ queryKey: key }); await qc.invalidateQueries({ queryKey: ["cargo-agents"] }) }
  if (q.error) return <div className="p-5"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!q.data) return <Loading />
  const { agent: a, performance: p, jobs, activity } = q.data
  const upload = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try { await api(`/v1/admin/cargo/agents/${a.id}/photo`, { body: { filename: file.name, data: await imageData(file) } }); toast.success(t("ops.agents.photoSaved")); await new Promise((r) => setTimeout(r, 1500)); await refresh(); setPhotoKey((k) => k + 1) } catch (e) { toast.error(errText(e)) } finally { setUploading(false) }
  }
  const pct = (v: number | null) => (v == null ? "—" : `${v}%`)
  return (
    <div className="pb-10">
      <div className="px-4 pt-5 md:px-6"><Link href="/cargo/agents" className="inline-flex items-center gap-1 text-meta font-medium text-link"><Arrow back />{t("ops.agents")}</Link></div>
      <header className="flex flex-wrap items-center gap-4 px-4 py-4 md:px-6" data-testid="agent-profile">
        <AgentAvatar key={photoKey} agent={a} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-title font-bold" dir="auto">{a.displayName}</h1>
          <p className="ref text-meta" data-testid="agent-code">{a.agentCode} · <span className="font-sans">{a.agentTypeLabel}</span></p>
          <p className="text-meta text-steel">{t("ops.agents.publicName")}: <span className="font-medium text-ink">{a.publicName}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={a.active ? "ok" : "neutral"}>{a.active ? t("ops.agents.active") : t("ops.agents.inactive")}</StatusChip>
          {manage && <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-rule-strong px-2.5 text-meta font-medium"><Camera className="size-4" aria-hidden />{uploading ? t("ops.loading") : t("ops.agents.photo")}<input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = "" }} disabled={uploading} /></label>}
          {manage && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{t("ops.agents.edit")}</Button>}
          {manage && a.active && <AgentQrButton agentId={a.id} />}
          <Button size="sm" variant="outline" onClick={() => void openApiPdf(`/v1/admin/cargo/agents/${a.id}/manifest.pdf`)} data-testid="agent-runsheet"><Printer className="size-4" aria-hidden />{t("man.pdf")}</Button>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 px-4 md:grid-cols-5 md:px-6" data-testid="agent-kpis">
        <Kpi compact loading={false} label={t("ops.agents.k.total")} value={p.totalJobs} href={null} sub={t("ops.agents.k.open", { n: p.open })} />
        <Kpi compact loading={false} label={t("ops.agents.k.completed")} value={p.completed} href={null} sub={t("ops.agents.k.rate", { v: pct(p.completionRate) })} subTone="ok" />
        <Kpi compact loading={false} label={t("ops.agents.k.failed")} value={p.failed} href={null} sub={t("ops.agents.k.attempts", { n: p.failedAttempts })} tone={p.failed ? "danger" : undefined} />
        <Kpi compact loading={false} label={t("ops.agents.k.declined")} value={p.declined} href={null} />
        <Kpi compact loading={false} label={t("ops.agents.k.updates")} value={p.trackingUpdates} href={null} sub={`${t("ops.agents.k.onTime", { v: pct(p.onTimeRate) })}${p.averageMinutes != null ? ` · ${t("ops.agents.k.avg", { m: p.averageMinutes })}` : ""}`} />
      </div>
      <div className="grid gap-x-8 px-4 pt-2 md:px-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div>
          <Panel title={t("ops.agents.details")}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-meta">
              <dt className="text-steel">{t("ops.edit.email")}</dt><dd dir="ltr">{a.email}</dd>
              <dt className="text-steel">{t("ops.edit.phone")}</dt><dd dir="ltr">{a.phone ?? "—"}</dd>
              <dt className="text-steel">{t("ops.agents.responsibilities")}</dt><dd>{a.responsibilities.map((k) => t(KIND_KEY[k])).join(", ")}</dd>
              <dt className="text-steel">{t("ops.agents.company")}</dt><dd dir="auto">{a.company ?? "—"}</dd>
              <dt className="text-steel">{t("ops.agents.vehicle")}</dt><dd>{a.vehicle ?? "—"}</dd>
              <dt className="text-steel">{t("ops.agents.acceptance")}</dt><dd>{a.requiresAcceptance ? t("ops.agents.mustAccept") : t("ops.agents.direct")}</dd>
              <dt className="text-steel">{t("ops.agents.since")}</dt><dd className="num">{fmtDateTime(a.createdAt)}</dd>
            </dl>
            {a.notes && <p className="mt-2 text-meta" dir="auto">{a.notes}</p>}
          </Panel>
          <Panel title={t("ops.agents.activity")}>
            {!activity.length ? <Empty>{t("ops.agents.noActivity")}</Empty> : <ol className="ledger-rows" data-testid="agent-activity">{activity.slice(0, 40).map((x, i) => <li key={i} className="flex justify-between gap-2 py-1 text-meta"><span>{human(x.action)}{x.ref && <> · <Link className="ref text-link" href={`/cargo/${x.ref}`}>{x.ref}</Link></>}</span><span className="num text-steel">{fmtDateTime(x.at)}</span></li>)}</ol>}
          </Panel>
        </div>
        <Panel title={t("ops.agents.assignments")}>
          {!jobs.length ? <Empty>{t("ops.jobs.none")}</Empty> : (
            <TableScroll><table className="data-table" data-testid="agent-jobs-table">
              <thead><tr><th>{t("ops.c.ref")}</th><th>{t("ops.c.tn")}</th><th>{t("ops.assign.kind")}</th><th>{t("ops.c.status")}</th><th>{t("ops.agents.assignedAt")}</th><th>{t("ops.agents.completedAt")}</th></tr></thead>
              <tbody>{jobs.map((j) => (
                <tr key={j.id}>
                  <td><Link href={`/cargo/${j.ref}`} className="ref text-link hover:underline">{j.ref}</Link></td>
                  <td className="ref" dir="ltr">{j.trackingNumber ?? "—"}</td>
                  <td>{t(KIND_KEY[j.kind])}</td>
                  <td><Tag value={j.status} />{j.declineReason && <span className="block text-caption text-steel">{j.declineReason}</span>}{j.attempts > 0 && <span className="block text-caption text-danger">{t("ops.job.attempts", { n: j.attempts })}</span>}</td>
                  <td className="num text-meta">{fmtDateTime(j.assignedAt)}</td>
                  <td className="num text-meta">{j.completedAt ? fmtDateTime(j.completedAt) : "—"}</td>
                </tr>))}</tbody>
            </table></TableScroll>
          )}
        </Panel>
      </div>
      {editing && <AgentDialog agent={a} onClose={() => setEditing(false)} done={refresh} />}
    </div>
  )
}
