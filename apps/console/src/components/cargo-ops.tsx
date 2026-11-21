"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileText, Nfc, Printer, Tag as TagIcon, Truck, UserPlus, X } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { FAILURE_REASON_LABELS, LABEL_FORMATS } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { StatusChip } from "@/components/bento"
import { FormDialog, useDialogs } from "@/components/form-dialog"
import { Empty, Field, Panel, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, human } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { nfcSupported, writeNfc } from "@/lib/nfc"
import { useSession } from "@/lib/session"

type Party = { name: string; company?: string; phone: string; email?: string; address: { line1: string; line2?: string; city: string; postcode?: string; country: string } }
export interface CargoOps {
  ref: string; trackingNumber: string | null; trackingUrl: string | null; labelUrl: string | null; trackingNumberIssuedAt: string | null; milestone: string; milestoneLabel: string
  preferredDeliveryDate: string | null; handlingInstructions: string | null; handoverMode: string; shipper: Party; consignee: Party; readyDate: string; failedAttempts: number
  assignments: { id: string; kind: AgentKind; status: string; agentId: string; agentCode: string; agentName: string; agentPublicName: string; scheduledFor: string | null; attempts: number; note: string | null; assignedAt: string; acceptedAt: string | null; completedAt: string | null; cancelReason: string | null; declineReason: string | null }[]
  labels: { id: string; documentId: string; format: string; pieces: number; createdAt: string; createdBy: string; voidedAt: string | null }[]
  proofs: { id: string; kind: string; receiverName: string | null; location: string; capturedAt: string; capturedBy: string; note: string | null; signatureDocumentId: string | null; photoDocumentIds: string[] }[]
  notifications: NoticeRow[]
}
export interface NoticeRow { id: string; ref: string; trackingNumber: string | null; key: string; milestone: string; eventType: string; createdAt: string; customerName: string; inbox: boolean; email: { status: string; destination: string | null; sentAt: string | null; error: string | null } | null; sms: string | null }
export type AgentKind = "COLLECTION" | "HANDLING" | "DELIVERY"
export const AGENT_KINDS: AgentKind[] = ["COLLECTION", "HANDLING", "DELIVERY"]
export const AGENT_TYPES = ["DRIVER", "COURIER", "COLLECTION_AGENT", "DELIVERY_AGENT", "LOGISTICS_REPRESENTATIVE", "OTHER"] as const
export interface AgentRow {
  id: string; agentCode: string; userId: string; displayName: string; publicName: string; customPublicName: string | null; email: string; phone: string | null; agentType: string; agentTypeLabel: string
  responsibilities: AgentKind[]; company: string | null; vehicle: string | null; notes: string | null; active: boolean; requiresAcceptance: boolean; hasPhoto: boolean
  offeredJobs: number; activeJobs: number; completedJobs: number; failedJobs: number; createdAt: string
}

/** Milestone colours shared by the list, the request page and the Agent Dashboard. */
export const milestoneTone = (m: string): "ok" | "danger" | "warn" | "info" | "neutral" =>
  m === "DELIVERED" ? "ok" : ["DELIVERY_FAILED", "COLLECTION_FAILED", "RETURNED_TO_SENDER"].includes(m) ? "danger" : ["ON_HOLD", "CANCELLED"].includes(m) ? "warn" : m === "REQUEST_RECEIVED" ? "neutral" : "info"

/** Opens a PDF the API streams (run sheet, customs form). The tab opens first, so Safari does not block it as a pop-up. */
export const openApiPdf = async (path: string) => {
  const w = window.open("", "_blank")
  try {
    const blob = await api<Blob>(path, { raw: true })
    const url = URL.createObjectURL(blob)
    if (w) w.location.href = url; else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) { w?.close(); toast.error(errText(e)) }
}

export const openDocument = async (id: string) => {
  try { const r = await api<{ url: string }>(`/v1/documents/${id}/download`); window.open(r.url, "_blank", "noopener") } catch (e) { toast.error(errText(e)) }
}

