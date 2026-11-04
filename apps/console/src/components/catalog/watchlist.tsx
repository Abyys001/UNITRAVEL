"use client"

import type { CatalogSettings, WatchRoute } from "@unitravel/contracts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"

import { EmptyState, Skeleton, StatusChip, TileError } from "@/components/bento"
import { Check } from "@/components/controls"
import { Section } from "@/components/dev-ui"
import { Field, RouteText } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useT } from "@/lib/i18n"

import { CATALOG, KEYS } from "./shared"

const iata = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3)
const num = (v: string) => (v === "" ? NaN : Number(v))

interface Draft { enabled: boolean; horizonDays: string; maxResults: string; priorityWeight: string; note: string }
const toDraft = (r: WatchRoute): Draft => ({ enabled: r.enabled, horizonDays: String(r.horizonDays), maxResults: r.maxResults == null ? "" : String(r.maxResults), priorityWeight: String(r.priorityWeight), note: r.note })

function RouteRow({ route, settings, canManage }: { route: WatchRoute; settings: CatalogSettings | undefined; canManage: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const [d, setD] = useState(() => toDraft(route))
  useEffect(() => setD(toDraft(route)), [route])
  const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(route))
  const save = useMutation({
    mutationFn: () => api(`${CATALOG}/routes/${route.id}`, { method: "PATCH", body: { enabled: d.enabled, horizonDays: num(d.horizonDays), maxResults: d.maxResults === "" ? null : num(d.maxResults), priorityWeight: num(d.priorityWeight), note: d.note } }),
    onSuccess: () => { toast.success(t("cat.wl.saved")); return qc.invalidateQueries({ queryKey: KEYS.all }) }, onError: (e) => toast.error(errText(e)),
  })
  if (route.kind === "COMBINED") {
    const hubs = settings?.connections.hubs.filter((h) => h.enabled).map((h) => h.iata).join(" / ") || "—"
    return (
      <li className="flex flex-wrap items-center gap-3 px-3 py-2 text-meta" data-testid={`wl-${route.origin}-${route.destination}`}>
        <span className="num font-semibold text-ink"><RouteText>{route.origin} → {route.destination}</RouteText></span>
        <StatusChip tone="info">{t("cat.wl.combined", { hub: hubs })}</StatusChip>
        <span className="text-steel">{t("cat.wl.combinedHint")}</span>
      </li>
    )
  }
  const dis = !canManage
  return (
    <li className="space-y-2 px-3 py-2.5 text-meta" data-testid={`wl-${route.origin}-${route.destination}`}>
      <div className="flex flex-wrap items-end gap-3">
        <span className="num min-w-24 pb-2 font-semibold text-ink"><RouteText>{route.origin} → {route.destination}</RouteText></span>
        <Check label={t("cat.wl.enabled")} checked={d.enabled} disabled={dis} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />
        <Field label={t("cat.wl.horizon")} className="w-24"><input type="number" min={1} max={330} className="field-input num" disabled={dis} value={d.horizonDays} onChange={(e) => setD({ ...d, horizonDays: e.target.value })} /></Field>
        <Field label={t("cat.wl.maxResults")} className="w-28"><input type="number" min={1} max={100} className="field-input num" disabled={dis} placeholder={String(settings?.defaultMaxResults ?? "")} value={d.maxResults} onChange={(e) => setD({ ...d, maxResults: e.target.value })} /></Field>
        <Field label={t("cat.wl.priority")} className="w-24"><input type="number" min={0} max={10} step={0.1} className="field-input num" disabled={dis} value={d.priorityWeight} onChange={(e) => setD({ ...d, priorityWeight: e.target.value })} /></Field>
        <Field label={t("cat.wl.note")} className="min-w-40 flex-1"><input maxLength={300} className="field-input" dir="auto" disabled={dis} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field>
        {canManage && <Button size="xs" variant="outline" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t("common.save")}</Button>}
      </div>
    </li>
  )
}

