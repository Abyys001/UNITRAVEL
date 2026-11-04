"use client"

import type { BudgetEstimate, CatalogSettings } from "@unitravel/contracts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { Skeleton, StatusChip, TileError } from "@/components/bento"
import { Check } from "@/components/controls"
import { Section } from "@/components/dev-ui"
import { Field } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useT } from "@/lib/i18n"

import { CATALOG, KEYS, usd } from "./shared"

type Settings = CatalogSettings
type SettingsResponse = { settings: Settings; estimate: BudgetEstimate }

export const useCatalogSettings = () => useQuery({ queryKey: KEYS.settings, queryFn: () => api<SettingsResponse>(`${CATALOG}/settings`) })

/** `paused` has its own endpoints and `costCorrection` is raised by the server's reconcile, so neither is part of the editor's patch. */
const toPatch = ({ paused: _p, costCorrection: _c, ...rest }: Settings) => rest
const iata = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3)

/** Numeric input that lets the field be empty while typing and only commits finite numbers. */
function N({ label, value, onChange, step, min, max, hint, className, disabled }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; hint?: string; className?: string; disabled?: boolean }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText((cur) => (Number(cur) === value ? cur : String(value))), [value])
  return (
    <Field label={label} hint={hint} className={className}>
      <input type="number" className="field-input num" value={text} step={step} min={min} max={max} disabled={disabled}
        onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n)) onChange(n) }} />
    </Field>
  )
}

function Estimate({ est, pending, error }: { est: BudgetEstimate | undefined; pending: boolean; error: unknown }) {
  const t = useT()
  return (
    <div className={cn("rounded-lg border p-3 text-meta", est?.overBudget ? "border-danger/40 bg-danger-subtle" : "border-rule bg-surface-sunk")} aria-live="polite" data-testid="budget-estimate">
      <p className="cap">{t("cat.est.title")}</p>
      {error != null ? <p className="text-danger">{errText(error)}</p> : !est ? <Skeleton className="mt-1 h-10" /> : (
        <>
          <dl className={cn("mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4", pending && "opacity-60")}>
            <div><dt className="text-steel">{t("cat.est.rows")}</dt><dd className="num font-semibold">{Math.round(est.rowsPerDay)}</dd></div>
            <div><dt className="text-steel">{t("cat.est.runs")}</dt><dd className="num font-semibold">{est.runsPerDay.toFixed(1)}</dd></div>
            <div><dt className="text-steel">{t("cat.est.monthly")}</dt><dd className={cn("num font-semibold", est.overBudget && "text-danger")}>{usd(est.monthlyUsd)}</dd></div>
            <div><dt className="text-steel">{t("cat.est.spendable")}</dt><dd className="num font-semibold">{usd(est.spendableUsd)}</dd></div>
          </dl>
          {est.overBudget && <p role="alert" className="mt-2 font-medium text-danger" data-testid="estimate-over">{t("cat.est.over")}</p>}
        </>
      )}
    </div>
  )
}

