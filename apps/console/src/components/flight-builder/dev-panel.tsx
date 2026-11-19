"use client"

import type { FbConnectionState, FlightBuilderSettings, FlightBuilderStatus, ProviderAuthorisationInput, RefreshRequest, SyncRunView } from "@unitravel/contracts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { Skeleton, StatusChip, TileError } from "@/components/bento"
import { Check } from "@/components/controls"
import { DataTable, KV, KVRow, Section } from "@/components/dev-ui"
import { FormDialog } from "@/components/form-dialog"
import { SecretDialog } from "@/components/secret-form"
import { Empty, Field } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import type { Page } from "@/lib/types"

import { asList, FB_DEV, FB_KEYS, LevelBadge, ProblemBox } from "./shared"

const STATE_TONE: Record<FbConnectionState, "ok" | "info" | "warn" | "danger" | "neutral"> = { DISABLED: "neutral", NOT_CONFIGURED: "neutral", AUTHORIZATION_PENDING: "warn", CONFIGURED: "info", CONNECTED: "ok", AUTH_FAILED: "danger", ACCESS_RESTRICTED: "danger" }
export function StatePill({ state }: { state: FbConnectionState }) {
  const t = useT()
  return <StatusChip tone={STATE_TONE[state]}>{t(`fb.state.${state}` as MsgKey)}</StatusChip>
}

export const useFbState = () => useQuery({ queryKey: FB_KEYS.state, queryFn: () => api<FlightBuilderStatus>(`${FB_DEV}/state`) })

const localNow = () => { const d = new Date(); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
/** Every date from first to last inclusive, capped at the API's 31. */
const datesBetween = (a: string, b: string): string[] => {
  const out: string[] = []
  for (let d = new Date(`${a}T00:00:00Z`); d <= new Date(`${b}T00:00:00Z`) && out.length < 32; d.setUTCDate(d.getUTCDate() + 1)) out.push(isoDay(d))
  return out
}

function usePatchSettings() {
  const t = useT()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (patch: Partial<FlightBuilderSettings>) => api(`${FB_DEV}/settings`, { method: "PATCH", body: patch }), onSuccess: async () => { toast.success(t("fb.settings.saved")); await qc.invalidateQueries({ queryKey: FB_KEYS.all }) } })
}

function AuthorisationGate({ s }: { s: FlightBuilderStatus }) {
  const t = useT()
  if (s.gate.allowed) return <div className="rounded-xl border border-success-border bg-success-subtle px-4 py-3 text-meta" role="status" data-testid="fb-gate-open"><strong>{t("fb.gate.open")}</strong> {t("fb.gate.open.desc")}</div>
  return (
    <div className="rounded-xl border-2 border-danger/50 bg-danger-subtle px-4 py-3" role="alert" data-testid="fb-gate-closed">
      <p className="text-lead font-semibold text-danger">{t("fb.gate.closed")}</p>
      <p className="mt-1 text-meta">{t("fb.gate.closed.desc")}</p>
      {s.gate.reason && <p className="mt-1 text-meta text-steel">{t("fb.gate.reason")}: <span className="font-medium text-ink">{t(`fb.gate.${s.gate.reason}` as MsgKey)}</span></p>}
    </div>
  )
}

