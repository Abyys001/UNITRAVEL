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
import { changedPaths, type Issue, SchemaForm } from "@/components/schema-form"
import { Empty, ErrorLine, Field, Loading, PageHead, Panel, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, minutes, money } from "@/lib/format"
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
  const versions = useQuery({ queryKey: ["config", domain], queryFn: () => api<Version[]>(`/v1/dev/config/${domain}/versions`) })
  const published = versions.data?.find((v) => v.status === "PUBLISHED")
  const [base, setBase] = useState<Version | null>(null)
  const [draft, setDraft] = useState<unknown>(null)
  const [note, setNote] = useState("")
  const [savedVersion, setSavedVersion] = useState<number | null>(null)
  const [publishOf, setPublishOf] = useState<Version | null>(null)
  const [publishNote, setPublishNote] = useState("")
  useEffect(() => { if (published && !base) { setBase(published); setDraft(structuredClone(published.payload)) } }, [published, base])
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
      setSavedVersion(v.version); toast.success(`Draft v${v.version} saved`)
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

  if (versions.error) return <div className="p-5"><ErrorLine error={versions.error} /></div>
  if (!versions.data) return <Loading />
  const step = issues.length ? 1 : !savedVersion ? 2 : simulable && !sim ? 3 : 4
  return (
    <div className="pb-10">
      <PageHead kicker={<>Configuration · {domain} · in force: v{published?.version ?? "—"}{published?.publishedAt && ` since ${fmtDateTime(published.publishedAt)}`}</>} title={def.label}>
        <ol className="flex items-center gap-1 font-mono text-[11px]" aria-label="Change steps">
          {["Edit draft", "Validate", "Save", ...(simulable ? ["Simulate"] : []), "Publish"].map((s, i) => <li key={s} className={cn("rounded-sm border px-1.5 py-0.5", i + 1 < step ? "border-moss text-moss" : i + 1 === step ? "border-ink bg-ink text-paper" : "border-rule-strong text-slate")}>{i + 1} {s}</li>)}
        </ol>
      </PageHead>
      <div className="grid gap-x-6 px-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Panel title={`Draft from v${base?.version ?? "—"}`} aside={<span className={cn("font-mono text-[11px]", issues.length ? "text-brick" : "text-moss")} data-testid="validation">{issues.length ? `${issues.length} validation issue${issues.length === 1 ? "" : "s"}` : "valid against the API schema"}</span>}>
            {draft != null && <SchemaForm value={draft as never} onChange={(v) => { setDraft(v); setSavedVersion(null); setSim(null) }} issues={issues} />}
          </Panel>
          {issues.length > 0 && <ul className="mb-2 rounded-sm border border-brick bg-[#fbeee9] p-2 text-[12px] text-brick">{issues.slice(0, 8).map((i) => <li key={i.path + i.message}><span className="font-mono">{i.path || "(root)"}</span>: {i.message}</li>)}</ul>}
          {canWrite && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Change note" className="min-w-72 flex-1"><input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What and why" /></Field>
              <Button size="sm" variant="outline" disabled={!!issues.length || !changes.length} loading={saving} onClick={() => void saveDraft()}>Save draft</Button>
              {savedVersion && <Button size="sm" onClick={() => { setPublishOf(versions.data!.find((v) => v.version === savedVersion) ?? null); setPublishNote(note) }} disabled={simulable && !sim}>Publish v{savedVersion}…</Button>}
              {simulable && savedVersion && !sim && <span className="pb-1.5 text-[11px] text-slate">Simulate before publishing</span>}
            </div>
          )}
          {changes.length > 0 && <p className="mt-2 text-[12px] text-slate">Changed from v{published?.version}: <span className="font-mono">{changes.slice(0, 12).join(", ")}{changes.length > 12 ? ` +${changes.length - 12}` : ""}</span></p>}
          {simulable && (
            <Panel title="Simulate · published vs draft" className="mt-4">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="From" className="w-20"><input className="field-input font-mono uppercase" value={sample.from} onChange={(e) => setSample({ ...sample, from: e.target.value, searchId: "" })} /></Field>
                <Field label="To" className="w-20"><input className="field-input font-mono uppercase" value={sample.to} onChange={(e) => setSample({ ...sample, to: e.target.value, searchId: "" })} /></Field>
                <Field label="Date" className="w-36"><input type="date" className="field-input" value={sample.date} onChange={(e) => setSample({ ...sample, date: e.target.value, searchId: "" })} /></Field>
                <Field label="…or a stored search id" className="w-80"><input className="field-input font-mono" value={sample.searchId} onChange={(e) => setSample({ ...sample, searchId: e.target.value })} dir="ltr" /></Field>
                <Button size="sm" onClick={() => void simulate()} loading={simBusy} disabled={!!issues.length}>Simulate</Button>
              </div>
              <ErrorLine error={simErr} />
              {sim && (
                <div className="mt-3" data-testid="simulation">
                  <p className="text-slate">Search <span className="font-mono">{sim.searchId.slice(0, 8)}</span> · {sim.cachedCalls} cached supplier responses · <b>{sim.supplierCallsMade}</b> new supplier calls</p>
                  <div className="mt-2 grid gap-4 lg:grid-cols-2">
                    {(["published", "draft"] as const).map((side) => (
                      <div key={side} className={cn("rounded-md border bg-white p-2", side === "draft" ? "border-copper" : "border-rule")}>
                        <p className="flex justify-between"><span className="cap">{side === "draft" ? "Draft" : `Published v${published?.version}`}</span><span className="num">{sim[side].count} results</span></p>
                        <p className="font-mono text-[10.5px] text-slate">{Object.entries(sim[side].stats).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
                        <ol className="ledger-rows mt-1">{sim[side].top.slice(0, 8).map((t, i) => <li key={t.id} className="py-1 text-[12px]"><span className="num">{i + 1}. {money(t.price)} · {minutes(t.durationMin)} · score {t.score.toFixed(3)}</span><span className="block truncate font-mono text-[10.5px] text-slate" title={t.route}>{t.construction} · {t.route}</span></li>)}</ol>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          )}
        </div>
        <Panel title="Versions">
          {!versions.data.length ? <Empty>No versions.</Empty> : (
            <ol className="ledger-rows" data-testid="versions">
              {versions.data.map((v) => (
                <li key={v.id} className="py-1.5">
                  <p className="flex items-center justify-between"><span className="num font-medium">v{v.version}</span><Tag value={v.status} /></p>
                  <p className="text-[12px]">{v.changeNote ?? <span className="text-slate">no note</span>}</p>
                  <p className="text-[11px] text-slate">{v.publishedAt ? `published ${fmtDateTime(v.publishedAt)}` : `drafted ${fmtDateTime(v.createdAt)}`}</p>
                  <div className="mt-1 flex gap-1">
                    <Button size="xs" variant="ghost" onClick={() => { setBase(v); setDraft(structuredClone(v.payload)); setSavedVersion(v.status === "DRAFT" ? v.version : null); setSim(null) }}>Load</Button>
                    {canWrite && v.status === "DRAFT" && <Button size="xs" variant="outline" onClick={() => { setPublishOf(v); setPublishNote(v.changeNote ?? "") }}>Publish…</Button>}
                    {canWrite && v.status === "SUPERSEDED" && <Button size="xs" variant="outline" onClick={() => { setPublishOf(v); setPublishNote("") }}>Roll back to this…</Button>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
      <FormDialog open={!!publishOf} onOpenChange={(o) => !o && setPublishOf(null)} title={publishOf?.status === "SUPERSEDED" ? `Roll back to v${publishOf.version}…` : `Publish v${publishOf?.version}…`}
        description="Every API and worker process reloads within seconds. Publishing needs a second-factor check in the last 10 minutes and a change note." submitLabel={publishOf?.status === "SUPERSEDED" ? "Roll back" : "Publish"} testId="dlg-publish"
        onSubmit={async () => { await api(`/v1/dev/config/${domain}/versions/${publishOf!.version}/publish`, { body: { changeNote: publishNote } }); setSavedVersion(null); setSim(null); setBase(null); await qc.invalidateQueries({ queryKey: ["config", domain] }) }}>
        <Field label="Change note (mandatory)"><textarea className="field-input min-h-20" value={publishNote} onChange={(e) => setPublishNote(e.target.value)} minLength={5} required /></Field>
      </FormDialog>
    </div>
  )
}
