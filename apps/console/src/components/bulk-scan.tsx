"use client"

import { CheckCircle2, CircleX, Copy, Loader2 } from "lucide-react"
import { useCallback, useRef, useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"

import { formatTn } from "@/components/cargo-ops"
import { Scanner } from "@/components/scanner"
import { PageHead } from "@/components/ui"
import { errText } from "@/lib/api"
import { useT } from "@/lib/i18n"

export type BulkRow = { tn: string; state: "working" | "ok" | "fail" | "dup"; detail?: string; at: number }

/**
 * ADR-0046 D2: pick one update, then scan parcel after parcel. Each scan runs `apply` (the single-parcel endpoint, so the
 * state machine, locking and audit apply per parcel); a failure is listed with the server's reason and never stops the run.
 */
export function BulkScan({ actions, labelOf, withTime, apply, defaultAction }: {
  actions: readonly string[]; labelOf: (a: string) => string; withTime: boolean; defaultAction: string
  apply: (tn: string, action: string, input: { location: string; occurredAt?: string }) => Promise<string | void>
}) {
  const t = useT()
  const [action, setAction] = useState(defaultAction)
  const [location, setLocation] = useState("")
  const [time, setTime] = useState(() => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) })
  const [rows, setRows] = useState<BulkRow[]>([])
  const done = useRef(new Set<string>())

  const onTn = useCallback(async (tn: string) => {
    const key = `${action}:${tn}`
    if (done.current.has(key)) { setRows((r) => [{ tn, state: "dup", at: Date.now() }, ...r]); return }
    setRows((r) => [{ tn, state: "working", at: Date.now() }, ...r])
    const set = (state: BulkRow["state"], detail?: string) => setRows((r) => { const i = r.findIndex((x) => x.tn === tn && x.state === "working"); if (i < 0) return r; const n = [...r]; n[i] = { ...n[i]!, state, detail }; return n })
    try {
      const detail = await apply(tn, action, { location: location.trim(), occurredAt: withTime ? new Date(time).toISOString() : undefined })
      done.current.add(key)
      set("ok", detail ?? undefined)
      navigator.vibrate?.(40)
    } catch (e) {
      set("fail", errText(e))
      navigator.vibrate?.([80, 60, 80])
    }
  }, [action, apply, location, time, withTime])

  const ok = rows.filter((r) => r.state === "ok").length
  const fail = rows.filter((r) => r.state === "fail").length
  const ready = location.trim().length >= 2
  return (
    <div className="mx-auto max-w-2xl px-4 pb-10 md:px-6">
      <PageHead title={t("bulk.title")} />
      <p className="mb-3 text-meta text-steel">{t("bulk.hint")}</p>
      <div className="mb-3 grid gap-3 rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3 sm:grid-cols-2" data-testid="bulk-settings">
        <label className="grid gap-1 text-meta font-medium sm:col-span-2">{t("bulk.action")}
          <select className="h-10 rounded-lg border border-rule-strong bg-surface px-2 text-body" value={action} onChange={(e) => setAction(e.target.value)} data-testid="bulk-action">
            {actions.map((a) => <option key={a} value={a}>{labelOf(a)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-meta font-medium">{t("bulk.location")}<Input value={location} onChange={(e) => setLocation(e.target.value)} dir="auto" placeholder="London depot" data-testid="bulk-location" /></label>
        {withTime && <label className="grid gap-1 text-meta font-medium">{t("bulk.time")}<Input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} /></label>}
      </div>
      {!ready && <p className="mb-2 text-meta font-medium text-orange-700">{t("bulk.needLocation")}</p>}
      <Scanner onTn={onTn} keepOpen cooldownMs={4000} disabled={!ready} />
      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-meta font-medium" aria-live="polite">{t("bulk.count", { ok, fail })}</p>
        <div className="flex gap-2">
          {rows.length > 0 && <Button size="xs" variant="ghost" onClick={() => void navigator.clipboard?.writeText(rows.map((r) => `${r.tn}\t${r.state}\t${r.detail ?? ""}`).join("\n"))}><Copy className="size-3.5" aria-hidden /></Button>}
          {rows.length > 0 && <Button size="xs" variant="outline" onClick={() => { setRows([]); done.current.clear() }}>{t("bulk.clear")}</Button>}
        </div>
      </div>
      {!rows.length ? <p className="mt-2 text-meta text-steel">{t("bulk.none")}</p> : (
        <ul className="mt-2 divide-y divide-rule rounded-[var(--radius-card)] border border-rule bg-surface-raised" data-testid="bulk-rows">
          {rows.map((r, i) => (
            <li key={`${r.tn}-${r.at}-${i}`} className="flex items-start gap-2 px-3 py-2">
              {r.state === "working" ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-steel" aria-hidden /> : r.state === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <CircleX className={r.state === "dup" ? "mt-0.5 size-4 shrink-0 text-steel" : "mt-0.5 size-4 shrink-0 text-danger"} aria-hidden />}
              <div className="min-w-0">
                <p className="ref text-meta font-semibold" dir="ltr">{formatTn(r.tn)}</p>
                <p className="text-caption text-steel">{r.state === "working" ? t("bulk.working") : r.state === "ok" ? t("bulk.ok") : r.state === "dup" ? t("bulk.dup") : t("bulk.fail")}{r.detail && <> · <span className={r.state === "fail" ? "text-danger" : ""}>{r.detail}</span></>}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