function CredentialsSection({ s, write }: { s: FlightBuilderStatus; write: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const c = s.credentials
  return (
    <Section title={t("fb.cred.title")} hint={t("fb.cred.hint")}>
      <KV className="text-meta" data-testid="fb-cred">
        <KVRow k={t("fb.cred.status")}>{c.set ? <span className="num font-mono" dir="ltr">•••• ••••</span> : <span className="text-danger">{t("prov.notSet")}</span>}</KVRow>
        <KVRow k={t("apify.key.rotatedAt")}><span className="num">{fmtDateTime(c.rotatedAt)}</span></KVRow>
        <KVRow k={t("apify.key.rotatedBy")}>{c.rotatedBy ?? "—"}</KVRow>
        <KVRow k={t("ae.test.at")}><span className="num">{fmtDateTime(c.testedAt)}</span></KVRow>
      </KV>
      {c.invalidAt && <p role="alert" className="mt-3 rounded-md bg-danger-subtle px-2.5 py-1.5 text-meta text-danger">{t("ae.key.invalid", { t: fmtDateTime(c.invalidAt) })}</p>}
      {write && <div className="mt-4 border-t border-rule pt-4"><Button size="xs" variant="outline" onClick={() => setOpen(true)} data-testid="fb-cred-set">{c.set ? t("apify.key.replace") : t("apify.key.enter")}</Button><p className="mt-2 text-caption text-steel">{t("apify.key.stepUp")} {t("fb.cred.noAuto")}</p></div>}
      <SecretDialog open={open} onOpenChange={setOpen} title={t("fb.cred.dialog")} hintKeys={["username", "password"]} fixedKeys requiredKeys={["username", "password"]} plainKeys={["username"]}
        onSave={async (values) => { await api(`${FB_DEV}/credentials`, { method: "PUT", body: { values } }); await qc.invalidateQueries({ queryKey: FB_KEYS.all }) }} />
    </Section>
  )
}

function PanelUrlSection({ s, write }: { s: FlightBuilderStatus; write: boolean }) {
  const t = useT()
  const patch = usePatchSettings()
  const [url, setUrl] = useState(s.settings.panelUrl ?? "")
  const dirty = url.trim() !== (s.settings.panelUrl ?? "")
  return (
    <Section title={t("fb.url.title")} hint={t("fb.url.hint")}>
      {s.settings.panelUrl
        ? <p className="mb-3 text-meta"><a href={s.settings.panelUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-medium text-link hover:underline" dir="ltr" data-testid="fb-panel-link">{s.settings.panelUrl} ↗</a></p>
        : <p className="mb-3 text-meta text-steel">{t("fb.url.none")}</p>}
      {write && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); patch.mutate({ panelUrl: url.trim() === "" ? null : url.trim() }) }}>
          <Field label={t("fb.url.field")} className="min-w-64 flex-1"><input type="url" className="field-input" dir="ltr" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          <Button type="submit" size="xs" variant="outline" disabled={!dirty} loading={patch.isPending}>{t("common.save")}</Button>
        </form>
      )}
      {patch.error && <div className="mt-3"><ProblemBox error={patch.error} /></div>}
      <p className="mt-2 text-caption text-steel">{t("fb.url.neverFetched")}</p>
    </Section>
  )
}

function AuthorisationSection({ s, canRecord }: { s: FlightBuilderStatus; canRecord: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const a = s.authorisation && !s.authorisation.revokedAt ? s.authorisation : null
  const [rec, setRec] = useState(false)
  const [rev, setRev] = useState(false)
  const blank = () => ({ documentRef: "", grantedByName: "", grantedAt: localNow(), scope: "", maxSearchesPerDay: "", expiresAt: "" })
  const [f, setF] = useState(blank)
  const [reason, setReason] = useState("")
  const done = () => qc.invalidateQueries({ queryKey: FB_KEYS.all })
  return (
    <Section title={t("fb.auth.title")} hint={t("fb.auth.hint")} aside={canRecord && (a
      ? <Button size="xs" variant="outline" className="text-danger" onClick={() => setRev(true)} data-testid="fb-auth-revoke">{t("fb.auth.revoke")}</Button>
      : <Button size="xs" onClick={() => setRec(true)} data-testid="fb-auth-record">{t("fb.auth.record")}</Button>)}>
      {a ? (
        <KV className="text-meta" data-testid="fb-auth">
          <KVRow k={t("fb.auth.docRef")}><span dir="auto" className="break-words">{a.documentRef}</span></KVRow>
          <KVRow k={t("fb.auth.by")}>{a.grantedByName}</KVRow>
          <KVRow k={t("fb.auth.date")}><span className="num">{fmtDate(a.grantedAt)}</span></KVRow>
          <KVRow k={t("fb.auth.scope")}><span dir="auto" className="break-words">{a.scope}</span></KVRow>
          <KVRow k={t("fb.auth.max")}><span className="num">{a.maxSearchesPerDay ?? "—"}</span></KVRow>
          <KVRow k={t("fb.auth.expires")}><span className="num">{a.expiresAt ? fmtDate(a.expiresAt) : t("fb.auth.noExpiry")}</span></KVRow>
          <KVRow k={t("fb.auth.recordedBy")}>{a.recordedBy} · <span className="num">{fmtDateTime(a.recordedAt)}</span></KVRow>
        </KV>
      ) : (
        <div data-testid="fb-auth-none"><Empty>{t("fb.auth.none")}</Empty>{s.authorisation?.revokedAt && <p className="text-center text-meta text-steel">{t("fb.auth.revoked", { at: fmtDateTime(s.authorisation.revokedAt), why: s.authorisation.revokedReason ?? "—" })}</p>}</div>
      )}
      {!canRecord && <p className="mt-2 text-caption text-steel">{t("fb.auth.ownerOnly")}</p>}
      <FormDialog open={rec} onOpenChange={setRec} title={t("fb.auth.record")} description={t("fb.auth.record.desc")} submitLabel={t("fb.auth.record.submit")} testId="fb-auth-dialog"
        onSubmit={async () => {
          const body: ProviderAuthorisationInput = { documentRef: f.documentRef.trim(), grantedByName: f.grantedByName.trim(), grantedAt: new Date(f.grantedAt).toISOString(), scope: f.scope.trim(), ...(f.maxSearchesPerDay ? { maxSearchesPerDay: Number(f.maxSearchesPerDay) } : {}), ...(f.expiresAt ? { expiresAt: new Date(`${f.expiresAt}T23:59:59`).toISOString() } : {}) }
          await api(`${FB_DEV}/authorisations`, { body }); setF(blank()); await done()
        }}>
        <Field label={t("fb.auth.docRef")} hint={t("fb.auth.docRef.hint")}><input required minLength={3} maxLength={200} className="field-input" dir="auto" value={f.documentRef} onChange={(e) => setF({ ...f, documentRef: e.target.value })} /></Field>
        <Field label={t("fb.auth.by")}><input required minLength={2} maxLength={120} className="field-input" dir="auto" value={f.grantedByName} onChange={(e) => setF({ ...f, grantedByName: e.target.value })} /></Field>
        <Field label={t("fb.auth.date")}><input type="datetime-local" required className="field-input num" dir="ltr" value={f.grantedAt} onChange={(e) => setF({ ...f, grantedAt: e.target.value })} /></Field>
        <Field label={t("fb.auth.scope")} hint={t("fb.auth.scope.hint")}><textarea required minLength={3} maxLength={500} className="field-input" dir="auto" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("fb.auth.max")}><input type="number" min={1} step={1} className="field-input num" dir="ltr" value={f.maxSearchesPerDay} onChange={(e) => setF({ ...f, maxSearchesPerDay: e.target.value })} /></Field>
          <Field label={t("fb.auth.expires")}><input type="date" className="field-input num" dir="ltr" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
        </div>
      </FormDialog>
      <FormDialog open={rev} onOpenChange={setRev} destructive title={t("fb.auth.revoke")} description={t("fb.auth.revoke.desc")} submitLabel={t("fb.auth.revoke")}
        onSubmit={async () => { if (!a) return; await api(`${FB_DEV}/authorisations/${a.id}/revoke`, { body: { reason: reason.trim() } }); setReason(""); await done() }}>
        <Field label={t("fb.auth.reason")}><input required minLength={3} maxLength={500} className="field-input" dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </FormDialog>
    </Section>
  )
}

