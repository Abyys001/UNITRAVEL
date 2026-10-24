"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import type { PolicyView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { FormDialog } from "@/components/form-dialog"
import { BentoGrid, BentoTile, EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { Field, PageHead, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/** Carrier, airport, route, goods, keyword and lane policies. Officers propose; an owner approves (step-up). */
export default function PoliciesPage() {
  const { can, me } = useSession()
  const t = useT()
  const q = useQuery({ queryKey: ["policies"], queryFn: () => api<PolicyView[]>("/v1/admin/compliance/policies") })
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ type: "CARRIER", key: "", action: "BLOCK", reason: "", counselReference: "" })
  const [filter, setFilter] = useState("")
  const approve = useAct((id: string) => api(`/v1/admin/compliance/policies/${id}/approve`, { body: {} }), { success: "Policy approved and active", invalidate: [["policies"]] })
  const isOwner = me?.roles.includes("owner")
  const rows = (q.data ?? []).filter((p) => !filter || p.type === filter)
  return (
    <div>
      <PageHead kicker="Compliance" title="Policies">
        <NativeSelect aria-label="Type" className="field-input w-44" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All types</option>{["CARRIER", "AIRPORT", "COUNTRY_ROUTE", "GOODS_CATEGORY", "KEYWORD", "LANE", "ONLINE_PAYMENT"].map((t) => <option key={t}>{t}</option>)}</NativeSelect>
        {can("compliance.case.decide") && <Button size="sm" onClick={() => setOpen(true)}>Propose change</Button>}
      </PageHead>
      {q.data && (
        <BentoGrid className="px-5 pt-4 pb-2 max-sm:grid-cols-2 max-sm:gap-2" data-testid="case-summary">
          <BentoTile size="s" title={t("pol.active")}><p className="num text-[22px] leading-tight font-semibold">{q.data.filter((p) => p.status === "ACTIVE").length}</p></BentoTile>
          <BentoTile size="s" title={t("pol.pending")} tone={q.data.some((p) => p.status === "PENDING_APPROVAL") ? "hero" : "default"}><p className="num text-[22px] leading-tight font-semibold">{q.data.filter((p) => p.status === "PENDING_APPROVAL").length}</p></BentoTile>
          <BentoTile size="s" title={t("pol.block")}><p className="num text-[22px] leading-tight font-semibold">{q.data.filter((p) => p.status === "ACTIVE" && p.action === "BLOCK").length}</p></BentoTile>
        </BentoGrid>
      )}
      <div className="px-5 py-3">
        {q.error ? <TileError message={errText(q.error)} onRetry={() => void q.refetch()} /> : !q.data ? <ListSkeleton rows={6} className="p-0" /> : !rows.length ? <EmptyState title="No policies." /> : (
          <TableScroll><table className="w-full bg-surface-raised" data-testid="policies">
            <thead className="bg-surface-raised"><tr className="border-b border-rule">{["Type", "Key", "Action", "Reason", "Version", "Status", "Approved", ""].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>{rows.map((p) => <tr key={p.id} className="border-b border-rule/70"><td className="px-2 py-1.5 font-mono text-[11px]">{p.type}</td><td className="num px-2 py-1.5">{p.key}</td><td className="px-2 py-1.5"><StatusChip tone={p.action === "BLOCK" ? "danger" : p.action === "REVIEW" ? "warn" : "ok"} className="font-mono text-[10.5px] uppercase">{p.action}</StatusChip></td><td className="max-w-sm px-2 py-1.5">{p.reason}{p.counselReference && <span className="block text-[11px] text-steel">counsel {p.counselReference}</span>}</td><td className="num px-2 py-1.5">v{p.version}</td><td className="px-2 py-1.5"><StateChip value={p.status} /></td><td className="px-2 py-1.5 text-[12px] text-steel">{p.approvedAt ? fmtDateTime(p.approvedAt) : "—"}</td><td className="px-2 py-1.5">{p.status === "PENDING_APPROVAL" && (isOwner ? <Button size="xs" onClick={() => approve.mutate(p.id)}>Approve</Button> : <span className="text-[11px] text-steel">awaiting owner</span>)}</td></tr>)}</tbody>
          </table></TableScroll>
        )}
      </div>
      <FormDialog open={open} onOpenChange={setOpen} title="Propose policy change…" description="Takes effect only after an owner approves it." submitLabel="Propose" onSubmit={async () => { await api("/v1/admin/compliance/policies", { body: { ...f, counselReference: f.counselReference || undefined } }); await q.refetch() }}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type"><NativeSelect className="field-input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["CARRIER", "AIRPORT", "COUNTRY_ROUTE", "GOODS_CATEGORY", "KEYWORD", "LANE", "ONLINE_PAYMENT"].map((t) => <option key={t}>{t}</option>)}</NativeSelect></Field>
          <Field label="Action"><NativeSelect className="field-input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>{["BLOCK", "REVIEW", "ALLOW"].map((t) => <option key={t}>{t}</option>)}</NativeSelect></Field>
          <Field label="Key" hint="Carrier code, IATA, IR-GB, goods category, keyword…" className="col-span-2"><input className="field-input font-mono" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} required /></Field>
          <Field label="Reason" className="col-span-2"><textarea className="field-input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} minLength={3} required /></Field>
          <Field label="Counsel reference" className="col-span-2"><input className="field-input font-mono" value={f.counselReference} onChange={(e) => setF({ ...f, counselReference: e.target.value })} /></Field>
        </div>
      </FormDialog>
    </div>
  )
}
