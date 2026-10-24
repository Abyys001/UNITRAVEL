"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { cn } from "@unitravel/ui/lib/utils"

import { BentoGrid, BentoTile, EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { Loading, PageHead, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
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

const Dot = ({ ok }: { ok: boolean | null }) => <span role="img" className={cn("inline-block size-2 rounded-full", ok === null ? "bg-steel/40" : ok ? "bg-success" : "bg-danger")} aria-label={ok === null ? "no data" : ok ? "healthy" : "failing"} />

/** Integration health and system diagnostics (ch. 16.2 §3, §9): every dependency, queue depth, config drift. */
export default function HealthPage() {
  const t = useT()
  const q = useQuery({ queryKey: ["dev-health"], queryFn: () => api<Health>("/v1/dev/health"), refetchInterval: 10_000 })
  if (q.error) return <div className="p-5"><TileError message={errText(q.error)} onRetry={() => void q.refetch()} /></div>
  if (!q.data) return <><Loading /><ListSkeleton rows={6} /></>
  const h = q.data
  const drift = h.workers.filter((w) => Object.entries(h.configVersions).some(([k, v]) => w.configVersions[k] !== undefined && w.configVersions[k] !== v))
  return (
    <div>
      <PageHead kicker={<>{h.env} · v{h.version} · <span className="font-mono">{h.commit.slice(0, 10)}</span> · up {Math.floor(h.uptimeSeconds / 3600)} h {Math.floor((h.uptimeSeconds % 3600) / 60)} m</>} title="Health & diagnostics">
        <span className="text-steel">{t("dev.live")}</span>
      </PageHead>
      <BentoGrid className="px-5 py-4" data-testid="health">
        <BentoTile size="m" title="Core">
          <dl className="ledger-rows font-mono text-[12px]">
            <div className="flex justify-between py-1"><dt><Dot ok={h.database.ok} /> database</dt><dd>{h.database.latencyMs} ms · {h.database.migrations.applied} migrations</dd></div>
            <div className="flex justify-between py-1"><dt><Dot ok={h.redis.ok} /> redis</dt><dd>{h.redis.latencyMs} ms</dd></div>
            <div className="flex justify-between py-1"><dt><Dot ok={h.outbox.pending < 100} /> outbox</dt><dd>{h.outbox.pending} pending{h.outbox.oldestSeconds != null && ` · oldest ${h.outbox.oldestSeconds}s`}</dd></div>
          </dl>
          <p className="mt-1 text-[11px] text-steel">Latest migration {h.database.migrations.latest ?? "—"}</p>
        </BentoTile>
        <BentoTile size="m" title="Configuration in force" aside={drift.length > 0 && <span className="text-danger">{drift.length} worker(s) drifting</span>}>
          <dl className="ledger-rows font-mono text-[12px]">{Object.entries(h.configVersions).map(([k, v]) => <div key={k} className="flex justify-between py-1"><dt>{k}</dt><dd>v{v}</dd></div>)}</dl>
        </BentoTile>
        <BentoTile size="m" title="Feature flags" aside={<Link href="/settings" className="text-orange-700">Edit →</Link>}>
          <dl className="ledger-rows font-mono text-[12px]">{Object.entries(h.flags).map(([k, v]) => <div key={k} className="flex justify-between py-1"><dt>{k}</dt><dd className={v ? "text-success" : "text-steel"}>{v ? "on" : "off"}</dd></div>)}</dl>
        </BentoTile>
        <BentoTile size="full" title="External dependencies">
          {!h.dependencies.length ? <EmptyState title="No dependencies reported." /> : (
            <TableScroll><table className="w-full bg-surface-raised font-mono text-[12px]" data-testid="dependencies">
              <thead><tr className="border-b border-rule">{["", "Dependency", "Kind", "Success", "p50", "p95", "Circuit", "Last error"].map((x) => <th key={x} className="cap px-2 py-1 text-start font-normal">{x}</th>)}</tr></thead>
              <tbody>{h.dependencies.map((d) => <tr key={d.name} className="border-b border-rule/70"><td className="px-2 py-1"><Dot ok={d.ok} /></td><td className="px-2 py-1">{d.name}</td><td className="px-2 py-1 text-steel">{d.kind}</td><td className="px-2 py-1">{d.successRate == null ? "—" : `${Math.round(d.successRate * 100)}%`}</td><td className="px-2 py-1">{d.p50 ?? "—"}</td><td className="px-2 py-1">{d.p95 ?? "—"}</td><td className="px-2 py-1">{d.circuit ? <Tag value={d.circuit} className={d.circuit === "OPEN" ? "border-danger text-danger" : ""} /> : "—"}</td><td className="max-w-80 truncate px-2 py-1 text-danger" title={d.lastError ?? ""}>{d.lastError ?? ""}</td></tr>)}</tbody>
            </table></TableScroll>
          )}
        </BentoTile>
        <BentoTile size="xl" title="Queues" aside={<Link href="/jobs" className="text-orange-700">Dead letters →</Link>}>
          <TableScroll><table className="w-full bg-surface-raised font-mono text-[12px]" data-testid="queues">
            <thead><tr className="border-b border-rule">{["Queue", "Waiting", "Active", "Delayed", "Failed", "Oldest"].map((x) => <th key={x} className="cap px-2 py-1 text-start font-normal">{x}</th>)}</tr></thead>
            <tbody>{h.queues.map((x) => <tr key={x.name} className="border-b border-rule/70"><td className="px-2 py-1">{x.name}</td><td className="px-2 py-1">{x.waiting}</td><td className="px-2 py-1">{x.active}</td><td className="px-2 py-1">{x.delayed}</td><td className={cn("px-2 py-1", x.failed > 0 && "text-danger")}>{x.failed}</td><td className="px-2 py-1">{x.oldestWaitingSeconds != null ? `${x.oldestWaitingSeconds}s` : "—"}</td></tr>)}</tbody>
          </table></TableScroll>
        </BentoTile>
        <BentoTile size="m" title="Workers">
          {!h.workers.length ? <EmptyState title="No worker heartbeats." /> : <ul className="ledger-rows font-mono text-[12px]">{h.workers.map((w) => <li key={w.id} className="py-1"><p className="flex justify-between"><span>{w.role} · {w.id.slice(0, 10)}</span><span className={Date.now() - Date.parse(w.lastHeartbeat) > 60_000 ? "text-danger" : "text-steel"} title={fmtDateTime(w.lastHeartbeat)}>{rel(w.lastHeartbeat)}</span></p><p className="text-[10.5px] text-steel">{Object.entries(w.configVersions).map(([k, v]) => `${k} v${v}`).join(" · ")}</p></li>)}</ul>}
        </BentoTile>
      </BentoGrid>
    </div>
  )
}