const INTERVALS = ["HOURLY", "DAILY", "WEEKLY"] as const
const MODES = ["DISABLED", "MANUAL", "SCHEDULED"] as const

function SyncSection({ s, write }: { s: FlightBuilderStatus; write: boolean }) {
  const t = useT()
  const patch = usePatchSettings()
  const [mode, setMode] = useState(s.settings.syncMode)
  const [interval, setInterval_] = useState(s.settings.syncInterval)
  const dirty = mode !== s.settings.syncMode || interval !== s.settings.syncInterval
  const r = s.lastRun
  const scheduled = s.settings.syncMode === "SCHEDULED" && s.gate.allowed
  return (
    <Section title={t("fb.sync.title")} hint={t("fb.sync.hint")}>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); patch.mutate({ syncMode: mode, syncInterval: interval }) }}>
        <Field label={t("fb.sync.mode")} className="w-44"><NativeSelect className="field-input" disabled={!write} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} data-testid="fb-sync-mode">{MODES.map((m) => <option key={m} value={m}>{t(`fb.sync.mode.${m}` as MsgKey)}</option>)}</NativeSelect></Field>
        <Field label={t("fb.sync.interval")} className="w-44"><NativeSelect className="field-input" disabled={!write || mode !== "SCHEDULED"} value={interval} onChange={(e) => setInterval_(e.target.value as typeof interval)}>{INTERVALS.map((m) => <option key={m} value={m}>{t(`fb.sync.interval.${m}` as MsgKey)}</option>)}</NativeSelect></Field>
        {write && <Button type="submit" size="xs" variant="outline" disabled={!dirty} loading={patch.isPending} data-testid="fb-sync-save">{t("common.save")}</Button>}
      </form>
      {patch.error && <div className="mt-3" data-testid="fb-sync-error"><ProblemBox error={patch.error} /></div>}
      <KV className="mt-4 text-meta" data-testid="fb-sync-status">
        <KVRow k={t("fb.sync.last")}>{r ? <><StatusChip tone={r.status === "SUCCEEDED" ? "ok" : r.status === "BLOCKED" || r.status === "PARTIAL" ? "warn" : r.status === "FAILED" ? "danger" : "info"}>{t(`fb.run.${r.status}` as MsgKey)}</StatusChip> <span className="num ms-1">{fmtDateTime(r.startedAt)}</span></> : <span className="text-steel">{t("fb.sync.never")}</span>}</KVRow>
        <KVRow k={t("fb.sync.next")}>{scheduled ? <span>{t(`fb.sync.interval.${s.settings.syncInterval}` as MsgKey)}</span> : <span className="text-steel">{t("fb.sync.next.none")}</span>}</KVRow>
        {r && <KVRow k={t("fb.sync.counts")}><span className="num">{t("fb.sync.counts.v", { i: r.imported, u: r.updated, s: r.skipped, e: r.errors })}</span></KVRow>}
        {r?.blockedReason && <KVRow k={t("fb.sync.blocked")}><span className="break-words text-danger">{r.blockedReason}</span></KVRow>}
      </KV>
    </Section>
  )
}

