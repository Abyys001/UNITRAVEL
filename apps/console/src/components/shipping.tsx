"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, FileText, PackageCheck, Truck, Upload, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { EXPORT_REASONS, SERVICE_LEVELS } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"

import { openApiPdf, openDocument } from "@/components/cargo-ops"
import { FormDialog } from "@/components/form-dialog"
import { Empty, Panel, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, human, money, toMajor, toMinor } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

type Consignment = {
  id: string; shipmentNo: string; direction: "OUTBOUND" | "RETURN"; partnerId: string; courier: string; serviceLevel: string; tracked: boolean; signedFor: boolean
  courierTrackingNumber: string | null; courierTrackingUrl: string | null; shipDate: string | null; estimatedDelivery: string | null; cost: { amountMinor: number; currency: string } | null
  labelDocumentId: string | null; status: "BOOKED" | "DISPATCHED" | "CANCELLED"; cancelReason: string | null; note: string | null; dispatchedAt: string | null; version: number
}
type Customs = { review: null | { exportReason: string; incoterm: "DAP" | "DDP"; dutiesPayer: "RECEIVER" | "SENDER"; invoiceNumber: string | null; notes: string | null; approvedAt: string | null; approvedBy: string | null }; approved: boolean; stale: boolean }
type ShippingData = { consignments: Consignment[]; couriers: { id: string; name: string; type: string; servesLane: boolean }[]; international: boolean; customs: Customs }

const field = "grid gap-1 text-meta font-medium"
const sel = "h-10 rounded-lg border border-rule-strong bg-surface px-2 text-body"

