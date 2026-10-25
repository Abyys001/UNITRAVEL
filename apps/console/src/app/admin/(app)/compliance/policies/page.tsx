"use client"

import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import type { PolicyView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { FormDialog } from "@/components/form-dialog"
import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { Chips, ListCard, Pager, tableClass, Toolbar, usePaged } from "@/components/data-list"
import { Field, PageHead, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, human } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

const TYPES = ["CARRIER", "AIRPORT", "COUNTRY_ROUTE", "GOODS_CATEGORY", "KEYWORD", "LANE", "ONLINE_PAYMENT"]
const STATUS_ORDER = ["PENDING_APPROVAL", "ACTIVE", "RETIRED", "REJECTED", "WITHDRAWN"]
const CURRENT = "CURRENT" // active + awaiting approval; the retired, rejected and withdrawn history is one chip away

/** Carrier, airport, route, goods, keyword and lane policies. Officers propose; an owner approves (step-up). */
export default function PoliciesPage() {
  const { can, me } = useSession()
  const t = useT()
  const q = useQuery({ queryKey: ["policies"], queryFn: () => api<PolicyView[]>("/v1/admin/compliance/policies") })
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ type: "CARRIER", key: "", action: "BLOCK", reason: "", counselReference: "" })
  const [type, setType] = useState("")
  const [status, setStatus] = useState(CURRENT)
  const [search, setSearch] = useState("")
  const approve = useAct((id: string) => api(`/v1/admin/compliance/policies/${id}/approve`, { body: {} }), { success: "Policy approved and active", invalidate: [["policies"]] })
  const withdraw = useAct((id: string) => api(`/v1/admin/compliance/policies/${id}/withdraw`, { body: {} }), { success: "Proposal withdrawn", invalidate: [["policies"]] })
  const [rejecting, setRejecting] = useState<PolicyView | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const isOwner = me?.roles.includes("owner")
  const all = q.data ?? []
  const inStatus = useMemo(() => all.filter((p) => status === CURRENT ? p.status === "ACTIVE" || p.status === "PENDING_APPROVAL" : !status || p.status === status), [all, status])
  const matched = useMemo(() => {
    const n = search.trim().toLowerCase()
    return inStatus.filter((p) => !n || p.key.toLowerCase().includes(n) || p.reason.toLowerCase().includes(n))
  }, [inStatus, search])
  const rows = useMemo(() => matched.filter((p) => !type || p.type === type).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.type.localeCompare(b.type) || a.key.localeCompare(b.key)), [matched, type])
  const paged = usePaged(rows)
  const typeCount = (x: string) => matched.filter((p) => p.type === x).length
  const statusCount = (x: string) => all.filter((p) => p.status === x).length
  const cols: MsgKey[] = ["pg.c.type", "pg.c.key", "pg.c.action", "pg.c.reason", "pg.c.version", "pg.c.status", "pg.c.approved"]
  return (
    <div>
      <PageHead title={t("nav.policies")}>
        {can("compliance.case.decide") && <Button size="sm" onClick={() => setOpen(true)}>Propose change</Button>}
      </PageHead>
      <Toolbar query={search} onQuery={setSearch} placeholder={t("pg.pol.search")} count={q.data ? rows.length : undefined} className="pb-1.5">
        <Chips label={t("pg.pol.status")} value={status} options={[{ value: CURRENT, label: t("pg.pol.current"), count: all.filter((p) => p.status === "ACTIVE" || p.status === "PENDING_APPROVAL").length }, ...STATUS_ORDER.filter((x) => statusCount(x)).map((x) => ({ value: x, label: human(x), count: statusCount(x) })), { value: "", label: t("pg.all"), count: all.length }]} onChange={setStatus} />
      </Toolbar>
      <Toolbar className="pt-0">
        <Chips label={t("pg.pol.type")} value={type} options={[{ value: "", label: t("pg.all"), count: matched.length }, ...[...TYPES, ...new Set(all.map((p) => p.type).filter((x) => !TYPES.includes(x)))].filter((x) => typeCount(x)).map((x) => ({ value: x, label: human(x), count: typeCount(x) }))]} onChange={setType} />
      </Toolbar>
      {q.error ? <div className="px-6 py-3"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={6} className="px-6" /> : !rows.length ? <EmptyState title={t("pg.pol.none")} /> : (
        <ListCard>
          <TableScroll><table className={tableClass} data-testid="policies">
            <thead><tr>{cols.map((h) => <th key={h}>{t(h)}</th>)}<th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{paged.rows.map((p) => <tr key={p.id}><td className="whitespace-nowrap">{human(p.type)}</td><td className="num">{p.key}</td><td><StatusChip tone={p.action === "BLOCK" ? "danger" : p.action === "REVIEW" ? "warn" : "ok"}>{human(p.action)}</StatusChip></td><td className="max-w-sm">{p.reason}{p.counselReference && <span className="block text-[12px] text-steel">{t("pg.pol.counsel", { ref: p.counselReference })}</span>}{p.decisionReason && <span className="block text-[12px] text-steel" data-testid="decision-reason">{p.status === "WITHDRAWN" ? "Withdrawn" : "Rejected"}: {p.decisionReason}</span>}</td><td className="num">v{p.version}</td><td><StateChip value={p.status} /></td><td className="whitespace-nowrap text-[12px] text-steel">{p.approvedAt ? fmtDateTime(p.approvedAt) : "—"}</td><td>{p.status === "PENDING_APPROVAL" && (
              <span className="flex items-center gap-1.5">
                {isOwner ? <Button size="xs" onClick={() => approve.mutate(p.id)}>Approve</Button> : <span className="text-[12px] text-steel">{t("pol.pending").toLowerCase()}</span>}
                {isOwner && <Button size="xs" variant="outline" onClick={() => { setRejectReason(""); setRejecting(p) }} data-command="reject_policy">Reject</Button>}
                {me?.id === p.createdBy && <Button size="xs" variant="outline" loading={withdraw.isPending} onClick={() => withdraw.mutate(p.id)} data-command="withdraw_policy">Withdraw</Button>}
              </span>
            )}</td></tr>)}</tbody>
          </table></TableScroll>
          <Pager {...paged} className="border-t border-rule" />
        </ListCard>
      )}
      <FormDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} title="Reject proposal…" description={rejecting ? `${rejecting.type} ${rejecting.key} → ${rejecting.action}. The active policy is not changed.` : undefined} submitLabel="Reject" destructive onSubmit={async () => { await api(`/v1/admin/compliance/policies/${rejecting!.id}/reject`, { body: { reason: rejectReason } }); await q.refetch() }} testId="dlg-reject-policy">
        <Field label="Reason" hint="Recorded in the audit log and shown with the proposal."><textarea className="field-input min-h-20" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} minLength={3} required dir="auto" /></Field>
      </FormDialog>
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