function RefreshSection({ s, write }: { s: FlightBuilderStatus; write: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [blocked, setBlocked] = useState<unknown>(null)
  const today = isoDay(new Date())
  const [f, setF] = useState({ from: "", to: "", first: today, last: today, cabin: "", ack: false })
  const dates = f.first && f.last && f.last >= f.first ? datesBetween(f.first, f.last) : []
  const u = s.latestUsage
  return (
    <Section title={t("fb.refresh.title")} hint={t("fb.refresh.hint")}>
      <div className="flex flex-wrap items-center gap-3">
        {write && <Button size="lg" onClick={() => { setBlocked(null); setOpen(true) }} data-testid="fb-refresh">{t("fb.refresh.button")}</Button>}
        {!s.gate.allowed && <span className="text-meta text-danger">{t("fb.refresh.willBlock")}</span>}
      </div>
      {blocked != null && <div className="mt-3" data-testid="fb-refresh-blocked"><ProblemBox error={blocked} /></div>}
      <FormDialog open={open} onOpenChange={setOpen} wide title={t("fb.refresh.button")} description={t("fb.refresh.confirm.desc")} submitLabel={t("fb.refresh.confirm")} testId="fb-refresh-dialog"
        onSubmit={async () => {
          if (f.from.length !== 3 || f.to.length !== 3) throw new Error(t("fb.refresh.invalid.route"))
          if (!dates.length || dates.length > 31) throw new Error(t("fb.refresh.invalid.dates"))
          if (!f.ack) throw new Error(t("fb.refresh.invalid.ack"))
          const body: RefreshRequest = { scope: { from: f.from, to: f.to, dates, ...(f.cabin ? { cabin: f.cabin as "ECONOMY" } : {}) }, confirm: true }
          try { await api(`${FB_DEV}/refresh`, { body }) } catch (e) { setBlocked(e); throw e } finally { await qc.invalidateQueries({ queryKey: FB_KEYS.all }) }
        }}>
        <div className="rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-meta" role="note" data-testid="fb-refresh-quota">
          <p className="font-semibold">{t("fb.refresh.quota")}</p>
          <p>{t("fb.usage.note")}</p>
          {u ? <p className="mt-1 flex flex-wrap items-center gap-2">{t("fb.refresh.quota.now")} <LevelBadge level={u.level} /> <span className="num">{Math.round(u.ratio * 10) / 10}</span></p> : <p className="mt-1">{t("fb.usage.none.short")}</p>}
          {!s.gate.allowed && <p className="mt-1 font-medium text-danger">{t("fb.refresh.willBlock")}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t("fb.f.from")}><input required className="field-input num uppercase" dir="ltr" maxLength={3} placeholder="IKA" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} /></Field>
          <Field label={t("fb.f.to")}><input required className="field-input num uppercase" dir="ltr" maxLength={3} placeholder="LHR" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} /></Field>
          <Field label={t("fb.refresh.first")}><input type="date" required className="field-input num" dir="ltr" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></Field>
          <Field label={t("fb.refresh.last")}><input type="date" required className="field-input num" dir="ltr" value={f.last} min={f.first} onChange={(e) => setF({ ...f, last: e.target.value })} /></Field>
          <Field label={t("fb.f.cabin")} className="sm:col-span-2">
            <NativeSelect className="field-input" value={f.cabin} onChange={(e) => setF({ ...f, cabin: e.target.value })}>
              <option value="">{t("fb.refresh.anyCabin")}</option>
              {(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] as const).map((c) => <option key={c} value={c}>{t(`fb.cabin.${c}` as MsgKey)}</option>)}
            </NativeSelect>
          </Field>
          <p className="self-end text-meta text-steel sm:col-span-2">{t("fb.refresh.dates", { n: dates.length })}</p>
        </div>
        <Check label={t("fb.refresh.ack")} checked={f.ack} onChange={(e) => setF({ ...f, ack: e.target.checked })} />
      </FormDialog>
    </Section>
  )
}