/** ADR-0047: manual-courier consignments and the customs review for one cargo request. */
export function ShippingPanels({ cargoRef }: { cargoRef: string }) {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const write = can("cargo_request.transition")
  const key = ["cargo-shipping", cargoRef]
  const q = useQuery({ queryKey: key, queryFn: () => api<ShippingData>(`/v1/admin/cargo/requests/${cargoRef}/consignments`) })
  const [editing, setEditing] = useState<Consignment | "OUTBOUND" | "RETURN" | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const d = q.data
  if (!d) return <Panel title={t("cons.title")}><Empty>{q.error ? errText(q.error) : t("ops.loading")}</Empty></Panel>
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); await refresh() } catch (e) { toast.error(errText(e)) } }
  const upload = async (c: Consignment, file?: File) => {
    if (!file) return
    const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file) })
    await act(() => api(`/v1/admin/cargo/requests/${cargoRef}/consignments/${c.id}/label`, { body: { filename: file.name, data } }), t("cons.labelUp"))
  }
  return (
    <>
      <Panel title={t("cons.title")} aside={write && <div className="flex gap-1.5">
        <Button size="xs" variant="outline" onClick={() => setEditing("OUTBOUND")} data-testid="cons-book"><Truck className="size-3.5" />{t("cons.book")}</Button>
        <Button size="xs" variant="ghost" onClick={() => setEditing("RETURN")}>{t("cons.return")}</Button>
      </div>}>
        <p className="mb-2 text-caption text-steel">{t("cons.manualHint")}</p>
        {!d.consignments.length ? <Empty>{t("cons.none")}</Empty> : (
          <ul className="ledger-rows" data-testid="cons-list">{d.consignments.map((c) => (
            <li key={c.id} className="py-2">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium"><span className="ref">{c.shipmentNo}</span> · {c.courier} · {human(c.serviceLevel)}{c.direction === "RETURN" && <> · {t("cons.dir.RETURN")}</>}</span>
                <Tag value={c.status} />
              </p>
              <p className="text-caption text-steel">
                {[c.tracked && t("cons.tracked"), c.signedFor && t("cons.signed"), c.shipDate && `${t("cons.ship")} ${c.shipDate}`, c.estimatedDelivery && `${t("cons.eta")} ${c.estimatedDelivery}`, c.cost && `${t("cons.cost")} ${money(c.cost)}`, c.dispatchedAt && `${t("cons.dispatched")} ${fmtDateTime(c.dispatchedAt)}`, c.cancelReason].filter(Boolean).join(" · ")}
              </p>
              {c.courierTrackingNumber && <p className="text-meta"><span className="ref" dir="ltr">{c.courierTrackingNumber}</span>{c.courierTrackingUrl && <a href={c.courierTrackingUrl} target="_blank" rel="noopener noreferrer" className="ms-2 inline-flex items-center gap-1 text-link hover:underline"><ExternalLink className="size-3.5" />{c.courier}</a>}</p>}
              {c.note && <p className="text-caption" dir="auto">{c.note}</p>}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {c.labelDocumentId && <Button size="xs" variant="ghost" onClick={() => void openDocument(c.labelDocumentId!)}><FileText className="size-3.5" />{t("cons.viewLabel")}</Button>}
                {write && c.status !== "CANCELLED" && <>
                  <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-caption font-medium hover:bg-hover"><Upload className="size-3.5" aria-hidden />{t("cons.label")}<input type="file" accept="application/pdf" className="sr-only" onChange={(e) => { void upload(c, e.target.files?.[0]); e.target.value = "" }} /></label>
                  <Button size="xs" variant="ghost" onClick={() => setEditing(c)}>{t("cons.edit")}</Button>
                </>}
                {write && c.status === "BOOKED" && <Button size="xs" onClick={() => void act(() => api(`/v1/admin/cargo/requests/${cargoRef}/consignments/${c.id}/dispatch`, { body: {} }), t("cons.dispatched"))} data-testid="cons-dispatch"><PackageCheck className="size-3.5" />{t("cons.dispatch")}</Button>}
                {write && c.status !== "CANCELLED" && <Button size="xs" variant="ghost" className="text-danger" onClick={() => { const reason = window.prompt(t("cons.cancelReason")); if (reason && reason.trim().length >= 3) void act(() => api(`/v1/admin/cargo/requests/${cargoRef}/consignments/${c.id}/cancel`, { body: { reason } }), t("cons.cancelled")) }}><X className="size-3.5" />{t("cons.cancel")}</Button>}
              </div>
            </li>))}</ul>
        )}
      </Panel>
      <CustomsReview cargoRef={cargoRef} data={d} write={write} onSaved={refresh} />
      {editing && <ConsignmentDialog cargoRef={cargoRef} data={d} editing={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </>
  )
}

function ConsignmentDialog({ cargoRef, data, editing, onClose, onSaved }: { cargoRef: string; data: ShippingData; editing: Consignment | "OUTBOUND" | "RETURN"; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const t = useT()
  const c = typeof editing === "string" ? null : editing
  const direction = c?.direction ?? (editing as "OUTBOUND" | "RETURN")
  const choices = data.couriers.filter((x) => direction === "RETURN" || x.servesLane)
  const [f, setF] = useState({
    partnerId: c?.partnerId ?? choices[0]?.id ?? "", serviceLevel: c?.serviceLevel ?? "STANDARD", tracked: c?.tracked ?? true, signedFor: c?.signedFor ?? false,
    tn: c?.courierTrackingNumber ?? "", url: c?.courierTrackingUrl ?? "", ship: c?.shipDate ?? "", eta: c?.estimatedDelivery ?? "",
    cost: c?.cost ? toMajor(c.cost.amountMinor, c.cost.currency) : "", currency: c?.cost?.currency ?? "GBP", note: c?.note ?? "",
  })
  const submit = async () => {
    const body = {
      direction, partnerId: f.partnerId, serviceLevel: f.serviceLevel, tracked: f.tracked, signedFor: f.signedFor,
      courierTrackingNumber: f.tn.trim() || null, courierTrackingUrl: f.url.trim() || null, shipDate: f.ship || null, estimatedDelivery: f.eta || null,
      costMinor: f.cost ? toMinor(f.cost, f.currency) : null, costCurrency: f.cost ? f.currency : null, note: f.note.trim() || null,
    }
    if (c) await api(`/v1/admin/cargo/requests/${cargoRef}/consignments/${c.id}`, { method: "PUT", body: { ...body, version: c.version } })
    else await api(`/v1/admin/cargo/requests/${cargoRef}/consignments`, { body })
    await onSaved()
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} wide title={c ? `${t("cons.edit")} ${c.shipmentNo}` : direction === "RETURN" ? t("cons.return") : t("cons.book")} submitLabel={t("cons.save")} onSubmit={submit} testId="dlg-consignment" description={t("cons.manualHint")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>{t("cons.courier")}<select className={sel} value={f.partnerId} onChange={(e) => setF({ ...f, partnerId: e.target.value })} required>{choices.map((x) => <option key={x.id} value={x.id}>{x.name}{!x.servesLane ? ` (${t("cons.notLane")})` : ""}</option>)}</select></label>
        <label className={field}>{t("cons.level")}<select className={sel} value={f.serviceLevel} onChange={(e) => setF({ ...f, serviceLevel: e.target.value })}>{SERVICE_LEVELS.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select></label>
        <label className="flex items-center gap-2 text-meta font-medium"><input type="checkbox" checked={f.tracked} onChange={(e) => setF({ ...f, tracked: e.target.checked })} />{t("cons.tracked")}</label>
        <label className="flex items-center gap-2 text-meta font-medium"><input type="checkbox" checked={f.signedFor} onChange={(e) => setF({ ...f, signedFor: e.target.checked })} />{t("cons.signed")}</label>
        <label className={field}>{t("cons.tn")}<Input value={f.tn} onChange={(e) => setF({ ...f, tn: e.target.value })} dir="ltr" className="ref" /></label>
        <label className={field}>{t("cons.url")}<Input type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} dir="ltr" placeholder="https://" /></label>
        <label className={field}>{t("cons.ship")}<Input type="date" value={f.ship} onChange={(e) => setF({ ...f, ship: e.target.value })} /></label>
        <label className={field}>{t("cons.eta")}<Input type="date" value={f.eta} onChange={(e) => setF({ ...f, eta: e.target.value })} /></label>
        <label className={field}>{t("cons.cost")}<Input inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} className="num" /></label>
        <label className={field}>{t("cons.currency")}<Input value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></label>
        <label className={`${field} sm:col-span-2`}>{t("cons.note")}<Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} dir="auto" /></label>
      </div>
    </FormDialog>
  )
}