export const formatTn = (n: string) => `${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6, 10)} ${n.slice(10)}`
const localNow = (plusMin = 0) => { const d = new Date(Date.now() + plusMin * 60_000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

export function useAgents(enabled = true) {
  return useQuery({ queryKey: ["cargo-agents"], queryFn: () => api<AgentRow[]>("/v1/admin/cargo/agents"), enabled })
}

/** ADR-0042/0043: tracking number, labels, agent assignments, proof and notices for one shipment (request page, Records pane). */
export function OperationsPanel({ cargoRef, status, onChanged }: { cargoRef: string; status: string; onChanged: () => Promise<void> }) {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const write = can("cargo_request.transition")
  const key = ["cargo-ops", cargoRef]
  const q = useQuery({ queryKey: key, queryFn: () => api<CargoOps>(`/v1/admin/cargo/requests/${cargoRef}/operations`) })
  const customs = useQuery({ queryKey: ["cargo-customs", cargoRef], queryFn: () => api<{ form: "CN22" | "CN23"; items: number; missingHsCodes: string[] }>(`/v1/admin/cargo/requests/${cargoRef}/customs`) })
  const [nfc, setNfc] = useState(false)
  useEffect(() => { setNfc(nfcSupported()) }, [])
  const dlg = useDialogs<"label" | "assign" | "edit" | "proof">()
  const [busy, setBusy] = useState(false)
  const refresh = async () => { await qc.invalidateQueries({ queryKey: key }); await onChanged() }
  useEffect(() => { void qc.invalidateQueries({ queryKey: key }) }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  const o = q.data
  if (!o) return <Panel title={t("ops.title")}><Empty>{q.error ? errText(q.error) : t("ops.loading")}</Empty></Panel>
  const issue = async () => { setBusy(true); try { await api(`/v1/admin/cargo/requests/${cargoRef}/tracking-number`, { body: {} }); toast.success(t("ops.tn.issued")); await refresh() } catch (e) { toast.error(errText(e)) } finally { setBusy(false) } }
  const cancel = async (id: string) => {
    const reason = window.prompt(t("ops.job.cancelReason"))
    if (!reason || reason.trim().length < 3) return
    try { await api(`/v1/admin/cargo/requests/${cargoRef}/assignments/${id}/cancel`, { body: { reason } }); toast.success(t("ops.job.cancelled")); await refresh() } catch (e) { toast.error(errText(e)) }
  }
  const confirmed = !["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "EXPIRED", "CANCELLED", "DECLINED"].includes(status)
  const activeLabel = o.labels.find((l) => !l.voidedAt)
  const writeTag = async () => {
    if (!o.labelUrl) return
    const id = toast.loading(t("nfc.writing"))
    try { await writeNfc(o.labelUrl); toast.success(t("nfc.written"), { id }) } catch (e) { toast.error(t("nfc.failed", { msg: e instanceof Error ? e.message : String(e) }), { id }) }
  }
  const open = o.assignments.filter((a) => a.status === "ASSIGNED" || a.status === "OFFERED")
  return (
    <>
      <Panel title={t("ops.title")} aside={write && <Button size="xs" variant="outline" onClick={() => dlg.open("edit")} data-testid="ops-edit">{t("ops.edit")}</Button>}>
        <div className="space-y-3" data-testid="ops-panel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-meta text-steel">{t("ops.milestone")}</span>
            <StatusChip tone={milestoneTone(o.milestone)} className="font-semibold"><span data-testid="ops-milestone">{o.milestoneLabel}</span></StatusChip>
          </div>
          <div className="rounded-lg border border-rule bg-surface-sunk p-3">
            <p className="text-meta text-steel">{t("ops.tn")}</p>
            {o.trackingNumber ? (
              <>
                <p className="ref mt-0.5 text-lead font-semibold" dir="ltr" data-testid="ops-tn">{formatTn(o.trackingNumber)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="xs" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(o.trackingNumber!); toast.success(t("ops.copied")) }}><Copy className="size-3.5" />{t("ops.copy")}</Button>
                  {o.trackingUrl && <a className="inline-flex items-center gap-1 text-caption font-medium text-link hover:underline" href={o.trackingUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3.5" />{t("ops.publicPage")}</a>}
                </div>
              </>
            ) : (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-steel">{confirmed ? t("ops.tn.none") : t("ops.tn.later")}</span>
                {write && confirmed && <Button size="xs" onClick={() => void issue()} loading={busy} data-testid="ops-issue">{t("ops.tn.issue")}</Button>}
              </div>
            )}
          </div>
          {(o.preferredDeliveryDate || o.handlingInstructions) && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta">
              {o.preferredDeliveryDate && <><dt className="text-steel">{t("ops.preferred")}</dt><dd className="num">{o.preferredDeliveryDate}</dd></>}
              {o.handlingInstructions && <><dt className="text-steel">{t("ops.handling")}</dt><dd className="font-medium text-danger" dir="auto">{o.handlingInstructions}</dd></>}
            </dl>
          )}
        </div>
      </Panel>

      <Panel title={t("ops.labels")} aside={<div className="flex flex-wrap justify-end gap-1.5">
        {customs.data && customs.data.items > 0 && <Button size="xs" variant="outline" onClick={() => void openApiPdf(`/v1/admin/cargo/requests/${cargoRef}/customs.pdf`)} data-testid="ops-customs"><FileText className="size-3.5" />{t("cust.make", { form: customs.data.form })}</Button>}
        {nfc && o.labelUrl && <Button size="xs" variant="outline" onClick={() => void writeTag()} data-testid="ops-nfc"><Nfc className="size-3.5" />{t("nfc.write")}</Button>}
        {write && o.trackingNumber && <Button size="xs" variant="outline" onClick={() => dlg.open("label")} data-testid="ops-label"><Printer className="size-3.5" />{activeLabel ? t("ops.label.again") : t("ops.label.make")}</Button>}
      </div>}>
        {customs.data && customs.data.missingHsCodes.length > 0 && <p className="mb-2 rounded-md bg-warning-subtle px-2 py-1.5 text-meta text-warning-subtle-fg" data-testid="ops-customs-hs">{t("cust.missingHs", { items: customs.data.missingHsCodes.join(", ") })}</p>}
        {!o.trackingNumber ? <Empty>{t("ops.label.needTn")}</Empty> : !o.labels.length ? <Empty>{t("ops.label.none")}</Empty> : (
          <ul className="ledger-rows" data-testid="ops-labels">{o.labels.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 py-1">
              <span className={l.voidedAt ? "text-steel line-through" : ""}><TagIcon className="me-1 inline size-3.5 align-[-2px]" aria-hidden />{l.format} · {t("ops.label.pieces", { n: l.pieces })} · <span className="num">{fmtDateTime(l.createdAt)}</span> <span className="text-steel">· {l.createdBy}</span></span>
              <Button size="xs" variant="ghost" onClick={() => void openDocument(l.documentId)} aria-label={t("ops.download")}><Download className="size-3.5" /></Button>
            </li>))}</ul>
        )}
      </Panel>

      <Panel title={t("ops.jobs")} aside={write && <Button size="xs" variant="outline" onClick={() => dlg.open("assign")} data-testid="ops-assign"><UserPlus className="size-3.5" />{t("ops.assign")}</Button>}>
        {o.failedAttempts > 0 && <p className="mb-2 rounded-md bg-danger-subtle px-2 py-1.5 text-meta text-danger">{t("ops.failedAttempts", { n: o.failedAttempts })}</p>}
        {!o.assignments.length ? <Empty>{t("ops.jobs.none")}</Empty> : (
          <ul className="ledger-rows" data-testid="ops-jobs">{o.assignments.map((a) => (
            <li key={a.id} className="py-1.5">
              <p className="flex items-center justify-between gap-2"><span className="font-medium"><Truck className="me-1 inline size-3.5 align-[-2px]" aria-hidden />{t(KIND_KEY[a.kind])} · <Link href={`/cargo/agents/${a.agentId}`} className="text-link hover:underline">{a.agentName}</Link> <span className="ref text-caption text-steel">{a.agentCode}</span></span><Tag value={a.status} /></p>
              <p className="text-caption text-steel">{t("ops.job.assigned", { at: fmtDateTime(a.assignedAt) })}{a.scheduledFor && ` · ${t("ops.job.planned", { at: fmtDateTime(a.scheduledFor) })}`}{a.attempts > 0 && ` · ${t("ops.job.attempts", { n: a.attempts })}`}{a.cancelReason && ` · ${a.cancelReason}`}{a.declineReason && ` · ${t("ops.job.declined", { reason: a.declineReason })}`}</p>
              {write && (a.status === "ASSIGNED" || a.status === "OFFERED") && <button type="button" className="text-caption font-medium text-link hover:underline" onClick={() => void cancel(a.id)}>{t("ops.job.cancel")}</button>}
            </li>))}</ul>
        )}
        {open.length === 0 && o.assignments.some((a) => a.status === "FAILED") && <p className="mt-2 text-caption text-steel">{t("ops.job.failedHint")}</p>}
      </Panel>

      <Panel title={t("ops.proof")} aside={write && <Button size="xs" variant="outline" onClick={() => dlg.open("proof")}>{t("ops.proof.add")}</Button>}>
        {!o.proofs.length ? <Empty>{t("ops.proof.none")}</Empty> : (
          <ul className="ledger-rows" data-testid="ops-proofs">{o.proofs.map((p) => (
            <li key={p.id} className="py-1.5">
              <p className="flex justify-between gap-2"><span className="font-medium">{t(KIND_KEY[p.kind as AgentKind] ?? "ops.kind.delivery")}{p.receiverName && <> · <span dir="auto">{p.receiverName}</span></>}</span><span className="num text-meta text-steel">{fmtDateTime(p.capturedAt)}</span></p>
              <p className="text-caption text-steel">{p.location} · {p.capturedBy}{p.note && <> · <span dir="auto">{p.note}</span></>}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {p.signatureDocumentId && <button type="button" className="text-caption font-medium text-link hover:underline" onClick={() => void openDocument(p.signatureDocumentId!)}>{t("ops.proof.signature")}</button>}
                {p.photoDocumentIds.map((id, i) => <button key={id} type="button" className="text-caption font-medium text-link hover:underline" onClick={() => void openDocument(id)}>{t("ops.proof.photo", { n: i + 1 })}</button>)}
              </div>
            </li>))}</ul>
        )}
      </Panel>

      <Panel title={t("ops.notices")}>
        {!o.notifications.length ? <Empty>{t("ops.notices.none")}</Empty> : <NoticeList rows={o.notifications} compact />}
      </Panel>

      <LabelDialog {...dlg.bind("label")} cargoRef={cargoRef} done={refresh} />
      <AssignDialog {...dlg.bind("assign")} ops={o} status={status} done={refresh} />
      <EditDetailsDialog {...dlg.bind("edit")} ops={o} done={refresh} />
      <ProofDialog {...dlg.bind("proof")} cargoRef={cargoRef} done={refresh} />
    </>
  )
}

export function NoticeList({ rows, compact = false }: { rows: NoticeRow[]; compact?: boolean }) {
  const t = useT()
  const tone = (s?: string | null) => (s === "SENT" || s === "DELIVERED" ? "ok" : s === "FAILED" || s === "UNDELIVERABLE" ? "danger" : "neutral")
  return (
    <ul className="ledger-rows" data-testid="notice-list">{rows.map((n) => (
      <li key={n.id} className="py-1.5">
        <p className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{human(n.key.split(":")[0]!)}{!compact && <> · <span className="ref">{n.ref}</span></>}</span>
          <span className="flex flex-wrap gap-1">
            <StatusChip tone={tone(n.email?.status)}>{t("ops.n.email")}: {n.email ? human(n.email.status) : t("ops.n.noEmail")}</StatusChip>
            {n.sms && <StatusChip tone={tone(n.sms)}>SMS: {human(n.sms)}</StatusChip>}
          </span>
        </p>
        <p className="text-caption text-steel"><span className="num">{fmtDateTime(n.createdAt)}</span>{!compact && <> · <span dir="auto">{n.customerName}</span></>}{n.email?.destination && ` · ${n.email.destination}`}{n.email?.error && <span className="text-danger"> · {n.email.error}</span>}</p>
      </li>))}</ul>
  )
}

function LabelDialog({ open, onOpenChange, cargoRef, done }: { open: boolean; onOpenChange: (o: boolean) => void; cargoRef: string; done: () => Promise<void> }) {
  const t = useT()
  const [format, setFormat] = useState<string>("4x6")
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("ops.label.title")} submitLabel={t("ops.label.generate")} testId="dlg-label" description={t("ops.label.desc")}
      onSubmit={async () => { const r = await api<{ url: string }>(`/v1/admin/cargo/requests/${cargoRef}/labels`, { body: { format } }); window.open(r.url, "_blank", "noopener"); await done() }}>
      <Field label={t("ops.label.format")}>
        <NativeSelect className="field-input" value={format} onChange={(e) => setFormat(e.target.value)} data-testid="label-format">
          {LABEL_FORMATS.map((f) => <option key={f} value={f}>{t(`ops.label.f.${f}` as never)}</option>)}
        </NativeSelect>
      </Field>
    </FormDialog>
  )
}

