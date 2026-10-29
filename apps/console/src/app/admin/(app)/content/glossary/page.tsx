"use client"

import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import type { GlossaryTermBody } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { asPaged, contentError, csv, GLOSSARY_CATEGORIES, type GlossaryRow, NEEDS_PUBLISH, NEXT, type Paged, SERVICES, StatusPill, useContentLabels, useContentRefresh } from "@/components/content"
import { Chips, ListCard, ListPage, Pager, tableClass, Toolbar, usePaged } from "@/components/data-list"
import { FormDialog } from "@/components/form-dialog"
import { Field, PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useSession } from "@/lib/session"

/** Glossary terms (ADR-0017): Persian and English side by side. Reading needs `cms.read`, editing `cms.write`, publishing `cms.publish`. */
export default function Glossary() {
  const L = useContentLabels()
  const { t } = L
  const { can } = useSession()
  const refresh = useContentRefresh()
  const [category, setCategory] = useState<(typeof GLOSSARY_CATEGORIES)[number] | "">("")
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<GlossaryRow | "new" | null>(null)
  const q = useQuery({ queryKey: ["cms", "glossary"], queryFn: async () => asPaged(await api<Paged<GlossaryRow> | GlossaryRow[]>("/v1/admin/cms/glossary")) })
  const rows = useMemo(() => {
    const n = search.trim().toLowerCase()
    return (q.data?.items ?? []).filter((r) => (!category || r.category === category) && (!n || [r.termFa, r.termEn, r.explanationFa, r.explanationEn].some((x) => x.toLowerCase().includes(n))))
  }, [q.data, search, category])
  const paged = usePaged(rows)
  const write = can("cms.write")
  const move = async (r: GlossaryRow, to: GlossaryRow["status"]) => {
    try { await api(`/v1/admin/cms/glossary/${r.id}/transition`, { body: { to } }); toast.success(t("cms.moved", { s: L.status(to) })); await refresh() } catch (e) { toast.error(errText(e)) }
  }
  const actions = (r: GlossaryRow) => (
    <span className="flex flex-wrap gap-1.5">
      {write && <Button size="xs" variant="outline" onClick={() => setEditing(r)} aria-label={`${t("club.edit")} ${r.termEn}`}>{t("club.edit")}</Button>}
      {NEXT[r.status].map((to) => <Button key={to} size="xs" variant="ghost" disabled={NEEDS_PUBLISH(r.status, to) ? !can("cms.publish") : !write} onClick={() => void move(r, to)} data-testid={`gl-to-${to}`}>{t(`cms.to.${to}` as "cms.to.DRAFT")}</Button>)}
    </span>
  )
  return (
    <ListPage>
      <PageHead title={t("nav.contentGlossary")}>
        {write && <Button size="sm" onClick={() => setEditing("new")} data-testid="gl-new"><Plus aria-hidden />{t("cms.gl.new")}</Button>}
      </PageHead>
      <Toolbar query={search} onQuery={setSearch} placeholder={t("cms.gl.search")} count={q.data ? rows.length : undefined}>
        <Chips label={t("cms.gl.category")} value={category} options={[{ value: "" as const, label: t("pg.all") }, ...GLOSSARY_CATEGORIES.map((c) => ({ value: c, label: L.category(c) }))]} onChange={setCategory} />
      </Toolbar>
      {q.error ? <div className="px-6 py-3"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={6} className="px-6" /> : !rows.length ? <EmptyState title={t("cms.gl.none")} /> : (
        <>
          <ul className="space-y-2 px-4 md:hidden" data-testid="gl-cards">
            {paged.rows.map((r) => (
              <li key={r.id} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)]">
                <span className="flex items-center justify-between gap-2"><span className="font-medium font-fa" dir="rtl" lang="fa">{r.termFa}</span><StatusPill status={r.status} label={L.status(r.status)} /></span>
                <span className="block text-steel" dir="ltr" lang="en">{r.termEn} · {L.category(r.category)}</span>
                <span className="mt-2 block">{actions(r)}</span>
              </li>
            ))}
          </ul>
          <ListCard fill className="hidden md:flex">
            <TableScroll>
              <table className={tableClass} data-testid="glossary">
                <thead><tr><th>{t("cms.gl.termFa")}</th><th>{t("cms.gl.termEn")}</th><th>{t("cms.gl.category")}</th><th>{t("pg.c.status")}</th><th><span className="sr-only">{t("club.c.actions")}</span></th></tr></thead>
                <tbody>
                  {paged.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-fa font-medium" dir="rtl" lang="fa">{r.termFa}</td>
                      <td dir="ltr" lang="en">{r.termEn}</td>
                      <td>{L.category(r.category)}</td>
                      <td><StatusPill status={r.status} label={L.status(r.status)} /></td>
                      <td>{actions(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Pager {...paged} className="border-t border-rule" />
          </ListCard>
          <div className="md:hidden"><Pager {...paged} /></div>
        </>
      )}
      {write && <TermDialog term={editing} onClose={() => setEditing(null)} />}
    </ListPage>
  )
}

const EMPTY = { termFa: "", termEn: "", explanationFa: "", explanationEn: "", category: "FLIGHT" as GlossaryTermBody["category"], related: "", service: "" }

function TermDialog({ term, onClose }: { term: GlossaryRow | "new" | null; onClose: () => void }) {
  const L = useContentLabels()
  const { t } = L
  const refresh = useContentRefresh()
  const [f, setF] = useState(EMPTY)
  useEffect(() => { if (term) setF(term === "new" ? EMPTY : { termFa: term.termFa, termEn: term.termEn, explanationFa: term.explanationFa, explanationEn: term.explanationEn, category: term.category, related: term.related.join(", "), service: term.service ?? "" }) }, [term])
  if (!term) return null
  const isNew = term === "new"
  const submit = async () => {
    const body = { termFa: f.termFa.trim(), termEn: f.termEn.trim(), explanationFa: f.explanationFa.trim(), explanationEn: f.explanationEn.trim(), category: f.category, related: csv(f.related), service: f.service || undefined }
    try { await api(isNew ? "/v1/admin/cms/glossary" : `/v1/admin/cms/glossary/${term.id}`, { method: isNew ? "POST" : "PATCH", body }) } catch (e) { throw contentError(e, t) }
    await refresh()
  }
  const input = "field-input"
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} wide title={isNew ? t("cms.gl.new") : t("cms.gl.edit")} submitLabel={t("club.save")} onSubmit={submit} testId="dlg-term">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("cms.gl.termFa")}><input className={`${input} font-fa`} value={f.termFa} onChange={(e) => setF({ ...f, termFa: e.target.value })} required maxLength={120} dir="rtl" lang="fa" /></Field>
        <Field label={t("cms.gl.termEn")}><input className={input} value={f.termEn} onChange={(e) => setF({ ...f, termEn: e.target.value })} required maxLength={120} dir="ltr" lang="en" /></Field>
        <Field label={t("cms.gl.expFa")}><textarea className={`${input} font-fa`} rows={4} value={f.explanationFa} onChange={(e) => setF({ ...f, explanationFa: e.target.value })} required maxLength={1500} dir="rtl" lang="fa" /></Field>
        <Field label={t("cms.gl.expEn")}><textarea className={input} rows={4} value={f.explanationEn} onChange={(e) => setF({ ...f, explanationEn: e.target.value })} maxLength={1500} dir="ltr" lang="en" /></Field>
        <Field label={t("cms.gl.category")}><NativeSelect className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as GlossaryTermBody["category"] })}>{GLOSSARY_CATEGORIES.map((c) => <option key={c} value={c}>{L.category(c)}</option>)}</NativeSelect></Field>
        <Field label={t("cms.gl.service")}><NativeSelect className={input} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}><option value="">{t("cms.gl.noService")}</option>{SERVICES.map((s) => <option key={s} value={s}>{L.service(s)}</option>)}</NativeSelect></Field>
        <Field label={t("cms.gl.related")} className="sm:col-span-2"><input className={input} value={f.related} onChange={(e) => setF({ ...f, related: e.target.value })} dir="auto" /></Field>
      </div>
    </FormDialog>
  )
}