/** Settings editor with a live budget calculator (spec §7.3, §8): every edit asks the API for a fresh estimate, debounced, without saving. */
export function SettingsSection({ canManage }: { canManage: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const q = useCatalogSettings()
  const [draft, setDraft] = useState<Settings | null>(null)
  const [est, setEst] = useState<BudgetEstimate | undefined>()
  const loaded = q.data?.settings
  useEffect(() => { if (loaded) { setDraft(loaded); setEst(q.data?.estimate) } }, [loaded, q.data?.estimate])

  const dirty = !!draft && !!loaded && JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(loaded))
  const estimate = useMutation({ mutationFn: (s: Settings) => api<BudgetEstimate>(`${CATALOG}/estimate`, { body: toPatch(s) }), onSuccess: setEst })
  const { mutate: runEstimate } = estimate
  useEffect(() => {
    if (!draft || !dirty) return
    const h = setTimeout(() => runEstimate(draft), 400)
    return () => clearTimeout(h)
  }, [draft, dirty, runEstimate])

  const save = useMutation({
    mutationFn: (s: Settings) => api<SettingsResponse>(`${CATALOG}/settings`, { method: "PATCH", body: toPatch(s) }),
    onSuccess: () => { toast.success(t("cat.set.saved")); return qc.invalidateQueries({ queryKey: KEYS.all }) },
    onError: (e) => toast.error(errText(e)),
  })
  const hubId = useId()
  const [newHub, setNewHub] = useState("")

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const conn = draft?.connections
  const setConn = (patch: Partial<Settings["connections"]>) => setDraft((d) => (d ? { ...d, connections: { ...d.connections, ...patch } } : d))
  const dis = !canManage
  return (
    <Section title={t("cat.set.title")} hint={t("cat.set.hint")} data-testid="catalog-settings">
      {q.error ? <TileError error={q.error} onRetry={() => void q.refetch()} /> : !draft || !conn ? <Skeleton className="h-24" /> : (
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (canManage && dirty) save.mutate(draft) }}>
          <Estimate est={est} pending={estimate.isPending} error={estimate.error} />

          <fieldset className="space-y-3">
            <legend className="cap mb-1">{t("cat.set.budget")}</legend>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Field label={t("cat.set.source")}>
                <NativeSelect className="field-input" value={draft.source} disabled={dis} onChange={(e) => set("source", e.target.value as Settings["source"])} data-testid="catalog-source">
                  <option value="apify">{t("cat.set.srcApify")}</option>
                  <option value="flightapi">{t("cat.set.srcFlightapi")}</option>
                </NativeSelect>
              </Field>
              <N label={t("cat.set.fapiMonthly")} value={draft.flightapiMonthlyCredits} min={0} onChange={(n) => set("flightapiMonthlyCredits", Math.trunc(n))} disabled={dis} />
              <N label={t("cat.set.fapiReserve")} value={draft.flightapiReserveCredits} min={0} onChange={(n) => set("flightapiReserveCredits", Math.trunc(n))} disabled={dis} />
              <N label={t("cat.set.monthlyBudget")} value={draft.monthlyBudgetUsd} step={0.05} min={0} onChange={(n) => set("monthlyBudgetUsd", n)} disabled={dis} />
              <N label={t("cat.set.safety")} value={draft.safetyMarginUsd} step={0.05} min={0} onChange={(n) => set("safetyMarginUsd", n)} disabled={dis} />
              <N label={t("cat.set.reserve")} value={draft.adminReserveUsd} step={0.05} min={0} onChange={(n) => set("adminReserveUsd", n)} disabled={dis} />
              <N label={t("cat.set.release")} value={draft.releaseReserveHours} min={0} max={240} onChange={(n) => set("releaseReserveHours", n)} disabled={dis} />
              <N label={t("cat.set.ticks")} value={draft.refreshTicksPerDay} min={1} max={48} onChange={(n) => set("refreshTicksPerDay", n)} disabled={dis} />
              <N label={t("cat.set.slotsPerRun")} value={draft.maxSlotsPerRun} min={1} max={200} onChange={(n) => set("maxSlotsPerRun", n)} disabled={dis} />
              <N label={t("cat.set.defaultMax")} value={draft.defaultMaxResults} min={1} max={100} onChange={(n) => set("defaultMaxResults", n)} disabled={dis} />
              <N label={t("cat.set.horizon")} value={draft.defaultHorizonDays} min={1} max={330} onChange={(n) => set("defaultHorizonDays", n)} disabled={dis} />
              <N label={t("cat.set.revalMax")} value={draft.revalidateMaxResults} min={1} max={100} onChange={(n) => set("revalidateMaxResults", n)} disabled={dis} />
              <Field label={t("cat.set.market")}><input className="field-input num uppercase" dir="ltr" maxLength={2} value={draft.market} disabled={dis} onChange={(e) => set("market", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} /></Field>
              <Field label={t("cat.set.currency")}><input className="field-input num uppercase" dir="ltr" maxLength={3} value={draft.currency} disabled={dis} onChange={(e) => set("currency", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} /></Field>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="cap mb-1">{t("cat.set.tiers")}</legend>
            <p className="text-caption text-steel">{t("cat.set.tiersHint")}</p>
            <ul className="space-y-2">
              {draft.tiers.map((tier, i) => {
                const upd = (patch: Partial<typeof tier>) => set("tiers", draft.tiers.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                return (
                  <li key={tier.name + i} className="flex flex-wrap items-end gap-3">
                    <span className="num w-10 pb-2 font-semibold">{tier.name}</span>
                    <N label={t("cat.set.tierDays")} value={tier.maxDaysOut} min={0} max={365} className="w-28" onChange={(n) => upd({ maxDaysOut: n })} disabled={dis} />
                    <N label={t("cat.set.tierHours")} value={tier.intervalHours} min={1} className="w-28" onChange={(n) => upd({ intervalHours: n })} disabled={dis} />
                    <N label={t("cat.set.tierWeight")} value={tier.weight} step={0.1} min={0} max={10} className="w-28" onChange={(n) => upd({ weight: n })} disabled={dis} />
                  </li>
                )
              })}
            </ul>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <N label={t("cat.set.floor")} value={draft.minRefreshIntervalHours} min={0} onChange={(n) => set("minRefreshIntervalHours", n)} disabled={dis} />
              <N label={t("cat.set.hideAfter")} value={draft.hideAfterDays} min={1} max={60} onChange={(n) => set("hideAfterDays", n)} disabled={dis} />
              <N label={t("cat.set.emptyAfter")} value={draft.emptyBackoffAfter} min={1} max={10} onChange={(n) => set("emptyBackoffAfter", n)} disabled={dis} />
              <N label={t("cat.set.emptyMax")} value={draft.emptyBackoffMax} min={1} max={64} onChange={(n) => set("emptyBackoffMax", n)} disabled={dis} />
              <N label={t("cat.set.errAfter")} value={draft.errorSkipAfter} min={1} max={10} onChange={(n) => set("errorSkipAfter", n)} disabled={dis} />
              <N label={t("cat.set.errHours")} value={draft.errorSkipHours} min={1} onChange={(n) => set("errorSkipHours", n)} disabled={dis} />
              <N label={t("cat.set.halfLife")} value={draft.demandHalfLifeDays} step={0.5} min={0.5} onChange={(n) => set("demandHalfLifeDays", n)} disabled={dis} />
            </div>
          </fieldset>

          <fieldset className="space-y-3" data-testid="connection-rules">
            <legend className="cap mb-1">{t("cat.con.title")}</legend>
            <p className="text-caption text-steel">{t("cat.con.hint")}</p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="text-meta font-medium">{t("cat.con.hubs")}</span>
              {conn.hubs.map((h) => <Check key={h.iata} label={h.iata} checked={h.enabled} disabled={dis} onChange={(e) => setConn({ hubs: conn.hubs.map((x) => (x.iata === h.iata ? { ...x, enabled: e.target.checked } : x)) })} />)}
              {canManage && (
                <span className="flex items-center gap-1.5">
                  <input id={hubId} aria-label={t("cat.con.addHub")} className="field-input num w-20 uppercase" dir="ltr" maxLength={3} placeholder="SAW" value={newHub} onChange={(e) => setNewHub(iata(e.target.value))} />
                  <Button type="button" size="xs" variant="outline" disabled={newHub.length !== 3 || conn.hubs.some((h) => h.iata === newHub)} onClick={() => { setConn({ hubs: [...conn.hubs, { iata: newHub, enabled: true }] }); setNewHub("") }}>{t("cat.con.addHub")}</Button>
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <N label={t("cat.con.minLayover")} value={conn.minLayoverMin} min={30} max={1440} hint={t("cat.con.minutes")} onChange={(n) => setConn({ minLayoverMin: n })} disabled={dis} />
              <N label={t("cat.con.maxLayover")} value={conn.maxLayoverMin} min={30} max={2880} hint={t("cat.con.minutes")} onChange={(n) => setConn({ maxLayoverMin: n })} disabled={dis} />
            </div>
            {conn.maxLayoverMin < conn.minLayoverMin && <p role="alert" className="text-meta text-danger">{t("cat.con.layoverBad")}</p>}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <Check label={t("cat.con.sameAirport")} checked={conn.sameAirport} disabled={dis} onChange={(e) => setConn({ sameAirport: e.target.checked })} />
              <Check label={t("cat.con.overnight")} checked={conn.allowOvernight} disabled={dis} onChange={(e) => setConn({ allowOvernight: e.target.checked })} />
              <span className="text-meta font-medium">{t("cat.con.offsets")}</span>
              {[0, 1, 2].map((o) => (
                <Check key={o} label={o === 0 ? t("cat.con.sameDay") : `+${o}`} checked={conn.dayOffsets.includes(o)} disabled={dis}
                  onChange={(e) => { const next = e.target.checked ? [...conn.dayOffsets, o].sort() : conn.dayOffsets.filter((x) => x !== o); if (next.length) setConn({ dayOffsets: next }) }} />
              ))}
            </div>
            <div>
              <p className="mb-1 text-meta font-medium">{t("cat.con.pairs")}</p>
              <ul className="space-y-2">
                {conn.pairs.map((p, i) => {
                  const upd = (patch: Partial<typeof p>) => setConn({ pairs: conn.pairs.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      {(["from", "via", "to"] as const).map((k) => <input key={k} aria-label={t(`cat.con.${k}`, { n: i + 1 })} className="field-input num w-20 uppercase" dir="ltr" maxLength={3} disabled={dis} value={p[k]} onChange={(e) => upd({ [k]: iata(e.target.value) })} />)}
                      <Check label={t("cat.wl.enabled")} checked={p.enabled} disabled={dis} onChange={(e) => upd({ enabled: e.target.checked })} />
                      {canManage && <Button type="button" variant="ghost" size="icon-sm" className="text-steel hover:text-danger" aria-label={t("cat.con.removePair", { n: i + 1 })} onClick={() => setConn({ pairs: conn.pairs.filter((_, j) => j !== i) })}><Trash2 aria-hidden /></Button>}
                    </li>
                  )
                })}
              </ul>
              {canManage && <Button type="button" size="xs" variant="outline" className="mt-2" onClick={() => setConn({ pairs: [...conn.pairs, { from: "", via: "", to: "", enabled: true }] })}>{t("cat.con.addPair")}</Button>}
            </div>
            <StatusChip tone="info" className="whitespace-normal">{t("cat.con.label")}</StatusChip>
          </fieldset>

          {canManage ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
              <Button type="submit" size="sm" disabled={!dirty} loading={save.isPending} data-testid="settings-save">{t("common.save")}</Button>
              <Button type="button" size="sm" variant="ghost" disabled={!dirty} onClick={() => { setDraft(loaded!); setEst(q.data?.estimate) }}>{t("cat.set.reset")}</Button>
              {est?.overBudget && dirty && <span className="text-meta text-danger">{t("cat.est.over")}</span>}
              <span className="text-caption text-steel">{t("cat.set.stepUp")}</span>
            </div>
          ) : <p className="text-caption text-steel">{t("cat.set.readOnly")}</p>}
        </form>
      )}
    </Section>
  )
}
