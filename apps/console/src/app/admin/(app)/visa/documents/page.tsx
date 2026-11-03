"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"

import { DOCUMENT_CATEGORIES, type StaffDocumentTypeView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { codeLabel } from "@/components/club"
import { ListCard, ListPage, tableClass } from "@/components/data-list"
import { FormDialog } from "@/components/form-dialog"
import { Field, PageHead } from "@/components/ui"
import { useDocTypes } from "@/components/visa"
import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

function DocDialog({ row, onOpenChange }: { row: StaffDocumentTypeView | null; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [d, setD] = useState({
    code: row?.code ?? "", nameEn: row?.name.en ?? "", nameFa: row?.name.fa ?? "", descEn: row?.description.en ?? "", descFa: row?.description.fa ?? "",
    category: row?.category ?? "OTHER_NON_NATIONAL", issuingCountry: row?.issuingCountry ?? "", active: row?.active ?? true, sortOrder: String(row?.sortOrder ?? 100),
  })
  return (
    <FormDialog open onOpenChange={onOpenChange} wide title={row ? t("vz.doc.edit") : t("vz.doc.new")} description={t("vz.doc.desc")} submitLabel={t("vz.save")} testId="dlg-visa-doc"
      onSubmit={async () => {
        const name = { en: d.nameEn.trim(), fa: d.nameFa.trim() }
        const description = { en: d.descEn.trim(), fa: d.descFa.trim() }
        if (row) await api(`/v1/admin/visa/document-types/${row.code}`, { method: "PATCH", body: { version: row.version, name, description, active: d.active, sortOrder: Number(d.sortOrder) } })
        else await api("/v1/admin/visa/document-types", { body: { code: d.code.trim().toUpperCase(), name, description, category: d.category, issuingCountry: d.issuingCountry.trim() ? d.issuingCountry.trim().toUpperCase() : null, sortOrder: Number(d.sortOrder) } })
        await qc.invalidateQueries({ queryKey: ["visa", "doc-types"] })
      }}>
      {!row && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("vz.doc.code")} hint={t("vz.doc.code.hint")}><input className="field-input font-mono uppercase" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} required pattern="[A-Za-z][A-Za-z0-9_]{2,39}" dir="ltr" /></Field>
          <Field label={t("vz.doc.category")}><NativeSelect className="field-input" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as typeof d.category })}>{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{codeLabel(t, "vz.c", c)}</option>)}</NativeSelect></Field>
          <Field label={t("vz.issuer")} hint={t("vz.doc.issuer.hint")}><input className="field-input font-mono uppercase" value={d.issuingCountry} onChange={(e) => setD({ ...d, issuingCountry: e.target.value })} pattern="[A-Za-z]{2}" maxLength={2} dir="ltr" /></Field>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`${t("vz.doc.name")} (English)`}><input className="field-input" value={d.nameEn} onChange={(e) => setD({ ...d, nameEn: e.target.value })} required minLength={2} maxLength={120} dir="ltr" lang="en" /></Field>
        <Field label={`${t("vz.doc.name")} (فارسی)`}><input className="field-input font-fa" value={d.nameFa} onChange={(e) => setD({ ...d, nameFa: e.target.value })} required minLength={2} maxLength={120} dir="rtl" lang="fa" /></Field>
        <Field label={`${t("vz.doc.description")} (English)`}><textarea className="field-input min-h-16" value={d.descEn} onChange={(e) => setD({ ...d, descEn: e.target.value })} maxLength={600} dir="ltr" lang="en" /></Field>
        <Field label={`${t("vz.doc.description")} (فارسی)`}><textarea className="field-input min-h-16 font-fa" value={d.descFa} onChange={(e) => setD({ ...d, descFa: e.target.value })} maxLength={600} dir="rtl" lang="fa" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("ls.sort")}><input type="number" className="field-input num" value={d.sortOrder} onChange={(e) => setD({ ...d, sortOrder: e.target.value })} min={0} max={10000} required dir="ltr" /></Field>
        {row && <label className="flex min-h-control items-center gap-2 self-end"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /><span>{t("vz.active")}</span></label>}
      </div>
    </FormDialog>
  )
}

/** Travel document types offered on the customer checker (ADR-0029 point 2). Code, category and issuer are fixed once created. */
export default function VisaDocumentsPage() {
  const t = useT()
  const { can } = useSession()
  const q = useDocTypes()
  const [editing, setEditing] = useState<StaffDocumentTypeView | "new" | null>(null)
  const write = can("visa.write")
  return (
    <ListPage>
      <PageHead kicker={t("nav.visa")} title={t("nav.visaDocuments")}>{write && <Button size="sm" onClick={() => setEditing("new")}><Plus aria-hidden />{t("vz.doc.new")}</Button>}</PageHead>
      <p className="px-4 pb-3 text-meta text-steel md:px-6">{t("vz.doc.note")}</p>
      {q.error ? <div className="px-4 md:px-6"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={6} className="px-4 md:px-6" /> : !q.data.length ? <EmptyState title={t("vz.doc.none")} /> : (
        <ListCard fill>
          <TableScroll label={t("nav.visaDocuments")}>
            <table className={tableClass} data-testid="visa-doc-types">
              <thead><tr><th>{t("vz.doc.name")}</th><th>{t("vz.doc.code")}</th><th>{t("vz.doc.category")}</th><th>{t("vz.issuer")}</th><th>{t("ls.sort")}</th><th>{t("vz.active")}</th><th /></tr></thead>
              <tbody>
                {q.data.map((d) => (
                  <tr key={d.code}>
                    <td className="max-w-md"><span className="block truncate font-medium">{d.name.en}</span><span className="block truncate font-fa text-caption text-steel" dir="rtl">{d.name.fa}</span></td>
                    <td className="font-mono text-caption" dir="ltr">{d.code}</td>
                    <td className="text-caption">{codeLabel(t, "vz.c", d.category)}</td>
                    <td className="font-mono" dir="ltr">{d.issuingCountry ?? "—"}</td>
                    <td className="num">{d.sortOrder}</td>
                    <td><StatusChip tone={d.active ? "ok" : "neutral"}>{d.active ? t("vz.active") : t("vz.inactive")}</StatusChip></td>
                    <td>{write && <Button size="xs" variant="outline" onClick={() => setEditing(d)}>{t("vz.edit")}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </ListCard>
      )}
      {editing && <DocDialog row={editing === "new" ? null : editing} onOpenChange={(o) => !o && setEditing(null)} />}
    </ListPage>
  )
}