export const KIND_KEY: Record<AgentKind, "ops.kind.collection" | "ops.kind.handling" | "ops.kind.delivery"> = { COLLECTION: "ops.kind.collection", HANDLING: "ops.kind.handling", DELIVERY: "ops.kind.delivery" }

/** ADR-0043: one or several agents for one kind of job; only agents with that responsibility are offered. */
function AssignDialog({ open, onOpenChange, ops, status, done }: { open: boolean; onOpenChange: (o: boolean) => void; ops: CargoOps; status: string; done: () => Promise<void> }) {
  const t = useT()
  const agents = useAgents(open)
  const kindFor = (): AgentKind => (["BOOKED", "AWAITING_HANDOVER"].includes(status) ? "COLLECTION" : "DELIVERY")
  const [f, setF] = useState({ kind: kindFor() as AgentKind, scheduledFor: "", location: "", note: "" })
  const [picked, setPicked] = useState<string[]>([])
  const placeFor = (k: AgentKind) => (k === "DELIVERY" ? ops.consignee.address.city : ops.shipper.address.city)
  useEffect(() => {
    if (open) { const k = kindFor(); setF({ kind: k, scheduledFor: k === "COLLECTION" ? localNow(120) : "", location: placeFor(k), note: "" }); setPicked([]) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const eligible = (agents.data ?? []).filter((a) => a.active && a.responsibilities.includes(f.kind))
  const busy = new Set(ops.assignments.filter((a) => a.kind === f.kind && (a.status === "ASSIGNED" || a.status === "OFFERED")).map((a) => a.agentId))
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("ops.assign.title")} submitLabel={t("ops.assign")} testId="dlg-assign" description={t("ops.assign.desc")}
      onSubmit={async () => {
        if (!picked.length) throw new Error(t("ops.assign.pickOne"))
        await api(`/v1/admin/cargo/requests/${ops.ref}/assignments`, { body: { agentIds: picked, kind: f.kind, location: f.location, note: f.note || undefined, scheduledFor: f.scheduledFor ? new Date(f.scheduledFor).toISOString() : undefined } })
        await done()
      }}>
      <Field label={t("ops.assign.kind")}>
        <NativeSelect className="field-input" value={f.kind} onChange={(e) => { const k = e.target.value as AgentKind; setF({ ...f, kind: k, location: placeFor(k) }); setPicked([]) }} data-testid="assign-kind">
          {AGENT_KINDS.map((k) => <option key={k} value={k}>{t(KIND_KEY[k])}</option>)}
        </NativeSelect>
      </Field>
      <fieldset>
        <legend className="mb-1 text-meta font-medium">{t("ops.assign.agents")}</legend>
        {!eligible.length && agents.data && <p className="text-meta text-steel">{t("ops.assign.noAgents")}</p>}
        <ul className="max-h-56 space-y-1 overflow-y-auto" data-testid="assign-agents">{eligible.map((a) => (
          <li key={a.id}><label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover pointer-coarse:min-h-11">
            <input type="checkbox" className="size-4 accent-orange" disabled={busy.has(a.id)} checked={picked.includes(a.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))} />
            <AgentAvatar agent={a} size={28} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium" dir="auto">{a.displayName} <span className="ref text-caption text-steel">{a.agentCode}</span></span><span className="block text-caption text-steel">{a.agentTypeLabel}{a.vehicle ? ` · ${a.vehicle}` : ""} · {t("ops.agents.open", { n: a.activeJobs })}{a.requiresAcceptance ? ` · ${t("ops.agents.mustAccept")}` : ""}{busy.has(a.id) ? ` · ${t("ops.assign.already")}` : ""}</span></span>
          </label></li>))}</ul>
      </fieldset>
      {f.kind === "COLLECTION" && <Field label={t("ops.assign.when")}><input type="datetime-local" className="field-input" value={f.scheduledFor} onChange={(e) => setF({ ...f, scheduledFor: e.target.value })} /></Field>}
      <Field label={t("ops.assign.place")} hint={t("ops.placeHint")}><input className="field-input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} required minLength={2} maxLength={120} /></Field>
      <Field label={t("ops.assign.note")}><textarea className="field-input min-h-16" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} dir="auto" /></Field>
    </FormDialog>
  )
}