function AddRoute({ prefill, defaults }: { prefill: { origin: string; destination: string; n: number } | null; defaults: CatalogSettings | undefined }) {
  const t = useT()
  const qc = useQueryClient()
  const [f, setF] = useState({ origin: "", destination: "", horizonDays: "", maxResults: "", priorityWeight: "1", note: "" })
  useEffect(() => { if (prefill) setF((x) => ({ ...x, origin: prefill.origin, destination: prefill.destination })) }, [prefill])
  const bad = f.origin.length !== 3 || f.destination.length !== 3 || f.origin === f.destination
  const add = useMutation({
    mutationFn: () => api(`${CATALOG}/routes`, { body: { origin: f.origin, destination: f.destination, enabled: true, horizonDays: f.horizonDays === "" ? (defaults?.defaultHorizonDays ?? 14) : num(f.horizonDays), maxResults: f.maxResults === "" ? null : num(f.maxResults), priorityWeight: num(f.priorityWeight), note: f.note } }),
    onSuccess: () => { toast.success(t("cat.wl.added")); setF({ origin: "", destination: "", horizonDays: "", maxResults: "", priorityWeight: "1", note: "" }); return qc.invalidateQueries({ queryKey: KEYS.all }) },
    onError: (e) => toast.error(errText(e)),
  })
  return (
    <form className="flex flex-wrap items-end gap-3 border-t border-rule pt-3 text-meta" data-testid="wl-add" onSubmit={(e) => { e.preventDefault(); if (!bad) add.mutate() }}>
      <Field label={t("cat.wl.from")} className="w-20"><input className="field-input num uppercase" dir="ltr" maxLength={3} placeholder="IKA" value={f.origin} onChange={(e) => setF({ ...f, origin: iata(e.target.value) })} /></Field>
      <Field label={t("cat.wl.to")} className="w-20"><input className="field-input num uppercase" dir="ltr" maxLength={3} placeholder="LHR" value={f.destination} onChange={(e) => setF({ ...f, destination: iata(e.target.value) })} /></Field>
      <Field label={t("cat.wl.horizon")} className="w-24"><input type="number" min={1} max={330} className="field-input num" placeholder={String(defaults?.defaultHorizonDays ?? 14)} value={f.horizonDays} onChange={(e) => setF({ ...f, horizonDays: e.target.value })} /></Field>
      <Field label={t("cat.wl.maxResults")} className="w-28"><input type="number" min={1} max={100} className="field-input num" placeholder={String(defaults?.defaultMaxResults ?? "")} value={f.maxResults} onChange={(e) => setF({ ...f, maxResults: e.target.value })} /></Field>
      <Field label={t("cat.wl.priority")} className="w-24"><input type="number" min={0} max={10} step={0.1} className="field-input num" value={f.priorityWeight} onChange={(e) => setF({ ...f, priorityWeight: e.target.value })} /></Field>
      <Field label={t("cat.wl.note")} className="min-w-40 flex-1"><input maxLength={300} className="field-input" dir="auto" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <Button type="submit" size="xs" disabled={bad} loading={add.isPending}>{t("cat.wl.add")}</Button>
    </form>
  )
}

/** Watchlist editor (spec §7.4). COMBINED routes are produced by the connection rules and stay read-only. */
export function WatchlistSection({ settings, canManage, prefill }: { settings: CatalogSettings | undefined; canManage: boolean; prefill: { origin: string; destination: string; n: number } | null }) {
  const t = useT()
  const q = useQuery({ queryKey: KEYS.routes, queryFn: () => api<{ routes: WatchRoute[] }>(`${CATALOG}/routes`) })
  return (
    <Section title={t("cat.wl.title")} hint={t("cat.wl.hint")} id="catalog-watchlist" data-testid="catalog-watchlist">
      {q.error ? <TileError error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-16" /> : (
        <div className="space-y-3">
          {!q.data.routes.length ? <EmptyState title={t("cat.wl.none")} /> : <ul className="divide-y divide-rule rounded-md border border-rule">{q.data.routes.map((r) => <RouteRow key={r.id} route={r} settings={settings} canManage={canManage} />)}</ul>}
          {canManage && <AddRoute prefill={prefill} defaults={settings} />}
        </div>
      )}
    </Section>
  )
}