function CustomsReview({ cargoRef, data, write, onSaved }: { cargoRef: string; data: ShippingData; write: boolean; onSaved: () => Promise<unknown> }) {
  const t = useT()
  const r = data.customs.review
  const [f, setF] = useState({ exportReason: r?.exportReason ?? "GIFT", incoterm: r?.incoterm ?? "DAP", dutiesPayer: r?.dutiesPayer ?? "RECEIVER", invoiceNumber: r?.invoiceNumber ?? "", notes: r?.notes ?? "" })
  const [busy, setBusy] = useState(false)
  const save = async (approve: boolean) => {
    setBusy(true)
    try { await api(`/v1/admin/cargo/requests/${cargoRef}/customs-review`, { method: "PUT", body: { ...f, invoiceNumber: f.invoiceNumber || null, notes: f.notes || null, approve } }); toast.success(t("custrev.saved")); await onSaved() } catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  return (
    <Panel title={t("custrev.title")} aside={<div className="flex gap-1.5">
      <Button size="xs" variant="ghost" onClick={() => void openApiPdf(`/v1/admin/cargo/requests/${cargoRef}/invoice/commercial.pdf`)}><FileText className="size-3.5" />{t("custrev.commercial")}</Button>
      <Button size="xs" variant="ghost" onClick={() => void openApiPdf(`/v1/admin/cargo/requests/${cargoRef}/invoice/proforma.pdf`)}><FileText className="size-3.5" />{t("custrev.proforma")}</Button>
    </div>}>
      {!data.international ? <p className="text-meta text-steel">{t("custrev.domestic")}</p> : (
        <div className="grid gap-3" data-testid="customs-review">
          {data.customs.approved && r?.approvedAt && <p className="rounded-md bg-success/10 px-2 py-1.5 text-meta font-medium text-success">{t("custrev.approved", { by: r.approvedBy ?? "-", at: fmtDateTime(r.approvedAt) })}</p>}
          {data.customs.stale && <p className="rounded-md bg-warning-subtle px-2 py-1.5 text-meta text-warning-subtle-fg">{t("custrev.stale")}</p>}
          {!data.customs.approved && !data.customs.stale && <p className="text-meta text-steel">{t("custrev.needed")}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={field}>{t("custrev.reason")}<select className={sel} value={f.exportReason} onChange={(e) => setF({ ...f, exportReason: e.target.value })} disabled={!write}>{EXPORT_REASONS.map((x) => <option key={x} value={x}>{human(x)}</option>)}</select></label>
            <label className={field}>{t("custrev.incoterm")}<select className={sel} value={f.incoterm} onChange={(e) => setF({ ...f, incoterm: e.target.value as "DAP" | "DDP" })} disabled={!write}><option value="DAP">DAP</option><option value="DDP">DDP</option></select></label>
            <label className={field}>{t("custrev.duties")}<select className={sel} value={f.dutiesPayer} onChange={(e) => setF({ ...f, dutiesPayer: e.target.value as "RECEIVER" | "SENDER" })} disabled={!write}><option value="RECEIVER">{t("custrev.receiver")}</option><option value="SENDER">{t("custrev.sender")}</option></select></label>
            <label className={field}>{t("custrev.invoiceNo")}<Input value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} disabled={!write} /></label>
            <label className={`${field} sm:col-span-2`}>{t("custrev.notes")}<Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} dir="auto" disabled={!write} /></label>
          </div>
          {write && <div className="flex gap-2"><Button size="sm" variant="outline" loading={busy} onClick={() => void save(false)}>{t("custrev.save")}</Button><Button size="sm" loading={busy} onClick={() => void save(true)} data-testid="customs-approve">{t("custrev.approve")}</Button></div>}
        </div>
      )}
    </Panel>
  )
}
