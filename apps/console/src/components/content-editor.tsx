"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Plus, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import type { CmsEntryBody, CmsKind, CmsStaffEntry, CmsStatus } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { TileError } from "@/components/bento"
import { ActionBar, ListSkeleton } from "@/components/case"
import { contentError, csv, isConflict, KINDS, NEEDS_PUBLISH, NEXT, SERVICES, StatusPill, useContentLabels, webUrl } from "@/components/content"
import { Check, Segmented } from "@/components/controls"
import { Markdown } from "@/components/markdown"
import { Field, Loading, Panel } from "@/components/ui"
import { api } from "@/lib/api"
import { useCrumbLabel } from "@/lib/crumb"
import { fmtDateTime } from "@/lib/format"
import { localInput } from "@/components/club"
import { useSession } from "@/lib/session"

interface Form {
  title: string; slug: string; kind: CmsKind; locale: "en" | "fa"; summary: string; bodyMd: string; category: string; tags: string
  featuredImage: string; imageAlt: string; seoTitle: string; seoDescription: string; relatedServices: string[]; claims: string[]; publishAt: string
}
const EMPTY: Form = { title: "", slug: "", kind: "ARTICLE", locale: "en", summary: "", bodyMd: "", category: "", tags: "", featuredImage: "", imageAlt: "", seoTitle: "", seoDescription: "", relatedServices: [], claims: [], publishAt: "" }
const fromEntry = (e: CmsStaffEntry): Form => ({
  title: e.title, slug: e.slug, kind: e.kind, locale: e.locale, summary: e.summary ?? "", bodyMd: e.bodyMd, category: e.category ?? "", tags: (e.tags ?? []).join(", "),
  featuredImage: e.featuredImage ?? "", imageAlt: e.imageAlt ?? "", seoTitle: e.seoTitle ?? "", seoDescription: e.seoDescription ?? "", relatedServices: e.relatedServices ?? [],
  claims: e.claimsToVerify ?? [], publishAt: e.publishAt ? localInput(new Date(e.publishAt)) : "",
})
const toBody = (f: Form) => ({
  kind: f.kind, locale: f.locale, slug: f.slug.trim(), title: f.title.trim(), summary: f.summary.trim(), bodyMd: f.bodyMd,
  category: f.category.trim() || undefined, tags: csv(f.tags), featuredImage: f.featuredImage.trim() || undefined, imageAlt: f.imageAlt.trim() || undefined,
  seoTitle: f.seoTitle.trim() || undefined, seoDescription: f.seoDescription.trim() || undefined, relatedServices: f.relatedServices, claimsToVerify: f.claims,
  publishAt: f.publishAt ? new Date(f.publishAt).toISOString() : undefined,
}) as CmsEntryBody

const Counter = ({ n, max }: { n: number; max: number }) => { const { t } = useContentLabels(); return <span className={n > max ? "text-danger" : undefined}>{t("cms.chars", { n, max })}</span> }

