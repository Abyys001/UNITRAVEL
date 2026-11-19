"use client"

import type { FlightBuilderUsage, UsageObservationInput, UsageSource } from "@unitravel/contracts"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useMemo, useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { Skeleton, StatusChip, TileError } from "@/components/bento"
import { BarChart, LineArea, useNum } from "@/components/charts"
import { DataTable, Section } from "@/components/dev-ui"
import { FormDialog } from "@/components/form-dialog"
import { Empty, Field } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"

import { FB, FB_KEYS, LevelBadge, levelTone, useFbUsage } from "./shared"

const BAR: Record<string, string> = { OK: "bg-success", WARNING: "bg-warning", CRITICAL: "bg-danger", UNKNOWN: "bg-steel/40" }
const SOURCE_TONE: Record<UsageSource, "info" | "neutral" | "warn"> = { MANUAL: "info", REPORTED: "neutral", ESTIMATED: "warn" }

/** Latest observation's own thresholds, so a changed limit shows correctly; 45 and 50 are the documented defaults. */
const thresholdsOf = (u: FlightBuilderUsage) => {
  const latest = [...u.observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]
  return { warn: latest?.warningThreshold ?? 45, crit: latest?.criticalThreshold ?? 50 }
}

/** Progress bar of the scan-hits-per-booking ratio with markers at the warning and indicative limit. */
export function RatioGauge({ ratio, level, warn, crit }: { ratio: number; level: string; warn: number; crit: number }) {
  const t = useT()
  const max = Math.max(ratio, crit) * 1.15
  const pct = (n: number) => `${Math.min(100, (n / max) * 100)}%`
  return (
    <div>
      <div role="meter" aria-valuemin={0} aria-valuemax={crit} aria-valuenow={Math.round(ratio * 10) / 10} aria-label={t("fb.usage.ratio")} className="relative h-3 overflow-hidden rounded-full bg-surface-sunk ring-1 ring-rule">
        <div className={cn("h-full rounded-full transition-[width]", BAR[level])} style={{ width: pct(ratio) }} />
      </div>
      <div className="relative mt-1 h-8 text-caption text-steel">
        <span className="absolute -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: pct(warn) }}><span aria-hidden className="mx-auto block h-1.5 w-px bg-warning" /><span className="num">{t("fb.usage.warnAt", { n: warn })}</span></span>
        <span className="absolute -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: pct(crit) }}><span aria-hidden className="mx-auto block h-1.5 w-px bg-danger" /><span className="num">{t("fb.usage.limitAt", { n: crit })}</span></span>
      </div>
    </div>
  )
}

/** One-line banner used at the top of the options list. */
export function QuotaBanner() {
  const t = useT()
  const q = useFbUsage()
  const fmt = useNum()
  if (q.isError || q.isPending) return null
  const l = q.data.latest
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 text-meta", l?.level === "CRITICAL" ? "border-danger/40 bg-danger-subtle" : l?.level === "WARNING" ? "border-warning-border bg-warning-subtle" : "border-rule bg-surface-raised")} data-testid="fb-quota-banner" role={l && l.level !== "OK" ? "alert" : "status"}>
      {!l ? <span className="text-steel">{t("fb.usage.none.short")}</span> : (
        <>
          <LevelBadge level={l.level} />
          <span>{t("fb.banner.ratio", { n: fmt(Math.round(l.ratio * 10) / 10) })}</span>
          {l.level === "CRITICAL" && <strong className="text-danger">{t("fb.banner.critical")}</strong>}
          {l.stale && <StatusChip tone="warn">{t("fb.usage.stale")}</StatusChip>}
          <span className="text-steel">{t("fb.usage.lastObs")}: {rel(l.observedAt)}</span>
        </>
      )}
      <Link href="/catalog/flight-builder/usage" className="ms-auto font-medium text-link hover:underline">{t("fb.banner.details")}</Link>
    </div>
  )
}

export function UsageNote() {
  const t = useT()
  return <p className="rounded-md bg-surface-sunk px-3 py-2 text-meta text-steel" data-testid="fb-usage-note">{t("fb.usage.note")}</p>
}

const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const intOrNaN = (v: string) => (v.trim() === "" ? NaN : Number(v))