/** The agent's photo (served by the API on the console origin) or their initials. */
export function AgentAvatar({ agent, size = 40, self = false }: { agent: { id?: string; displayName: string; hasPhoto: boolean }; size?: number; self?: boolean }) {
  const [failed, setFailed] = useState(false)
  const initials = agent.displayName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")
  const src = self ? "/api/v1/agent/me/photo" : `/api/v1/admin/cargo/agents/${agent.id}/photo`
  return agent.hasPhoto && !failed
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)} className="shrink-0 rounded-full border border-rule object-cover" style={{ width: size, height: size }} />
    : <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-navy-900 font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials}</span>
}

function EditDetailsDialog({ open, onOpenChange, ops, done }: { open: boolean; onOpenChange: (o: boolean) => void; ops: CargoOps; done: () => Promise<void> }) {
  const t = useT()
  const init = () => ({
    sLine1: ops.shipper.address.line1, sCity: ops.shipper.address.city, sPost: ops.shipper.address.postcode ?? "", sPhone: ops.shipper.phone, sEmail: ops.shipper.email ?? "",
    cLine1: ops.consignee.address.line1, cCity: ops.consignee.address.city, cPost: ops.consignee.address.postcode ?? "", cPhone: ops.consignee.phone, cEmail: ops.consignee.email ?? "",
    readyDate: ops.readyDate, preferred: ops.preferredDeliveryDate ?? "", handling: ops.handlingInstructions ?? "", reason: "",
  })
  const [f, setF] = useState(init)
  useEffect(() => { if (open) setF(init()) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const inp = (k: keyof ReturnType<typeof init>, label: string, type = "text", ltr = false) => <Field label={label}><input type={type} className="field-input" dir={ltr ? "ltr" : "auto"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} wide title={t("ops.edit.title")} submitLabel={t("common.save")} testId="dlg-edit" description={t("ops.edit.desc")}
      onSubmit={async () => {
        await api(`/v1/admin/cargo/requests/${ops.ref}/details`, { method: "PATCH", body: {
          shipper: { address: { line1: f.sLine1, line2: ops.shipper.address.line2, city: f.sCity, postcode: f.sPost || undefined }, phone: f.sPhone, email: f.sEmail },
          consignee: { address: { line1: f.cLine1, line2: ops.consignee.address.line2, city: f.cCity, postcode: f.cPost || undefined }, phone: f.cPhone, email: f.cEmail },
          readyDate: f.readyDate, preferredDeliveryDate: f.preferred || null, handlingInstructions: f.handling || null, reason: f.reason,
        } })
        await done()
      }}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <fieldset><legend className="mb-1 font-semibold">{t("ops.edit.collection")} · <span dir="auto">{ops.shipper.name}</span></legend>
          {inp("sLine1", t("ops.edit.line1"))}{inp("sCity", t("ops.edit.city"))}{inp("sPost", t("ops.edit.postcode"), "text", true)}{inp("sPhone", t("ops.edit.phone"), "tel", true)}{inp("sEmail", t("ops.edit.email"), "email", true)}
        </fieldset>
        <fieldset><legend className="mb-1 font-semibold">{t("ops.edit.delivery")} · <span dir="auto">{ops.consignee.name}</span></legend>
          {inp("cLine1", t("ops.edit.line1"))}{inp("cCity", t("ops.edit.city"))}{inp("cPost", t("ops.edit.postcode"), "text", true)}{inp("cPhone", t("ops.edit.phone"), "tel", true)}{inp("cEmail", t("ops.edit.email"), "email", true)}
        </fieldset>
      </div>
      <div className="grid gap-x-4 sm:grid-cols-2">{inp("readyDate", t("ops.edit.ready"), "date")}{inp("preferred", t("ops.preferred"), "date")}</div>
      <Field label={t("ops.handling")}><textarea className="field-input min-h-14" value={f.handling} maxLength={500} onChange={(e) => setF({ ...f, handling: e.target.value })} dir="auto" /></Field>
      <p className="text-caption text-steel">{t("ops.edit.locked")}</p>
      <Field label={t("ops.edit.reason")}><input className="field-input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={3} /></Field>
    </FormDialog>
  )
}

/** Resizes a camera photo to ≤1600 px JPEG in the browser (the API takes ≤ ~700 KB); signatures stay PNG. */
export async function imageData(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement("canvas")
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale)
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height)
    for (const q of [0.8, 0.65, 0.5]) { const d = c.toDataURL("image/jpeg", q); if (d.length < 900_000) return d }
    throw new Error("The photo is too large")
  } finally { URL.revokeObjectURL(url) }
}

