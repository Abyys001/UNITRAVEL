"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

import { CargoService } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { FormDialog } from "@/components/form-dialog"
import { ErrorLine, Field, Loading, PageHead, Tag } from "@/components/ui"
import { api } from "@/lib/api"

interface Lane { id: string; originCountry: string; destinationCountry: string; services: string[]; enabled: boolean; requiresComplianceApproval: boolean; volumetricDivisor: number; customerNotice: { en: string; fa: string } | null; counselReference: string | null; version: number; enabledByOwner?: string | null; enabledByCompliance?: string | null }

/** Cargo lanes (ch. 14.2): enabling an Iran lane needs counsel's reference and two approvals (owner + compliance). */
export default function LanesPage() {
  const q = useQuery({ queryKey: ["dev-lanes"], queryFn: () => api<Lane[]>("/v1/dev/cargo/lanes") })
  const [edit, setEdit] = useState<Lane | null>(null)
  if (q.error) return <div className="p-5"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  return (
    <div>
      <PageHead kicker="Platform" title="Cargo lanes" />
      <div className="px-5 py-3">
        <table className="w-full bg-white" data-testid="lanes">
          <thead className="bg-paper"><tr className="border-b border-rule">{["Lane", "Services", "Divisor", "Compliance", "Approvals", "Status", ""].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
          <tbody>{q.data.map((l) => {
            const iran = l.originCountry === "IR" || l.destinationCountry === "IR"
            return (
              <tr key={l.id} className="border-b border-rule/70 align-top">
                <td className="num px-2 py-1.5 font-medium">{l.originCountry} → {l.destinationCountry}{iran && <span className="ms-1 font-mono text-[10px] text-brick">IRAN</span>}</td>
                <td className="px-2 py-1.5 font-mono text-[11px]">{l.services.join(" · ")}</td>
                <td className="num px-2 py-1.5">{l.volumetricDivisor}</td>
                <td className="px-2 py-1.5">{l.requiresComplianceApproval ? "case per request" : "—"}{l.counselReference && <span className="block text-[11px] text-slate">counsel {l.counselReference}</span>}</td>
                <td className="px-2 py-1.5 text-[12px]">{iran ? <>owner {l.enabledByOwner ? "✓" : "—"} · compliance {l.enabledByCompliance ? "✓" : "—"}</> : "single"}</td>
                <td className="px-2 py-1.5"><Tag value={l.enabled ? "ENABLED" : "DISABLED"} className={l.enabled ? "border-moss text-moss" : ""} /></td>
                <td className="px-2 py-1.5"><Button size="xs" variant="ghost" onClick={() => setEdit(l)}>Edit</Button></td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      {edit && (
        <FormDialog open onOpenChange={(o) => !o && setEdit(null)} title={`Lane ${edit.originCountry} → ${edit.destinationCountry}…`} description={edit.originCountry === "IR" || edit.destinationCountry === "IR" ? "Iran lane: enabling records your approval; it opens only when an owner and a compliance officer (two different people) have both approved." : undefined} submitLabel="Save lane"
          onSubmit={async () => {
            const r = await api<{ enabled: boolean; pendingSecondApproval: boolean }>(`/v1/dev/cargo/lanes/${edit.id}`, { method: "PUT", body: { enabled: edit.enabled, services: edit.services, requiresComplianceApproval: edit.requiresComplianceApproval, volumetricDivisor: edit.volumetricDivisor, customerNotice: edit.customerNotice, counselReference: edit.counselReference } })
            if (r.pendingSecondApproval) toast.info("Your approval is recorded; the lane opens after the second approver")
            await q.refetch()
          }}>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> Enabled</label>
          <fieldset><legend className="cap">Services</legend><div className="mt-1 grid grid-cols-2 gap-1">{CargoService.options.map((s) => <label key={s} className="flex items-center gap-1.5 font-mono text-[12px]"><input type="checkbox" checked={edit.services.includes(s)} onChange={(e) => setEdit({ ...edit, services: e.target.checked ? [...edit.services, s] : edit.services.filter((x) => x !== s) })} />{s}</label>)}</div></fieldset>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Volumetric divisor"><input type="number" className="field-input num" value={edit.volumetricDivisor} onChange={(e) => setEdit({ ...edit, volumetricDivisor: Number(e.target.value) })} /></Field>
            <Field label="Counsel reference"><input className="field-input font-mono" value={edit.counselReference ?? ""} onChange={(e) => setEdit({ ...edit, counselReference: e.target.value || null })} /></Field>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.requiresComplianceApproval} onChange={(e) => setEdit({ ...edit, requiresComplianceApproval: e.target.checked })} /> Each request needs a compliance case</label>
          <Field label="Customer notice (English)"><textarea className="field-input" value={edit.customerNotice?.en ?? ""} onChange={(e) => setEdit({ ...edit, customerNotice: { en: e.target.value, fa: edit.customerNotice?.fa ?? "" } })} /></Field>
          <Field label="Customer notice (Persian)"><textarea className="field-input font-fa" dir="rtl" value={edit.customerNotice?.fa ?? ""} onChange={(e) => setEdit({ ...edit, customerNotice: { fa: e.target.value, en: edit.customerNotice?.en ?? "" } })} /></Field>
        </FormDialog>
      )}
    </div>
  )
}
