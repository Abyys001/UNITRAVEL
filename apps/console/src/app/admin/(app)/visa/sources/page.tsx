"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SOURCE_KINDS, SOURCE_TIER, type SourceKind, type TrustedSourceView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { codeLabel } from "@/components/club"
import { ListCard, ListPage, tableClass, Toolbar } from "@/components/data-list"
import { FormDialog } from "@/components/form-dialog"
import { Field, PageHead } from "@/components/ui"
import { Country } from "@/components/visa"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

function SourceDialog({ row, onOpenChange }: { row: TrustedSourceView | null; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [d, setD] = useState({ country: row?.country ?? "", url: row?.url ?? "https://", title: row?.title ?? "", kind: (row?.kind ?? "DESTINATION_IMMIGRATION") as SourceKind, notes: row?.notes ?? "", active: row?.active ?? true })
  return (
    <FormDialog open onOpenChange={onOpenChange} wide title={row ? t("vz.src.edit") : t("vz.src.new")} description={t("vz.src.desc")} submitLabel={t("vz.save")} testId="dlg-visa-source"
      onSubmit={async () => {
        if (row) await api(`/v1/admin/visa/sources/${row.id}`, { method: "PATCH", body: { version: row.version, title: d.title.trim(), kind: d.kind, notes: d.notes.trim() || null, active: d.active } })
        else await api("/v1/admin/visa/sources", { body: { country: d.country.trim() ? d.country.trim().toUpperCase() : null, url: d.url.trim(), title: d.title.trim(), kind: d.kind, notes: d.notes.trim() || null } })
        await qc.invalidateQueries({ queryKey: ["visa", "sources"] })
      }}>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Field label={t("vz.src.country")} hint={t("vz.src.country.hint")}><input className="field-input font-mono uppercase" value={d.country} disabled={!!row} onChange={(e) => setD({ ...d, country: e.target.value })} pattern="[A-Za-z]{2}" maxLength={2} dir="ltr" placeholder="TR" /></Field>
        <Field label="URL" hint={row ? t("vz.src.url.fixed") : t("vz.src.url.hint")}><input type="url" className="field-input font-mono" value={d.url} disabled={!!row} onChange={(e) => setD({ ...d, url: e.target.value })} required pattern="https://.+" maxLength={500} dir="ltr" data-testid="source-url" /></Field>
      </div>
      <Field label={t("vz.src.title")}><input className="field-input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} required minLength={2} maxLength={200} dir="auto" /></Field>
      <Field label={t("vz.src.kind")} hint={t("vz.src.kind.hint")}>
        <NativeSelect className="field-input" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as SourceKind })}>
          {SOURCE_KINDS.map((k) => <option key={k} value={k}>{t("vz.tier", { n: SOURCE_TIER[k] })} · {codeLabel(t, "vz.k", k)}{SOURCE_TIER[k] > 5 ? ` (${t("vz.unofficial")})` : ""}</option>)}
        </NativeSelect>
      </Field>
      <Field label={t("vz.src.notes")}><textarea className="field-input min-h-16" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} maxLength={1000} dir="auto" /></Field>
      {row && <label className="flex min-h-control items-center gap-2"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /><span>{t("vz.active")}</span></label>}
    </FormDialog>
  )
}

/** Trusted sources the research engine reads for each destination (ADR-0033 point 6). Tiers 1-5 are official. */
export default function VisaSourcesPage() {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const [country, setCountry] = useState("")
  const [editing, setEditing] = useState<TrustedSourceView | "new" | null>(null)
  const c = /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : ""
  const q = useQuery({ queryKey: ["visa", "sources", c], queryFn: () => api<TrustedSourceView[]>(`/v1/admin/visa/sources${c ? `?country=${c}` : ""}`) })
  const write = can("visa.write")
  const toggle = async (s: TrustedSourceView) => {
    try { await api(`/v1/admin/visa/sources/${s.id}`, { method: "PATCH", body: { version: s.version, active: !s.active } }); await qc.invalidateQueries({ queryKey: ["visa", "sources"] }) } catch (e) { toast.error(errText(e)); await qc.invalidateQueries({ queryKey: ["visa", "sources"] }) }
  }
  return (
    <ListPage>
      <PageHead kicker={t("nav.visa")} title={t("nav.visaSources")}>{write && <Button size="sm" onClick={() => setEditing("new")} data-testid="new-visa-source"><Plus aria-hidden />{t("vz.src.new")}</Button>}</PageHead>
      <p className="px-4 pb-3 text-meta text-steel md:px-6">{t("vz.src.note")}</p>
      <Toolbar query={country} onQuery={setCountry} placeholder={t("vz.filter.destination")} count={q.data?.length} />
      {q.error ? <div className="px-4 md:px-6"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={4} className="px-4 md:px-6" /> : !q.data.length ? <EmptyState title={t("vz.src.none")} hint={t("vz.src.none.hint")} /> : (
        <ListCard fill>
          <TableScroll label={t("nav.visaSources")}>
            <table className={tableClass} data-testid="visa-sources">
              <thead><tr><th>{t("vz.src.country")}</th><th>{t("vz.src.title")}</th><th>{t("vz.src.kind")}</th><th>{t("vz.src.last")}</th><th>{t("vz.active")}</th><th /></tr></thead>
              <tbody>
                {q.data.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">{s.country ? <Country code={s.country} /> : <span className="text-steel">{t("vz.src.global")}</span>}</td>
                    <td className="max-w-md"><span className="block truncate font-medium" dir="auto">{s.title}</span><a href={s.url} target="_blank" rel="noreferrer noopener" className="block truncate font-mono text-caption text-royal underline" dir="ltr">{s.url}</a>{s.notes && <span className="block truncate text-caption text-steel" dir="auto">{s.notes}</span>}</td>
                    <td className="whitespace-nowrap"><StatusChip tone={s.official ? "ok" : "neutral"}>{t("vz.tier", { n: s.tier })}</StatusChip> <span className="text-caption">{codeLabel(t, "vz.k", s.kind)}</span></td>
                    <td className="whitespace-nowrap text-caption">{s.lastStatus ? <span className={s.lastStatus === "OK" ? "text-success" : "text-danger"}>{s.lastStatus}</span> : "—"}{s.lastFetchedAt && <span className="block text-steel">{fmtDateTime(s.lastFetchedAt)}</span>}</td>
                    <td>{write ? <input type="checkbox" aria-label={t("vz.active")} checked={s.active} onChange={() => void toggle(s)} /> : s.active ? t("vz.yes") : t("vz.no")}</td>
                    <td>{write && <Button size="xs" variant="outline" onClick={() => setEditing(s)}>{t("vz.edit")}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </ListCard>
      )}
      {editing && <SourceDialog row={editing === "new" ? null : editing} onOpenChange={(o) => !o && setEditing(null)} />}
    </ListPage>
  )
}