function ProofDialog({ open, onOpenChange, cargoRef, done }: { open: boolean; onOpenChange: (o: boolean) => void; cargoRef: string; done: () => Promise<void> }) {
  const t = useT()
  const [f, setF] = useState({ kind: "DELIVERY", receiverName: "", location: "", note: "" })
  const [photos, setPhotos] = useState<{ id: string; name: string }[]>([])
  const [uploading, setUploading] = useState(false)
  useEffect(() => { if (open) { setF({ kind: "DELIVERY", receiverName: "", location: "", note: "" }); setPhotos([]) } }, [open])
  const add = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try { const data = await imageData(file); const r = await api<{ documentId: string }>(`/v1/admin/cargo/requests/${cargoRef}/images`, { body: { filename: file.name, data, purpose: "PHOTO" } }); setPhotos((p) => [...p, { id: r.documentId, name: file.name }]) } catch (e) { toast.error(errText(e)) } finally { setUploading(false) }
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("ops.proof.title")} submitLabel={t("common.save")} description={t("ops.proof.desc")}
      onSubmit={async () => { await api(`/v1/admin/cargo/requests/${cargoRef}/proofs`, { body: { kind: f.kind, receiverName: f.receiverName || undefined, location: f.location, note: f.note || undefined, photoDocumentIds: photos.map((p) => p.id) } }); await done() }}>
      <Field label={t("ops.assign.kind")}><NativeSelect className="field-input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="COLLECTION">{t("ops.kind.collection")}</option><option value="DELIVERY">{t("ops.kind.delivery")}</option></NativeSelect></Field>
      <Field label={t("ops.proof.receiver")}><input className="field-input" value={f.receiverName} onChange={(e) => setF({ ...f, receiverName: e.target.value })} dir="auto" /></Field>
      <Field label={t("ops.assign.place")} hint={t("ops.placeHint")}><input className="field-input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} required minLength={2} /></Field>
      <Field label={t("ops.assign.note")}><input className="field-input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} dir="auto" /></Field>
      <Field label={t("ops.proof.photos")}>
        <input type="file" accept="image/jpeg,image/png" onChange={(e) => void add(e.target.files?.[0])} disabled={uploading} />
        <ul className="mt-1 text-caption text-steel">{photos.map((p) => <li key={p.id} className="flex items-center gap-1">{p.name}<button type="button" aria-label={t("agt.remove")} onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}><X className="size-3" /></button></li>)}</ul>
      </Field>
    </FormDialog>
  )
}