export function RecordObservation({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const blank = () => ({ observedAt: localNow(), bookings: "", scanHits: "", warn: "45", crit: "50", remaining: "", source: "MANUAL" as UsageSource, note: "" })
  const [f, setF] = useState(blank)
  const b = intOrNaN(f.bookings), h = intOrNaN(f.scanHits)
  return (
    <FormDialog open={open} onOpenChange={(o) => { if (!o) setF(blank()); onOpenChange(o) }} title={t("fb.usage.record")} description={t("fb.usage.record.desc")} submitLabel={t("fb.usage.record.submit")} testId="fb-obs-dialog"
      onSubmit={async () => {
        if (!Number.isInteger(b) || !Number.isInteger(h) || b < 0 || h < 0) throw new Error(t("fb.usage.record.invalid"))
        const rem = intOrNaN(f.remaining)
        const body: UsageObservationInput = { observedAt: new Date(f.observedAt).toISOString(), bookings: b, scanHits: h, warningThreshold: Number(f.warn), criticalThreshold: Number(f.crit), source: f.source, ...(Number.isInteger(rem) ? { remainingReported: rem } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}) }
        await api(`${FB}/usage`, { body })
        await qc.invalidateQueries({ queryKey: FB_KEYS.all })
        setF(blank())
      }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("fb.usage.col.at")} className="sm:col-span-2"><input type="datetime-local" required className="field-input num" dir="ltr" value={f.observedAt} onChange={(e) => setF({ ...f, observedAt: e.target.value })} /></Field>
        <Field label={t("fb.usage.bookings")}><input type="number" min={0} step={1} required inputMode="numeric" className="field-input num" dir="ltr" value={f.bookings} onChange={(e) => setF({ ...f, bookings: e.target.value })} /></Field>
        <Field label={t("fb.usage.hits")}><input type="number" min={0} step={1} required inputMode="numeric" className="field-input num" dir="ltr" value={f.scanHits} onChange={(e) => setF({ ...f, scanHits: e.target.value })} /></Field>
        <Field label={t("fb.usage.warnThreshold")}><input type="number" min={1} step={1} required className="field-input num" dir="ltr" value={f.warn} onChange={(e) => setF({ ...f, warn: e.target.value })} /></Field>
        <Field label={t("fb.usage.critThreshold")}><input type="number" min={1} step={1} required className="field-input num" dir="ltr" value={f.crit} onChange={(e) => setF({ ...f, crit: e.target.value })} /></Field>
        <Field label={t("fb.usage.remaining")} hint={t("fb.usage.remaining.hint")}><input type="number" min={0} step={1} className="field-input num" dir="ltr" value={f.remaining} onChange={(e) => setF({ ...f, remaining: e.target.value })} /></Field>
        <Field label={t("fb.usage.col.source")}>
          <NativeSelect className="field-input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as UsageSource })}>
            {(["MANUAL", "REPORTED", "ESTIMATED"] as const).map((s) => <option key={s} value={s}>{t(`fb.usage.src.${s}` as MsgKey)}</option>)}
          </NativeSelect>
        </Field>
        <Field label={t("fb.f.note")} className="sm:col-span-2"><input maxLength={500} className="field-input" dir="auto" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </FormDialog>
  )
}

