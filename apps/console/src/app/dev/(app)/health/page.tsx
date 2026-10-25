"use client"

import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import Link from "next/link"

import { cn } from "@unitravel/ui/lib/utils"

import { BentoGrid, BentoTile, EmptyState, Stat, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { DataTable, DevPage, Dot, KV, KVRow, Section } from "@/components/dev-ui"
import { Loading, PageHead, Tag } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useT } from "@/lib/i18n"

interface Health {
  version: string; commit: string; env: string; uptimeSeconds: number
  database: { ok: boolean; latencyMs: number; migrations: { applied: number; latest: string | null } }
  redis: { ok: boolean; latencyMs: number }
  queues: { name: string; waiting: number; active: number; delayed: number; failed: number; oldestWaitingSeconds: number | null }[]
  workers: { id: string; role: string; configVersions: Record<string, number>; lastHeartbeat: string }[]
  configVersions: Record<string, number>; flags: Record<string, boolean>
  dependencies: { name: string; kind: string; ok: boolean | null; successRate: number | null; p50: number | null; p95: number | null; lastError: string | null; circuit: string | null }[]
  outbox: { pending: number; oldestSeconds: number | null }
}

/** Integration health and system diagnostics (ch. 16.2 §3, §9): verdict first, then every dependency, queue depth, config drift. */
export default function HealthPage() {
  const t = useT()
  const q = useQuery({ queryKey: ["dev-health"], queryFn: () => api<Health>("/v1/dev/health"), refetchInterval: 10_000 })
  if (q.error) return <div className="p-4 md:p-6"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!q.data) return <><Loading /><ListSkeleton rows={6} /></>
  const h = q.data
  const drift = h.workers.filter((w) => Object.entries(h.configVersions).some(([k, v]) => w.configVersions[k] !== undefined && w.configVersions[k] !== v))
  const stale = h.workers.filter((w) => Date.now() - Date.parse(w.lastHeartbeat) > 60_000)
  const open = h.dependencies.filter((d) => d.circuit === "OPEN")
  const failing = h.dependencies.filter((d) => d.ok === false)
  const failed = h.queues.reduce((n, x) => n + x.failed, 0)
  const backlog = h.queues.reduce((n, x) => n + x.waiting + x.delayed, 0)
  const oldest = Math.max(0, ...h.queues.map((x) => x.oldestWaitingSeconds ?? 0))
  const issues = [
    !h.database.ok && t("hl.i.db"), !h.redis.ok && t("hl.i.redis"), h.outbox.pending >= 100 && t("hl.i.outbox", { n: h.outbox.pending }),
    open.length > 0 && t("hl.i.circuits", { n: open.length }), failing.length > 0 && t("hl.i.deps", { n: failing.length }),
    failed > 0 && t("hl.i.failed", { n: failed }), stale.length > 0 && t("hl.i.stale", { n: stale.length }), drift.length > 0 && t("hl.i.drift", { n: drift.length }),
  ].filter(Boolean) as string[]
  const kicker = <>{h.env} · v{h.version} · {h.commit !== h.env && <><span className="font-mono">{h.commit.slice(0, 10)}</span> · </>}{t("health.up", { h: Math.floor(h.uptimeSeconds / 3600), m: Math.floor((h.uptimeSeconds % 3600) / 60) })}</>
  return (
    <div>
      <PageHead kicker={kicker} title={t("dpage.health.title")}><span className="text-meta text-steel">{t("dev.live")}</span></PageHead>
      <DevPage data-testid="health">
        <BentoGrid>
          <BentoTile size="l" tone={issues.length ? "alert" : "default"} aria-live="polite">
            <div className="flex items-start gap-3">
              {issues.length ? <AlertTriangle className="mt-0.5 size-6 shrink-0 text-danger" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />}
              <div className="min-w-0">
                <p className={cn("font-display text-title leading-tight", issues.length ? "text-danger" : "text-success")}>{issues.length ? t("hl.degraded") : t("hl.ok")}</p>
                <p className="mt-1 text-meta text-steel">{issues.length ? t("hl.degradedHint") : t("hl.okHint")}</p>
                {issues.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">{issues.map((i) => <li key={i} className="rounded-full border border-danger/50 bg-danger-subtle px-2.5 py-0.5 text-meta text-danger">{i}</li>)}</ul>}
              </div>
            </div>
          </BentoTile>
          <BentoTile size="s" title={t("hl.circuits")}><Stat label={t("hl.circuitsOpen")} value={<>{open.length}<span className="text-base font-normal text-steel"> / {h.dependencies.length}</span></>} tone={open.length ? "danger" : "default"} hint={open.length ? open.map((d) => d.name).join(", ") : t("hl.circuitsOk")} /></BentoTile>
          <BentoTile size="s" title={t("hl.backlog")} aside={<Link href="/jobs" className="inline-flex min-h-6 items-center font-medium text-link hover:underline pointer-coarse:min-h-11">{t("hl.deadLetters")}</Link>}><Stat label={t("hl.queued")} value={backlog} tone={failed ? "danger" : "default"} hint={t("hl.backlogHint", { failed, oldest })} /></BentoTile>
        </BentoGrid>

        <div className="grid gap-4 lg:grid-cols-3">
          <Section title={t("hl.core")} hint={t("hl.coreHint", { m: h.database.migrations.latest ?? "—" })}>
            <KV className="num text-meta">
              <KVRow k={<span className="flex items-center gap-2"><Dot ok={h.database.ok} label={h.database.ok ? t("hl.healthy") : t("hl.failing")} />database</span>}>{h.database.latencyMs} ms · {t("hl.migrations", { n: h.database.migrations.applied })}</KVRow>
              <KVRow k={<span className="flex items-center gap-2"><Dot ok={h.redis.ok} label={h.redis.ok ? t("hl.healthy") : t("hl.failing")} />redis</span>}>{h.redis.latencyMs} ms</KVRow>
              <KVRow k={<span className="flex items-center gap-2"><Dot ok={h.outbox.pending < 100} label={h.outbox.pending < 100 ? t("hl.healthy") : t("hl.failing")} />outbox</span>}>{t("hl.pending", { n: h.outbox.pending })}{h.outbox.oldestSeconds != null && ` · ${t("hl.oldest", { s: h.outbox.oldestSeconds })}`}</KVRow>
            </KV>
          </Section>
          <Section title={t("hl.config")} hint={drift.length ? undefined : t("hl.configHint")} aside={drift.length > 0 && <span className="text-danger">{t("hl.i.drift", { n: drift.length })}</span>}>
            <KV className="num text-meta">{Object.entries(h.configVersions).map(([k, v]) => <KVRow key={k} k={<span dir="ltr">{k}</span>}>v{v}</KVRow>)}</KV>
          </Section>
          <Section title={t("hl.flags")} aside={<Link href="/settings" className="inline-flex min-h-6 items-center font-medium text-link hover:underline pointer-coarse:min-h-11">{t("hl.edit")}</Link>}>
            <KV className="text-meta">{Object.entries(h.flags).map(([k, v]) => <KVRow key={k} k={<span className="font-mono text-meta" dir="ltr">{k}</span>}><span className={v ? "text-success" : "text-steel"}>{v ? t("flag.on") : t("flag.off")}</span></KVRow>)}</KV>
          </Section>
        </div>

        <Section title={t("hl.deps")} hint={t("hl.depsHint")} flush>
          {!h.dependencies.length ? <EmptyState title={t("hl.noDeps")} /> : (
            <DataTable data-testid="dependencies">
              <thead><tr>{["", t("hl.c.dep"), t("hl.c.kind"), t("hl.c.success"), "p50 ms", "p95 ms", t("hl.c.circuit"), t("hl.c.error")].map((x, i) => <th key={i}>{x}</th>)}</tr></thead>
              <tbody>{h.dependencies.map((d) => <tr key={d.name}><td className="w-6"><Dot ok={d.ok} label={d.ok === null ? t("hl.noData") : d.ok ? t("hl.healthy") : t("hl.failing")} /></td><td className="font-medium" dir="ltr">{d.name}</td><td className="text-steel">{d.kind}</td><td className="num">{d.successRate == null ? "—" : `${Math.round(d.successRate * 100)}%`}</td><td className="num">{d.p50 ?? "—"}</td><td className="num">{d.p95 ?? "—"}</td><td>{d.circuit ? <Tag value={d.circuit} className={d.circuit === "OPEN" ? "border-danger text-danger" : ""} /> : "—"}</td><td className="max-w-80 truncate text-danger" title={d.lastError ?? ""}>{d.lastError ?? ""}</td></tr>)}</tbody>
            </DataTable>
          )}
        </Section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Section title={t("hl.queues")} aside={<Link href="/jobs" className="inline-flex min-h-6 items-center font-medium text-link hover:underline pointer-coarse:min-h-11">{t("hl.deadLetters")}</Link>} flush>
            <DataTable data-testid="queues">
              <thead><tr>{[t("hl.c.queue"), t("hl.c.waiting"), t("hl.c.active"), t("hl.c.delayed"), t("hl.c.failed"), t("hl.c.oldest")].map((x) => <th key={x}>{x}</th>)}</tr></thead>
              <tbody>{h.queues.map((x) => <tr key={x.name}><td className="font-medium" dir="ltr">{x.name}</td><td className="num">{x.waiting}</td><td className="num">{x.active}</td><td className="num">{x.delayed}</td><td className={cn("num", x.failed > 0 && "font-semibold text-danger")}>{x.failed}</td><td className="num">{x.oldestWaitingSeconds != null ? `${x.oldestWaitingSeconds}s` : "—"}</td></tr>)}</tbody>
            </DataTable>
          </Section>
          <Section title={t("hl.workers")} flush={h.workers.length > 0}>
            {!h.workers.length ? <EmptyState title={t("hl.noWorkers")} /> : (
              <ul className="divide-y divide-rule">{h.workers.map((w) => <li key={w.id} className="px-4 py-2.5 md:px-5"><p className="flex justify-between gap-2"><span className="font-medium" dir="ltr">{w.role} <span className="font-mono text-caption text-steel">{w.id.slice(0, 10)}</span></span><span className={Date.now() - Date.parse(w.lastHeartbeat) > 60_000 ? "text-danger" : "text-steel"} title={fmtDateTime(w.lastHeartbeat)}>{rel(w.lastHeartbeat)}</span></p><p className="mt-0.5 text-caption text-steel" dir="ltr">{Object.entries(w.configVersions).map(([k, v]) => `${k} v${v}`).join(" · ")}</p></li>)}</ul>
            )}
          </Section>
        </div>
      </DevPage>
    </div>
  )
}
