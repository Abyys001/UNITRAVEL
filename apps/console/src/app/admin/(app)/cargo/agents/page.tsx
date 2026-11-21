"use client"

import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { AgentAvatar, AgentDialog, type AgentRow, KIND_KEY, useAgents } from "@/components/cargo-ops"
import { Chips, ListCard, ListPage, tableClass, Toolbar } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/** ADR-0043: Agent Management. Creating an agent grants exactly the `agent` role to the account with that email. */
export default function AgentsPage() {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const manage = can("cargo_agent.manage")
  const q = useAgents()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<"" | "active" | "inactive">("active")
  const [editing, setEditing] = useState<AgentRow | "new" | null>(null)
  const rows = (q.data ?? []).filter((a) => (!status || a.active === (status === "active")) && (!search || `${a.agentCode} ${a.displayName} ${a.email} ${a.vehicle ?? ""} ${a.agentTypeLabel} ${a.company ?? ""}`.toLowerCase().includes(search.toLowerCase())))
  const refresh = () => qc.invalidateQueries({ queryKey: ["cargo-agents"] })
  const toggle = async (a: AgentRow) => {
    try { await api(`/v1/admin/cargo/agents/${a.id}`, { method: "PATCH", body: { active: !a.active } }); toast.success(a.active ? t("ops.agents.deactivated") : t("ops.agents.activated")); await refresh() } catch (e) { toast.error(errText(e)) }
  }
  const cols: MsgKey[] = ["ops.agents.name", "ops.agents.type", "ops.agents.responsibilities", "ops.agents.contact", "ops.agents.jobs", "ops.c.status"]
  return (
    <ListPage>
      <PageHead title={t("ops.agents")} kicker={t("nav.cargo")}>{manage && <Button size="sm" onClick={() => setEditing("new")} data-testid="new-agent">{t("ops.agents.new")}</Button>}</PageHead>
      <p className="max-w-3xl px-4 pb-3 text-meta text-steel md:px-6">{t("ops.agents.intro")}</p>
      <Toolbar query={search} onQuery={setSearch} placeholder={t("ops.agents.search")} count={q.data ? rows.length : undefined}>
        <Chips label={t("ops.c.status")} value={status} onChange={(v) => setStatus(v as typeof status)} options={[{ value: "active", label: t("ops.agents.active") }, { value: "inactive", label: t("ops.agents.inactive") }, { value: "", label: t("ops.tab.all") }]} />
      </Toolbar>
      {q.error ? <div className="px-6"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={4} className="px-6" /> : !rows.length ? <EmptyState title={t("ops.agents.none")} /> : (
        <>
          <ul className="space-y-2 px-4 md:hidden" data-testid="agent-cards">{rows.map((a) => (
            <li key={a.id}><Link href={`/cargo/agents/${a.id}`} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)]">
              <AgentAvatar agent={a} />
              <span className="min-w-0 flex-1"><span className="block font-medium" dir="auto">{a.displayName} <span className="ref text-caption text-steel">{a.agentCode}</span></span><span className="block text-meta text-steel">{a.agentTypeLabel} · {a.responsibilities.map((k) => t(KIND_KEY[k])).join(", ")}</span><span className="block text-meta">{t("ops.agents.jobsN", { open: a.activeJobs + a.offeredJobs, done: a.completedJobs })}</span></span>
              <StatusChip tone={a.active ? "ok" : "neutral"}>{a.active ? t("ops.agents.active") : t("ops.agents.inactive")}</StatusChip>
            </Link></li>))}</ul>
          <ListCard fill className="hidden md:flex">
            <TableScroll><table className={tableClass} data-testid="agents-table">
              <thead><tr>{cols.map((c) => <th key={c}>{t(c)}</th>)}{manage && <th />}</tr></thead>
              <tbody>{rows.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/cargo/agents/${a.id}`} className="flex items-center gap-2.5 hover:underline"><AgentAvatar agent={a} size={32} /><span><span className="block font-medium" dir="auto">{a.displayName}</span><span className="ref text-caption text-steel">{a.agentCode} · {a.publicName}</span></span></Link></td>
                  <td>{a.agentTypeLabel}{a.company && <span className="block text-caption text-steel">{a.company}</span>}{a.vehicle && <span className="block text-caption text-steel">{a.vehicle}</span>}</td>
                  <td className="text-meta">{a.responsibilities.map((k) => t(KIND_KEY[k])).join(", ")}{a.requiresAcceptance && <span className="block text-caption text-steel">{t("ops.agents.mustAccept")}</span>}</td>
                  <td dir="ltr" className="text-meta">{a.email}{a.phone && <span className="block text-steel">{a.phone}</span>}</td>
                  <td className="num">{t("ops.agents.jobsN", { open: a.activeJobs + a.offeredJobs, done: a.completedJobs })}{a.failedJobs > 0 && <span className="block text-caption text-danger">{t("ops.agents.failedN", { n: a.failedJobs })}</span>}</td>
                  <td><StatusChip tone={a.active ? "ok" : "neutral"}>{a.active ? t("ops.agents.active") : t("ops.agents.inactive")}</StatusChip></td>
                  {manage && <td className="whitespace-nowrap text-end"><Button size="xs" variant="ghost" onClick={() => setEditing(a)}>{t("ops.agents.edit")}</Button><Button size="xs" variant="ghost" onClick={() => void toggle(a)}>{a.active ? t("ops.agents.deactivate") : t("ops.agents.activate")}</Button></td>}
                </tr>))}</tbody>
            </table></TableScroll>
          </ListCard>
        </>
      )}
      <AgentDialog agent={editing} onClose={() => setEditing(null)} done={refresh} />
    </ListPage>
  )
}