/** The full dashboard body: gauge, figures, history charts and the observations table. Nothing is shown that was not observed. */
export function UsageDashboard({ canRecord }: { canRecord: boolean }) {
  const t = useT()
  const q = useFbUsage()
  const fmt = useNum()
  const [rec, setRec] = useState(false)
  const u = q.data
  const asc = useMemo(() => [...(u?.observations ?? [])].sort((a, b) => a.observedAt.localeCompare(b.observedAt)), [u])
  const points = useMemo(() => asc.map((o) => ({ label: fmtDateTime(o.observedAt), short: fmtDateTime(o.observedAt).split(",")[0] ?? "", values: { hits: o.scanHits, ratio: o.bookings > 0 ? Math.round((o.scanHits / o.bookings) * 10) / 10 : 0 } })), [asc])
  const recordBtn = canRecord && <Button size="xs" onClick={() => setRec(true)} data-testid="fb-obs-open">{t("fb.usage.record")}</Button>
  if (q.isError) return <TileError error={q.error} onRetry={() => void q.refetch()} />
  if (!u) return <Skeleton className="h-40" />
  const l = u.latest
  const { warn, crit } = thresholdsOf(u)
  return (
    <div className="space-y-4" data-testid="fb-usage">
      <UsageNote />
      <Section title={t("fb.usage.latest")} aside={recordBtn}>
        {!l ? (
          <div data-testid="fb-usage-empty"><Empty>{t("fb.usage.none")}</Empty><p className="text-center text-meta text-steel">{t("fb.usage.none.hint")}</p></div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><LevelBadge level={l.level} />{l.stale && <span data-testid="fb-usage-stale"><StatusChip tone="warn">{t("fb.usage.stale")}</StatusChip></span>}<span className="text-meta text-steel">{t("fb.usage.lastObs")}: <span className="num" title={l.observedAt}>{fmtDateTime(l.observedAt)}</span> ({rel(l.observedAt)})</span></div>
            <RatioGauge ratio={l.ratio} level={l.level} warn={warn} crit={crit} />
            <dl className="grid gap-4 sm:grid-cols-4">
              <div><dt className="text-meta text-steel">{t("fb.usage.ratio")}</dt><dd className={cn("num text-2xl font-semibold", levelTone(l.level) === "danger" && "text-danger")}>{fmt(Math.round(l.ratio * 10) / 10)}</dd></div>
              <div><dt className="text-meta text-steel">{t("fb.usage.bookings")}</dt><dd className="num text-2xl font-semibold">{fmt(asc[asc.length - 1]?.bookings ?? 0)}</dd></div>
              <div><dt className="text-meta text-steel">{t("fb.usage.hits")}</dt><dd className="num text-2xl font-semibold">{fmt(asc[asc.length - 1]?.scanHits ?? 0)}</dd></div>
              <div><dt className="text-meta text-steel">{t("fb.usage.headroom")} <StatusChip tone="warn" className="ms-1">{t("fb.usage.estimate")}</StatusChip></dt><dd className="num text-2xl font-semibold" data-testid="fb-headroom">{fmt(l.headroomEstimate)}</dd><dd className="text-caption text-steel">{t("fb.usage.headroom.hint", { crit })}</dd></div>
            </dl>
            <p className="text-meta text-steel">{t("fb.usage.avg", { n: fmt(Math.round(l.ratio * 10) / 10) })}</p>
          </div>
        )}
      </Section>
      {u.observations.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t("fb.usage.chart.hits")}><BarChart data={points} series={[{ key: "hits", label: t("fb.usage.hits"), color: "var(--viz-1)" }]} caption={t("fb.usage.chart.hits")} emptyLabel={t("fb.usage.none")} /></Section>
          <Section title={t("fb.usage.chart.ratio")}><LineArea data={points} series={[{ key: "ratio", label: t("fb.usage.ratio"), color: "var(--viz-4)" }]} caption={t("fb.usage.chart.ratio")} emptyLabel={t("fb.usage.none")} /></Section>
        </div>
      )}
      <Section title={t("fb.usage.table")} flush>
        {!u.observations.length ? <div className="p-4"><Empty>{t("fb.usage.none")}</Empty></div> : (
          <DataTable data-testid="fb-obs-table">
            <thead><tr><th scope="col">{t("fb.usage.col.at")}</th><th scope="col">{t("fb.usage.bookings")}</th><th scope="col">{t("fb.usage.hits")}</th><th scope="col">{t("fb.usage.ratio")}</th><th scope="col">{t("fb.usage.remaining")}</th><th scope="col">{t("fb.usage.col.source")}</th><th scope="col">{t("fb.f.note")}</th></tr></thead>
            <tbody>
              {[...asc].reverse().map((o) => (
                <tr key={o.id}>
                  <td className="num">{fmtDateTime(o.observedAt)}</td><td className="num">{fmt(o.bookings)}</td><td className="num">{fmt(o.scanHits)}</td>
                  <td className="num">{o.bookings > 0 ? fmt(Math.round((o.scanHits / o.bookings) * 10) / 10) : "—"}</td><td className="num">{o.remainingReported == null ? "—" : fmt(o.remainingReported)}</td>
                  <td><StatusChip tone={SOURCE_TONE[o.source]}>{t(`fb.usage.src.${o.source}` as MsgKey)}</StatusChip></td><td dir="auto" className="max-w-64 break-words text-steel">{o.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
      {canRecord && <RecordObservation open={rec} onOpenChange={setRec} />}
    </div>
  )
}
