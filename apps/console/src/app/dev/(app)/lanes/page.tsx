"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

import { CargoService } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { FormDialog } from "@/components/form-dialog"
import { EmptyState } from "@/components/bento"
import { Chips, ListCard, Toolbar } from "@/components/data-list"
import { DataTable } from "@/components/dev-ui"
import { ErrorLine, Field, Loading, PageHead, Tag } from "@/components/ui"
import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"

interface Lane { id: string; originCountry: string; destinationCountry: string; services: string[]; enabled: boolean; requiresComplianceApproval: boolean; volumetricDivisor: number; customerNotice: { en: string; fa: string } | null; counselReference: string | null; version: number; enabledByOwner?: string | null; enabledByCompliance?: string | null }

/** Cargo lanes (ch. 14.2): enabling an Iran lane needs counsel's reference and two approvals (owner + compliance). */
export default function LanesPage() {
  const q = useQuery({ queryKey: ["dev-lanes"], queryFn: () => api<Lane[]>("/v1/dev/cargo/lanes") })
  const t = useT()
  const [edit, setEdit] = useState<Lane | null>(null)
  const [status, setStatus] = useState("")
  const [text, setText] = useState("")
  if (q.error) return <div className="p-4 md:p-6"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  const lanes = q.data.filter((l) => (!status || (status === "on") === l.enabled) && (!text || `${l.originCountry} ${l.destinationCountry} ${l.services.join(" ")}`.toLowerCase().includes(text.toLowerCase())))
  return (
    <div>
      <PageHead kicker={t("dpage.config")} title={t("dnav.lanes")}><span className="text-[12px] text-steel">{t("lanes.desc")}</span></PageHead>
      <Toolbar query={text} onQuery={setText} placeholder={t("lanes.search")} count={lanes.length}>
        <Chips label={t("lanes.c.status")} value={status} onChange={setStatus} options={[{ value: "", label: t("list.all"), count: q.data.length }, { value: "on", label: t("lanes.enabled"), count: q.data.filter((l) => l.enabled).length }, { value: "off", label: t("lanes.disabled"), count: q.data.filter((l) => !l.enabled).length }]} />
      </Toolbar>
      <ListCard>
        {!lanes.length ? <EmptyState title={t("list.noMatch")} className="py-10" /> : (
          <DataTable data-testid="lanes">
            <thead><tr>{[t("lanes.c.lane"), t("lanes.c.services"), t("lanes.c.divisor"), t("lanes.c.compliance"), t("lanes.c.approvals"), t("lanes.c.status"), ""].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{lanes.map((l) => {
              const iran = l.originCountry === "IR" || l.destinationCountry === "IR"
              return (
                <tr key={l.id} className="align-top">
                  <td className="num font-medium whitespace-nowrap" dir="ltr">{l.originCountry} → {l.destinationCountry}{iran && <span className="ms-2 rounded-full bg-danger-subtle px-1.5 text-[10.5px] font-semibold text-danger">IRAN</span>}</td>
                  <td><span className="flex flex-wrap gap-1">{l.services.map((x) => <span key={x} className="rounded-md bg-surface-sunk px-1.5 py-px font-mono text-[11px]" dir="ltr">{x}</span>)}</span></td>
                  <td className="num">{l.volumetricDivisor}</td>
                  <td className="text-[12.5px]">{l.requiresComplianceApproval ? t("lanes.casePer") : "—"}{l.counselReference && <span className="block text-[11.5px] text-steel">{t("lanes.counsel")} <span dir="ltr">{l.counselReference}</span></span>}</td>
                  <td className="text-[12.5px]">{iran ? <span className="flex flex-col gap-0.5"><span className={l.enabledByOwner ? "text-success" : "text-steel"}>{l.enabledByOwner ? "✓" : "○"} {t("lanes.owner")}</span><span className={l.enabledByCompliance ? "text-success" : "text-steel"}>{l.enabledByCompliance ? "✓" : "○"} {t("lanes.complianceOfficer")}</span></span> : t("lanes.single")}</td>
                  <td><Tag value={l.enabled ? "ENABLED" : "DISABLED"} className={l.enabled ? "border-success text-success" : ""} /></td>
                  <td className="text-end"><Button size="xs" variant="ghost" onClick={() => setEdit(l)}>{t("lanes.edit")}</Button></td>
                </tr>
              )
            })}</tbody>
          </DataTable>
        )}
      </ListCard>
      {edit && (
        <FormDialog open onOpenChange={(o) => !o && setEdit(null)} title={t("lanes.editTitle", { lane: `${edit.originCountry} → ${edit.destinationCountry}` })} description={edit.originCountry === "IR" || edit.destinationCountry === "IR" ? t("lanes.iranNote") : undefined} submitLabel={t("lanes.save")}
          onSubmit={async () => {
            const r = await api<{ enabled: boolean; pendingSecondApproval: boolean }>(`/v1/dev/cargo/lanes/${edit.id}`, { method: "PUT", body: { enabled: edit.enabled, services: edit.services, requiresComplianceApproval: edit.requiresComplianceApproval, volumetricDivisor: edit.volumetricDivisor, customerNotice: edit.customerNotice, counselReference: edit.counselReference } })
            if (r.pendingSecondApproval) toast.info(t("lanes.pending"))
            await q.refetch()
          }}>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> {t("lanes.enabled")}</label>
          <fieldset><legend className="cap">{t("lanes.c.services")}</legend><div className="mt-1 grid grid-cols-2 gap-1">{CargoService.options.map((s) => <label key={s} className="flex items-center gap-1.5 font-mono text-[12px]"><input type="checkbox" checked={edit.services.includes(s)} onChange={(e) => setEdit({ ...edit, services: e.target.checked ? [...edit.services, s] : edit.services.filter((x) => x !== s) })} />{s}</label>)}</div></fieldset>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("lanes.c.divisor")}><input type="number" className="field-input num" value={edit.volumetricDivisor} onChange={(e) => setEdit({ ...edit, volumetricDivisor: Number(e.target.value) })} /></Field>
            <Field label={t("lanes.counselRef")}><input className="field-input font-mono" value={edit.counselReference ?? ""} onChange={(e) => setEdit({ ...edit, counselReference: e.target.value || null })} /></Field>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.requiresComplianceApproval} onChange={(e) => setEdit({ ...edit, requiresComplianceApproval: e.target.checked })} /> {t("lanes.needsCase")}</label>
          <Field label={t("lanes.noticeEn")}><textarea className="field-input" value={edit.customerNotice?.en ?? ""} onChange={(e) => setEdit({ ...edit, customerNotice: { en: e.target.value, fa: edit.customerNotice?.fa ?? "" } })} /></Field>
          <Field label={t("lanes.noticeFa")}><textarea className="field-input font-fa" dir="rtl" value={edit.customerNotice?.fa ?? ""} onChange={(e) => setEdit({ ...edit, customerNotice: { fa: e.target.value, en: edit.customerNotice?.en ?? "" } })} /></Field>
        </FormDialog>
      )}
    </div>
  )
}
