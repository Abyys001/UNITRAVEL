"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { notFound, useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { CONFIG_SCHEMAS, type SearchState } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { CONFIG_DOMAINS } from "@/components/dev-frame"
import { FormDialog } from "@/components/form-dialog"
import { changedPaths, friendlyIssue, type Issue, SchemaForm } from "@/components/schema-form"
import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { DevPage, Section } from "@/components/dev-ui"
import { ErrorLine, Field, Loading, PageHead, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, minutes, money } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Version { id: string; domain: string; version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"; payload: unknown; changeNote: string | null; createdBy: string; publishedBy: string | null; publishedAt: string | null; createdAt: string }
interface SimSide { count: number; stats: Record<string, number>; top: { id: string; construction: string; ticketing: string; price: { amountMinor: number; currency: string }; durationMin: number; score: number; route: string; flags: string[] }[] }
interface SimResult { searchId: string; supplierCallsMade: number; cachedCalls: number; published: SimSide; draft: SimSide }

/** Versioned configuration (ch. 16.1 "Change safety"): draft → validate → simulate → publish, previous version one click away. */
export default function ConfigPage() {
  const { slug } = useParams<{ slug: string }>()
  const def = CONFIG_DOMAINS.find((d) => d.slug === slug)
  if (!def) notFound()
  const domain = def.domain
  const qc = useQueryClient()
  const { can } = useSession()
  const t = useT()
  const versions = useQuery({ queryKey: ["config", domain], queryFn: () => api<Version[]>(`/v1/dev/config/${domain}/versions`) })
  const published = versions.data?.find((v) => v.status === "PUBLISHED")
  const [base, setBase] = useState<Version | null>(null)
  const [draft, setDraft] = useState<unknown>(null)
  const [note, setNote] = useState("")
  const [savedVersion, setSavedVersion] = useState<number | null>(null)
  const [publishOf, setPublishOf] = useState<Version | null>(null)
  const [publishNote, setPublishNote] = useState("")
  // Keyed on the published version id: after a publish or roll back the form must follow the version now in force,
  // otherwise saving would resurrect the previous payload. A plain refetch (same id) keeps in-progress edits.
  const publishedId = published?.id
  useEffect(() => { if (published) { setBase(published); setDraft(structuredClone(published.payload)); setSavedVersion(null); setSim(null) } }, [publishedId]) // eslint-disable-line react-hooks/exhaustive-deps
  const issues: Issue[] = useMemo(() => {
    if (draft == null) return []
    const r = CONFIG_SCHEMAS[domain].safeParse(draft)
    return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
  }, [draft, domain])

  const changes = useMemo(() => (published && draft ? changedPaths(published.payload, draft) : []), [published, draft])
  const canWrite = can(domain === "ENGINE_RULES" || domain === "HUBS" ? "engine.rules.publish" : domain === "NOTIFICATION_MATRIX" ? "notification.template.write" : "settings.write")
  const simulable = domain === "ENGINE_RULES" || domain === "HUBS"

  const [saving, setSaving] = useState(false)
  const saveDraft = async () => {
    setSaving(true)
    try {
      const v = await api<Version>(`/v1/dev/config/${domain}/versions`, { body: { payload: draft, changeNote: note || undefined } })
      setSavedVersion(v.version); toast.success(t("cfg.draftSaved", { v: v.version }))
      await qc.invalidateQueries({ queryKey: ["config", domain] })
    } catch (e) { toast.error(errText(e)) } finally { setSaving(false) }
  }

  // Simulation runs against a stored search's cached supplier responses — no new supplier calls.
  const [sample, setSample] = useState({ from: "THR", to: "LON", date: new Date(Date.now() + 21 * 86400_000).toISOString().slice(0, 10), searchId: "" })
  const [sim, setSim] = useState<SimResult | null>(null)
  const [simErr, setSimErr] = useState<unknown>(null)
  const [simBusy, setSimBusy] = useState(false)
  const simulate = async () => {
    setSimBusy(true); setSimErr(null); setSim(null)
    try {
      let searchId = sample.searchId.trim()
      if (!searchId) {
        const s = await api<{ id: string }>("/v1/admin/flight-searches", { body: { tripType: "ONE_WAY", cabin: "ECONOMY", slices: [{ from: { city: sample.from.toUpperCase() }, to: { city: sample.to.toUpperCase() }, date: sample.date, flexDays: 0 }], passengers: [{ type: "ADT" }], preferences: { allowSelfTransfer: true, allowAirportChange: false, allowOvernight: true, maxStops: 2, nearestCabin: false, studentFare: false } } })
        for (let i = 0; i < 40; i++) {
          const st = await api<SearchState>(`/v1/admin/flight-searches/${s.id}?limit=1`)
          if (st.status !== "RUNNING") break
          await new Promise((r) => setTimeout(r, 750))
        }
        searchId = s.id
        setSample((x) => ({ ...x, searchId }))
      }
      setSim(await api<SimResult>(`/v1/dev/config/${domain}/simulate`, { body: { searchId, payload: draft } }))
    } catch (e) { setSimErr(e) } finally { setSimBusy(false) }
  }

  if (versions.error) return <div className="p-4 md:p-6"><TileError error={versions.error} onRetry={() => void versions.refetch()} /></div>
  if (!versions.data) return <><Loading /><ListSkeleton rows={6} /></>
  const step = issues.length ? 1 : !savedVersion ? 2 : simulable && !sim ? 3 : 4
  const steps = [t("cfg.s.edit"), t("cfg.s.validate"), t("cfg.s.save"), ...(simulable ? [t("cfg.s.simulate")] : []), t("cfg.s.publish")]
  return (
    <div className="pb-10">
      <PageHead kicker={<>{t("dpage.config")} · <span dir="ltr">{domain}</span></>} title={t(`dnav.${def.slug}` as MsgKey)}>
        <span className="rounded-full border border-success-border bg-success-subtle px-2.5 py-0.5 text-meta text-success-subtle-fg">{t("cfg.inForce", { v: published?.version ?? "—" })}{published?.publishedAt && ` · ${t("cfg.since", { at: fmtDateTime(published.publishedAt) })}`}</span>
      </PageHead>
      <DevPage>
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-rule bg-surface-raised px-4 py-3 text-meta" aria-label={t("cfg.steps")}>
          {steps.map((s, i) => <li key={s} aria-current={i + 1 === step ? "step" : undefined} className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1", i + 1 < step ? "border-success-border bg-success-subtle text-success-subtle-fg" : i + 1 === step ? "border-navy-900 bg-navy-900 text-white dark:border-white/80 dark:bg-white/90 dark:text-navy-950" : "border-rule-strong text-steel")}><span className="num text-caption">{i + 1}</span>{s}</li>)}
        </ol>
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            <Section title={t("cfg.draftFrom", { v: base?.version ?? "—" })} hint={t("cfg.draftHint")} aside={<span className={cn("rounded-full px-2.5 py-0.5", issues.length ? "bg-danger-subtle text-danger" : "bg-success-subtle text-success-subtle-fg")} data-testid="validation">{issues.length ? t("cfg.issues", { n: issues.length }) : t("cfg.valid")}</span>}>
              {draft != null && <SchemaForm value={draft as never} onChange={(v) => { setDraft(v); setSavedVersion(null); setSim(null) }} issues={issues} />}
              {issues.length > 0 && <ul className="mt-4 rounded-lg border border-danger bg-danger-subtle p-3 text-meta text-danger">{issues.slice(0, 8).map((i) => <li key={i.path + i.message}><span className="font-mono" dir="ltr">{i.path || "(root)"}</span>: {friendlyIssue(i.message, t)}</li>)}</ul>}
              {changes.length > 0 && <p className="mt-4 text-meta text-steel">{t("cfg.changed", { v: published?.version ?? "—" })} <span className="font-mono" dir="ltr">{changes.slice(0, 12).join(", ")}{changes.length > 12 ? ` +${changes.length - 12}` : ""}</span></p>}
              {canWrite && (
                <div className="-mx-4 mt-5 -mb-4 flex flex-wrap items-end gap-2 border-t border-rule bg-surface-sunk px-4 py-3 md:-mx-5 md:-mb-5 md:px-5">
                  <Field label={t("cfg.note")} className="min-w-64 flex-1"><input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("cfg.notePh")} /></Field>
                  <Button size="sm" variant="outline" disabled={!!issues.length || !changes.length} loading={saving} onClick={() => void saveDraft()}>{t("cfg.saveDraft")}</Button>
                  {savedVersion && <Button size="sm" onClick={() => { setPublishOf(versions.data!.find((v) => v.version === savedVersion) ?? null); setPublishNote(note) }} disabled={simulable && !sim}>{t("cfg.publishV", { v: savedVersion })}</Button>}
                  {simulable && savedVersion && !sim && <span className="pb-1.5 text-meta text-steel">{t("cfg.simFirst")}</span>}
                </div>
              )}
            </Section>
            {simulable && (
              <Section title={t("cfg.simTitle")} hint={t("cfg.simHint")}>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={t("cfg.from")} className="w-24"><input className="field-input font-mono uppercase" value={sample.from} onChange={(e) => setSample({ ...sample, from: e.target.value, searchId: "" })} dir="ltr" /></Field>
                  <Field label={t("cfg.to")} className="w-24"><input className="field-input font-mono uppercase" value={sample.to} onChange={(e) => setSample({ ...sample, to: e.target.value, searchId: "" })} dir="ltr" /></Field>
                  <Field label={t("cfg.date")} className="w-40"><input type="date" className="field-input" value={sample.date} onChange={(e) => setSample({ ...sample, date: e.target.value, searchId: "" })} /></Field>
                  <Field label={t("cfg.searchId")} className="min-w-64 flex-1"><input className="field-input font-mono" value={sample.searchId} onChange={(e) => setSample({ ...sample, searchId: e.target.value })} dir="ltr" /></Field>
                  <Button size="sm" onClick={() => void simulate()} loading={simBusy} disabled={!!issues.length}>{t("cfg.s.simulate")}</Button>
                </div>
                <div className="mt-3"><ErrorLine error={simErr} /></div>
                {sim && (
                  <div className="mt-4" data-testid="simulation">
                    <p className="text-meta text-steel">{t("cfg.simRan", { id: sim.searchId.slice(0, 8), n: sim.cachedCalls })} <b className="text-ink">{t("cfg.simCalls", { n: sim.supplierCallsMade })}</b></p>
                    <div className="mt-3 grid gap-4 lg:grid-cols-2">
                      {(["published", "draft"] as const).map((side) => (
                        <div key={side} className={cn("rounded-lg border bg-surface p-3", side === "draft" ? "border-orange" : "border-rule")}>
                          <p className="flex justify-between"><span className="font-semibold">{side === "draft" ? "Draft" : t("cfg.publishedV", { v: published?.version ?? "—" })}</span><span className="num text-steel">{t("cfg.results", { n: sim[side].count })}</span></p>
                          <p className="mt-0.5 font-mono text-caption text-steel" dir="ltr">{Object.entries(sim[side].stats).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
                          <ol className="mt-2 divide-y divide-rule">{sim[side].top.slice(0, 8).map((x, i) => <li key={x.id} className="py-1.5 text-meta"><span className="num">{i + 1}. {money(x.price)} · {minutes(x.durationMin)} · {t("cfg.score")} {x.score.toFixed(3)}</span><span className="block truncate font-mono text-caption text-steel" dir="ltr" title={x.route}>{x.construction} · {x.route}</span></li>)}</ol>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Section>
            )}
          </div>
          <Section title={t("cfg.versions")} flush className="xl:sticky xl:top-20">
            {!versions.data.length ? <EmptyState title={t("cfg.noVersions")} /> : (
              <ol className="max-h-[70dvh] divide-y divide-rule overflow-y-auto" data-testid="versions">
                {versions.data.map((v) => (
                  <li key={v.id} className={cn("px-4 py-3 md:px-5", v.id === base?.id && "bg-hover/50")}>
                    <p className="flex items-center justify-between"><span className="num font-semibold">v{v.version}</span><Tag value={v.status} /></p>
                    <p className="mt-0.5 text-meta">{v.changeNote ?? <span className="text-steel">{t("cfg.noNote")}</span>}</p>
                    <p className="text-caption text-steel">{v.publishedAt ? t("cfg.publishedAt", { at: fmtDateTime(v.publishedAt) }) : t("cfg.draftedAt", { at: fmtDateTime(v.createdAt) })}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Button size="xs" variant="ghost" onClick={() => { setBase(v); setDraft(structuredClone(v.payload)); setSavedVersion(v.status === "DRAFT" ? v.version : null); setSim(null) }}>{t("cfg.load")}</Button>
                      {canWrite && v.status === "DRAFT" && <Button size="xs" variant="outline" onClick={() => { setPublishOf(v); setPublishNote(v.changeNote ?? "") }}>{t("cfg.publish")}</Button>}
                      {canWrite && v.status === "SUPERSEDED" && <Button size="xs" variant="outline" onClick={() => { setPublishOf(v); setPublishNote("") }}>{t("cfg.rollback")}</Button>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </DevPage>
      <FormDialog open={!!publishOf} onOpenChange={(o) => !o && setPublishOf(null)} title={publishOf?.status === "SUPERSEDED" ? t("cfg.rollbackTitle", { v: publishOf.version }) : t("cfg.publishTitle", { v: publishOf?.version ?? "" })}
        description={t("cfg.publishBody")} submitLabel={publishOf?.status === "SUPERSEDED" ? t("cfg.rollbackLabel") : t("cfg.publishLabel")} testId="dlg-publish"
        onSubmit={async () => { await api(`/v1/dev/config/${domain}/versions/${publishOf!.version}/publish`, { body: { changeNote: publishNote } }); await qc.invalidateQueries({ queryKey: ["config", domain] }) }}>
        <Field label={t("cfg.noteReq")}><textarea className="field-input min-h-20" value={publishNote} onChange={(e) => setPublishNote(e.target.value)} minLength={5} required /></Field>
      </FormDialog>
    </div>
  )
}
