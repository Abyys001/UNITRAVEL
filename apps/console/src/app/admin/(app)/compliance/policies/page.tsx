"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import type { PolicyView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { FormDialog } from "@/components/form-dialog"
import { Empty, ErrorLine, Field, PageHead, Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useSession } from "@/lib/session"

/** Carrier, airport, route, goods, keyword and lane policies. Officers propose; an owner approves (step-up). */
export default function PoliciesPage() {
  const { can, me } = useSession()
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
        <select aria-label="Type" className="field-input w-44" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All types</option>{["CARRIER", "AIRPORT", "COUNTRY_ROUTE", "GOODS_CATEGORY", "KEYWORD", "LANE"].map((t) => <option key={t}>{t}</option>)}</select>
        {can("compliance.case.decide") && <Button size="sm" onClick={() => setOpen(true)}>Propose change</Button>}
      </PageHead>
      <div className="px-5 py-3">
        <ErrorLine error={q.error} />
        {!q.data ? <p className="text-slate">Loading…</p> : !rows.length ? <Empty>No policies.</Empty> : (
          <table className="w-full bg-white" data-testid="policies">
            <thead className="bg-paper"><tr className="border-b border-rule">{["Type", "Key", "Action", "Reason", "Version", "Status", "Approved", ""].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>{rows.map((p) => <tr key={p.id} className="border-b border-rule/70"><td className="px-2 py-1.5 font-mono text-[11px]">{p.type}</td><td className="num px-2 py-1.5">{p.key}</td><td className="px-2 py-1.5"><Tag value={p.action} className={p.action === "BLOCK" ? "border-brick text-brick" : ""} /></td><td className="max-w-sm px-2 py-1.5">{p.reason}{p.counselReference && <span className="block text-[11px] text-slate">counsel {p.counselReference}</span>}</td><td className="num px-2 py-1.5">v{p.version}</td><td className="px-2 py-1.5"><Tag value={p.status} /></td><td className="px-2 py-1.5 text-[12px] text-slate">{p.approvedAt ? fmtDateTime(p.approvedAt) : "—"}</td><td className="px-2 py-1.5">{p.status === "PENDING_APPROVAL" && (isOwner ? <Button size="xs" onClick={() => approve.mutate(p.id)}>Approve</Button> : <span className="text-[11px] text-slate">awaiting owner</span>)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <FormDialog open={open} onOpenChange={setOpen} title="Propose policy change…" description="Takes effect only after an owner approves it." submitLabel="Propose" onSubmit={async () => { await api("/v1/admin/compliance/policies", { body: { ...f, counselReference: f.counselReference || undefined } }); await q.refetch() }}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type"><select className="field-input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["CARRIER", "AIRPORT", "COUNTRY_ROUTE", "GOODS_CATEGORY", "KEYWORD", "LANE"].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Action"><select className="field-input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>{["BLOCK", "REVIEW", "ALLOW"].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Key" hint="Carrier code, IATA, IR-GB, goods category, keyword…" className="col-span-2"><input className="field-input font-mono" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} required /></Field>
          <Field label="Reason" className="col-span-2"><textarea className="field-input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} minLength={3} required /></Field>
          <Field label="Counsel reference" className="col-span-2"><input className="field-input font-mono" value={f.counselReference} onChange={(e) => setF({ ...f, counselReference: e.target.value })} /></Field>
        </div>
      </FormDialog>
    </div>
  )
}