export const failureReasons = Object.entries(FAILURE_REASON_LABELS) as [keyof typeof FAILURE_REASON_LABELS, { en: string; fa: string }][]

/** Pager for server-side pages (1-based). */
export function ServerPager({ page, pages, total, size, setPage }: { page: number; pages: number; total: number; size: number; setPage: (p: number) => void }) {
  const t = useT()
  if (pages <= 1) return null
  const btn = "inline-flex size-8 items-center justify-center rounded-lg border border-rule-strong bg-surface-raised text-steel hover:text-ink disabled:pointer-events-none disabled:opacity-40"
  return (
    <nav aria-label={t("list.pages")} className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2.5 text-meta text-steel" data-testid="pager">
      <span className="num">{t("list.range", { a: (page - 1) * size + 1, b: Math.min(total, page * size), n: total })}</span>
      <span className="flex items-center gap-1.5">
        <span className="num me-1.5 hidden sm:inline">{t("list.page", { p: page, n: pages })}</span>
        <button type="button" className={btn} onClick={() => setPage(page - 1)} disabled={page <= 1} aria-label={t("list.prev")}><ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden /></button>
        <button type="button" className={btn} onClick={() => setPage(page + 1)} disabled={page >= pages} aria-label={t("list.next")}><ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden /></button>
      </span>
    </nav>
  )
}