export function ContentEditor({ id }: { id: string | null }) {
  const L = useContentLabels()
  const { t } = L
  const { can } = useSession()
  const router = useRouter()
  const qc = useQueryClient()
  const key = ["cms", "entry", id]
  const q = useQuery({ queryKey: key, queryFn: () => api<CmsStaffEntry>(`/v1/admin/cms/entries/${id}`), enabled: !!id })
  const rev = useQuery({ queryKey: ["cms", "revisions", id], queryFn: () => api<{ id: string; version: number; status: string; title: string; changedBy: string; note: string | null; createdAt: string }[]>(`/v1/admin/cms/entries/${id}/revisions`), enabled: !!id, retry: false })
  const entry = q.data
  const [f, setF] = useState<Form>(EMPTY)
  const [loaded, setLoaded] = useState<Form>(EMPTY)
  const [newClaim, setNewClaim] = useState("")
  const [view, setView] = useState<"write" | "preview">("write")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useCrumbLabel(entry?.title)
  useEffect(() => { if (entry) { const v = fromEntry(entry); setF(v); setLoaded(v) } }, [entry?.id, entry?.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(loaded), [f, loaded])
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  const write = can("cms.write")
  const publish = can("cms.publish")
  const reload = async () => { await qc.invalidateQueries({ queryKey: ["cms"] }) }

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      if (!id) {
        const created = await api<CmsStaffEntry>("/v1/admin/cms/entries", { body: toBody(f) })
        toast.success(t("cms.created"))
        await reload()
        router.push(`/content/${created.id}`)
      } else {
        const r = await api<CmsStaffEntry>(`/v1/admin/cms/entries/${id}`, { method: "PATCH", body: { ...toBody(f), version: entry!.version } })
        qc.setQueryData(key, r)
        toast.success(t("cms.saved"))
        await reload()
      }
    } catch (x) {
      if (isConflict(x)) { await reload(); toast.error(t("cms.conflict")) } else setErr(contentError(x, t).message)
    } finally { setBusy(false) }
  }
  const move = async (to: CmsStatus) => {
    setBusy(true); setErr(null)
    try {
      const r = await api<CmsStaffEntry>(`/v1/admin/cms/entries/${id}/transition`, { body: { to, version: entry!.version } })
      qc.setQueryData(key, r)
      toast.success(t("cms.moved", { s: L.status(to) }))
      await reload()
    } catch (x) {
      if (isConflict(x)) { await reload(); toast.error(t("cms.conflict")) } else setErr(contentError(x, t).message)
    } finally { setBusy(false) }
  }
  const addClaim = () => { const c = newClaim.trim(); if (c && !f.claims.includes(c)) set("claims", [...f.claims, c]); setNewClaim("") }

  if (id && q.error) return <div className="p-5"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (id && !entry) return <><Loading label="…" /><ListSkeleton rows={6} /></>
  const status = entry?.status
  const url = entry ? webUrl(entry) : null
  const ro = !write
  const input = "field-input"
  return (
    <form onSubmit={save} className="pb-8" data-testid="cms-editor">
      <ActionBar aria-label={t("case.actions")}>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/content" className="text-meta font-medium text-link hover:underline">← {t("cms.back")}</Link>
          <span className="font-semibold" dir="auto">{id ? entry!.title : t("cms.edit.new")}</span>
          {status && <span data-testid="cms-status"><StatusPill status={status} label={L.status(status)} /></span>}
          {entry && <span className="num text-meta text-steel">v{entry.version}</span>}
          <span className="ms-auto flex flex-wrap items-center gap-2">
            {write && <Button type="submit" size="sm" loading={busy} disabled={!!id && !dirty} data-testid="cms-save">{id ? t("cms.save") : t("cms.create")}</Button>}
            {status && NEXT[status].map((to) => {
              const needsPublish = NEEDS_PUBLISH(status, to)
              const blocked = to === "PUBLISHED" && f.claims.length > 0
              const disabled = busy || dirty || (needsPublish ? !publish : !write) || blocked
              return <Button key={to} type="button" size="sm" variant={to === "PUBLISHED" ? "default" : "outline"} disabled={disabled} onClick={() => void move(to)} data-testid={`cms-to-${to}`}>{t(`cms.to.${to}` as "cms.to.DRAFT")}</Button>
            })}
          </span>
        </div>
        {status && (
          <p className="mt-1.5 text-meta text-steel" role="status" data-testid="cms-why">
            {dirty ? t("cms.dirty") : f.claims.length > 0 && NEXT[status].includes("PUBLISHED") ? t("cms.why.claims", { n: f.claims.length }) : !publish && NEXT[status].some((to) => NEEDS_PUBLISH(status, to)) ? t("cms.why.perm") : ro ? t("cms.why.write") : ""}
          </p>
        )}
      </ActionBar>
      {err && <p role="alert" className="mx-5 mt-3 rounded-sm bg-danger-subtle px-2 py-1.5 text-danger">{err}</p>}
      <div className="grid gap-x-8 px-5 pt-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("cms.f.title")} className="sm:col-span-2"><input className={input} value={f.title} onChange={(e) => set("title", e.target.value)} required minLength={2} maxLength={160} dir="auto" disabled={ro} data-testid="cms-title" /></Field>
            <Field label={t("cms.f.slug")} hint={t("cms.f.slug.hint")}><input className={`${input} font-mono`} value={f.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={2} maxLength={80} dir="ltr" disabled={ro} data-testid="cms-slug" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("cms.f.kind")}><NativeSelect className={input} value={f.kind} onChange={(e) => set("kind", e.target.value as CmsKind)} disabled={ro || !!id} data-testid="cms-kind">{KINDS.map((k) => <option key={k} value={k}>{L.kind(k)}</option>)}</NativeSelect></Field>
              <Field label={t("cms.f.locale")}><NativeSelect className={input} value={f.locale} onChange={(e) => set("locale", e.target.value as "en" | "fa")} disabled={ro || !!id} data-testid="cms-locale"><option value="en">English</option><option value="fa">فارسی</option></NativeSelect></Field>
            </div>
            <Field label={t("cms.f.summary")} className="sm:col-span-2" hint={<Counter n={f.summary.length} max={400} />}><textarea className={input} rows={2} value={f.summary} onChange={(e) => set("summary", e.target.value)} maxLength={400} dir="auto" disabled={ro} /></Field>
          </div>
          <div>
            <div className="mb-2 flex justify-end lg:hidden">
              <Segmented label={t("cms.tab.preview")} hideLabel size="sm" value={view} onChange={setView} options={[{ value: "write", label: t("cms.tab.write") }, { value: "preview", label: t("cms.tab.preview") }]} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={view === "preview" ? "hidden lg:block" : undefined}>
                <Field label={t("cms.f.body")} hint={t("cms.f.body.hint")}>
                  <textarea className={`${input} min-h-[22rem] font-mono`} value={f.bodyMd} onChange={(e) => set("bodyMd", e.target.value)} maxLength={120000} dir="auto" disabled={ro} data-testid="cms-body" />
                </Field>
              </div>
              <section aria-label={t("cms.tab.preview")} className={`min-w-0 rounded-lg border border-rule bg-surface-raised p-4 ${view === "write" ? "hidden lg:block" : ""}`} data-testid="cms-preview">
                <h2 className="sr-only">{t("cms.tab.preview")}</h2>
                {f.bodyMd.trim() ? <Markdown source={f.bodyMd} /> : <p className="text-steel">{t("cms.preview.empty")}</p>}
              </section>
            </div>
          </div>
          <Panel title="SEO">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("cms.f.seoTitle")} hint={<Counter n={f.seoTitle.length} max={70} />}><input className={input} value={f.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} maxLength={70} dir="auto" disabled={ro} /></Field>
              <Field label={t("cms.f.seoDesc")} hint={<Counter n={f.seoDescription.length} max={170} />}><input className={input} value={f.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} maxLength={170} dir="auto" disabled={ro} /></Field>
              <Field label={t("cms.f.image")}><input className={input} value={f.featuredImage} onChange={(e) => set("featuredImage", e.target.value)} maxLength={300} dir="ltr" disabled={ro} /></Field>
              <Field label={t("cms.f.alt")}><input className={input} value={f.imageAlt} onChange={(e) => set("imageAlt", e.target.value)} maxLength={200} dir="auto" disabled={ro} /></Field>
            </div>
          </Panel>
        </div>
        <div className="min-w-0 space-y-3">
          <Panel title={t("cms.claims.title")}>
            <p className="mb-2 text-meta text-steel">{t("cms.claims.hint")}</p>
            {f.claims.length === 0 ? <p className="text-steel" data-testid="cms-claims-empty">{t("cms.claims.empty")}</p> : (
              <ul className="space-y-1.5" data-testid="cms-claims">
                {f.claims.map((c) => (
                  <li key={c} className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-subtle px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 text-warning-subtle-fg" dir="auto">{c}</span>
                    <Button type="button" size="xs" variant="ghost" disabled={ro} onClick={() => set("claims", f.claims.filter((x) => x !== c))} aria-label={t("cms.claims.remove", { c })} data-testid="cms-claim-remove"><X aria-hidden /></Button>
                  </li>
                ))}
              </ul>
            )}
            {write && (
              <div className="mt-2 flex gap-2">
                <label className="min-w-0 flex-1"><span className="sr-only">{t("cms.claims.add")}</span><input className={input} value={newClaim} onChange={(e) => setNewClaim(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addClaim() } }} maxLength={300} placeholder={t("cms.claims.placeholder")} dir="auto" data-testid="cms-claim-input" /></label>
                <Button type="button" size="sm" variant="outline" onClick={addClaim} disabled={!newClaim.trim()} data-testid="cms-claim-add"><Plus aria-hidden />{t("cms.claims.add")}</Button>
              </div>
            )}
          </Panel>
          <Panel title={t("cms.f.category")}>
            <div className="space-y-3">
              <Field label={t("cms.f.category")}><input className={input} value={f.category} onChange={(e) => set("category", e.target.value)} maxLength={40} dir="auto" disabled={ro} /></Field>
              <Field label={t("cms.f.tags")}><input className={input} value={f.tags} onChange={(e) => set("tags", e.target.value)} dir="auto" disabled={ro} /></Field>
              <Field label={t("cms.f.publishAt")} hint={t("cms.f.publishAt.hint")}><input type="datetime-local" className={input} value={f.publishAt} onChange={(e) => set("publishAt", e.target.value)} disabled={ro} /></Field>
            </div>
          </Panel>
          <Panel title={t("cms.f.services")}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {SERVICES.map((s) => <Check key={s} label={L.service(s)} checked={f.relatedServices.includes(s)} disabled={ro || (!f.relatedServices.includes(s) && f.relatedServices.length >= 6)} onChange={(e) => set("relatedServices", e.target.checked ? [...f.relatedServices, s] : f.relatedServices.filter((x) => x !== s))} />)}
            </div>
          </Panel>
          {entry && (
            <Panel title={t("cms.preview.link")}>
              {url ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-link hover:underline" data-testid="cms-open-web"><ExternalLink className="size-4" aria-hidden />{url.replace(/^https?:\/\//, "")}</a> : <p className="text-steel" data-testid="cms-no-preview">{t("cms.preview.none")}</p>}
              <p className="mt-2 text-meta text-steel">{t("cms.author")}: <span dir="auto">{entry.authorName}</span> · {fmtDateTime(entry.updatedAt)}</p>
            </Panel>
          )}
          {id && (
            <Panel title={t("cms.history")}>
              {rev.isPending ? <ListSkeleton rows={2} className="p-0" /> : !rev.data?.length ? <p className="text-steel">{t("cms.history.none")}</p> : (
                <ol className="space-y-1.5" data-testid="cms-revisions">
                  {rev.data.map((r) => (
                    <li key={r.id} className="text-meta">
                      <span className="num font-medium">{t("cms.history.row", { v: r.version, s: L.status(r.status), who: r.changedBy })}</span>
                      <span className="block text-steel"><span className="num">{fmtDateTime(r.createdAt)}</span>{r.note ? ` · ${r.note}` : ""}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          )}
        </div>
      </div>
    </form>
  )
}