function RunsSection() {
  const t = useT()
  const q = useQuery({ queryKey: FB_KEYS.runs, queryFn: () => api<SyncRunView[] | Page<SyncRunView>>(`${FB_DEV}/sync-runs`).then(asList) })
  return (
    <Section title={t("fb.runs.title")} flush>
      {q.isError ? <div className="p-4"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <div className="p-4"><Skeleton className="h-16" /></div> : !q.data.length ? <div className="p-4"><Empty>{t("fb.runs.empty")}</Empty></div> : (
        <DataTable data-testid="fb-runs">
          <thead><tr><th scope="col">{t("fb.runs.started")}</th><th scope="col">{t("fb.runs.trigger")}</th><th scope="col">{t("fb.col.status")}</th><th scope="col">{t("fb.runs.scope")}</th><th scope="col">{t("fb.sync.counts")}</th><th scope="col">{t("fb.runs.reason")}</th></tr></thead>
          <tbody>
            {q.data.map((r) => (
              <tr key={r.id}>
                <td className="num">{fmtDateTime(r.startedAt)}</td><td>{t(`fb.runs.trigger.${r.trigger}` as MsgKey)}</td>
                <td><StatusChip tone={r.status === "SUCCEEDED" ? "ok" : r.status === "BLOCKED" || r.status === "PARTIAL" ? "warn" : r.status === "FAILED" ? "danger" : "info"}>{t(`fb.run.${r.status}` as MsgKey)}</StatusChip></td>
                <td className="num max-w-56 break-words" dir="ltr">{scopeText(r.scope)}</td>
                <td className="num">{r.imported}/{r.updated}/{r.skipped}/{r.errors}</td>
                <td className={cn("max-w-64 break-words", r.blockedReason && "text-danger")}>{r.blockedReason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Section>
  )
}
const scopeText = (s: Record<string, unknown>) => {
  const dates = Array.isArray(s.dates) ? (s.dates as string[]) : []
  return `${String(s.from ?? "?")}→${String(s.to ?? "?")}${dates.length ? ` · ${dates[0]}${dates.length > 1 ? `…${dates[dates.length - 1]}` : ""}` : ""}`
}

/** Developer Panel → Flight Builder (ADR-0037): connection state, write-only credentials, the written-permission record that gates any automation, and a refresh that is refused until that gate opens. */
export function FlightBuilderDevPanel() {
  const t = useT()
  const { can } = useSession()
  const q = useFbState()
  const s = q.data
  if (q.isError) return <TileError error={q.error} onRetry={() => void q.refetch()} />
  if (!s) return <Skeleton className="h-40" />
  const write = can("provider.config.write")
  return (
    <div className="space-y-4" data-testid="fb-dev">
      <AuthorisationGate s={s} />
      <Section title={t("fb.state.title")} aside={<StatePill state={s.state} />}>
        <p className="text-meta" data-testid="fb-state-desc">{t(`fb.state.${s.state}.desc` as MsgKey)}</p>
        <p className="mt-2 text-caption text-steel">{t("fb.state.note")}</p>
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <PanelUrlSection key={s.settings.panelUrl ?? ""} s={s} write={write} />
        <CredentialsSection s={s} write={write} />
      </div>
      <AuthorisationSection s={s} canRecord={can("provider.authorisation.record")} />
      <SyncSection key={`${s.settings.syncMode}-${s.settings.syncInterval}`} s={s} write={write} />
      <RefreshSection s={s} write={write} />
      <RunsSection />
    </div>
  )
}

/** Compact card for the providers list. */
export function FlightBuilderCard({ href }: { href: string }) {
  const t = useT()
  const q = useFbState()
  return (
    <Section title={<span className="flex flex-wrap items-center gap-2"><span>{t("fb.dev.title")}</span><span className="rounded-md bg-surface-sunk px-1.5 py-px font-mono text-caption font-normal text-steel" dir="ltr">flight-builder</span></span>} aside={q.data && <StatePill state={q.data.state} />} data-testid="fb-card">
      <p className="text-meta text-steel">{t("fb.dev.desc")}</p>
      {q.data && !q.data.gate.allowed && <p className="mt-2 text-meta font-medium text-danger">{t("fb.gate.closed")}</p>}
      <Link href={href} className="mt-3 inline-block font-medium text-link hover:underline" data-testid="fb-page-link">{t("fb.dev.open")}</Link>
    </Section>
  )
}