export interface AgentJob {
  assignmentId: string; kind: AgentKind; status: string; ref: string; trackingNumber: string | null; cargoStatus: string; milestone: string; milestoneLabel: string; service: string
  scheduledFor: string | null; attempts: number
  pickup: { name: string; company: string | null; phone: string; email: string | null; address: string; city: string }
  dropoff: { name: string; company: string | null; phone: string; email: string | null; address: string; city: string }
  pieces: number; weightKg: number; description: string; handlingInstructions: string | null; readyDate: string; preferredDeliveryDate: string | null; note: string | null
  actions: string[]; otherAgents: { kind: AgentKind; agentCode: string; name: string }[]
  timeline: { label: string; location: string; occurredAt: string; description: string | null; agent: string | null }[]; proofs: { id: string; kind: string; receiverName: string | null; capturedAt: string; files: number }[]
}
export interface AgentMe { id: string; agentCode: string; displayName: string; publicName: string; agentType: string; agentTypeLabel: string; responsibilities: AgentKind[]; vehicle: string | null; company: string | null; hasPhoto: boolean }


/** Create or edit an agent (ADR-0043): type, responsibilities, public name, acceptance rule, contact. */
export function AgentDialog({ agent, onClose, done }: { agent: AgentRow | "new" | null; onClose: () => void; done: () => Promise<unknown> }) {
  const t = useT()
  const isNew = agent === "new"
  const blank = { displayName: "", email: "", phone: "", agentType: "COURIER", responsibilities: ["COLLECTION", "DELIVERY"] as AgentKind[], publicName: "", company: "", vehicle: "", notes: "", requiresAcceptance: false }
  const [f, setF] = useState(blank)
  useEffect(() => {
    if (agent && agent !== "new") setF({ displayName: agent.displayName, email: agent.email, phone: agent.phone ?? "", agentType: agent.agentType, responsibilities: agent.responsibilities, publicName: agent.customPublicName ?? "", company: agent.company ?? "", vehicle: agent.vehicle ?? "", notes: agent.notes ?? "", requiresAcceptance: agent.requiresAcceptance })
    else if (agent === "new") setF(blank)
  }, [agent]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!agent) return null
  const set = (k: "displayName" | "email" | "phone" | "publicName" | "company" | "vehicle" | "notes") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} wide title={isNew ? t("ops.agents.new") : t("ops.agents.edit")} submitLabel={t("common.save")} testId="dlg-agent" description={isNew ? t("ops.agents.newDesc") : undefined}
      onSubmit={async () => {
        if (!f.responsibilities.length) throw new Error(t("ops.agents.pickResponsibility"))
        const body = { displayName: f.displayName, phone: f.phone || undefined, agentType: f.agentType, responsibilities: f.responsibilities, company: f.company || undefined, vehicle: f.vehicle || undefined, notes: f.notes || undefined, requiresAcceptance: f.requiresAcceptance }
        if (isNew) await api("/v1/admin/cargo/agents", { body: { ...body, email: f.email, publicName: f.publicName || undefined } })
        else await api(`/v1/admin/cargo/agents/${agent.id}`, { method: "PATCH", body: { ...body, publicName: f.publicName || null } })
        await done()
      }}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label={t("ops.agents.name")}><input className="field-input" value={f.displayName} onChange={set("displayName")} required minLength={2} dir="auto" /></Field>
        <Field label={t("ops.agents.type")}><NativeSelect className="field-input" value={f.agentType} onChange={(e) => setF({ ...f, agentType: e.target.value })} data-testid="agent-type">{AGENT_TYPES.map((x) => <option key={x} value={x}>{t(`ops.agents.t.${x}` as never)}</option>)}</NativeSelect></Field>
        <Field label={t("ops.edit.email")} hint={isNew ? t("ops.agents.emailHint") : undefined}><input type="email" className="field-input" dir="ltr" value={f.email} onChange={set("email")} required disabled={!isNew} data-testid="agent-email" /></Field>
        <Field label={t("ops.edit.phone")}><input type="tel" className="field-input" dir="ltr" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={t("ops.agents.publicName")} hint={t("ops.agents.publicNameHint")}><input className="field-input" value={f.publicName} onChange={set("publicName")} maxLength={80} dir="auto" /></Field>
        <Field label={t("ops.agents.company")}><input className="field-input" value={f.company} onChange={set("company")} dir="auto" /></Field>
        <Field label={t("ops.agents.vehicle")}><input className="field-input" value={f.vehicle} onChange={set("vehicle")} /></Field>
      </div>
      <fieldset><legend className="mb-1 text-meta font-medium">{t("ops.agents.responsibilities")}</legend>
        <div className="flex flex-wrap gap-3">{AGENT_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2 pointer-coarse:min-h-11"><input type="checkbox" className="size-4 accent-orange" checked={f.responsibilities.includes(k)} onChange={(e) => setF({ ...f, responsibilities: e.target.checked ? [...f.responsibilities, k] : f.responsibilities.filter((x) => x !== k) })} />{t(KIND_KEY[k])}</label>))}</div>
      </fieldset>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4 accent-orange" checked={f.requiresAcceptance} onChange={(e) => setF({ ...f, requiresAcceptance: e.target.checked })} /><span>{t("ops.agents.requiresAcceptance")}<span className="block text-caption text-steel">{t("ops.agents.requiresAcceptanceHint")}</span></span></label>
      <Field label={t("ops.assign.note")}><textarea className="field-input min-h-14" value={f.notes} onChange={set("notes")} dir="auto" /></Field>
    </FormDialog>
  )
}
