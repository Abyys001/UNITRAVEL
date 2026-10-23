"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

import type { ProviderView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { SchemaForm } from "@/components/schema-form"
import { SecretDialog } from "@/components/secret-form"
import { ErrorLine, Loading, PageHead, Panel, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useSession } from "@/lib/session"

type Patch = Pick<ProviderView, "enabled" | "environment" | "priority" | "capabilities" | "limits" | "markets" | "shadowMode">
const patchOf = (p: ProviderView): Patch => ({ enabled: p.enabled, environment: p.environment, priority: p.priority, shadowMode: p.shadowMode, capabilities: p.capabilities, limits: p.limits, markets: p.markets })

function ProviderCard({ p }: { p: ProviderView }) {
  const qc = useQueryClient()
  const { can } = useSession()
  const [draft, setDraft] = useState<Patch>(patchOf(p))
  const [test, setTest] = useState<{ ok: boolean; latencyMs: number; detail?: string } | null>(null)
  const [busy, setBusy] = useState<"save" | "test" | null>(null)
  const [secrets, setSecrets] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(patchOf(p))
  const save = async () => {
    setBusy("save")
    try { await api(`/v1/dev/providers/${p.id}`, { method: "PATCH", body: draft }); toast.success(`${p.name} updated — all processes reload within seconds`); await qc.invalidateQueries({ queryKey: ["providers"] }) } catch (e) { toast.error(errText(e)) } finally { setBusy(null) }
  }
  const runTest = async () => { setBusy("test"); try { setTest(await api(`/v1/dev/providers/${p.id}/test`, { body: {} })) } catch (e) { setTest({ ok: false, latencyMs: 0, detail: errText(e) }) } finally { setBusy(null) } }
  return (
    <Panel title={<span className="flex items-center gap-2"><span className="font-mono text-[12px] text-ink normal-case">{p.id}</span><span className="normal-case">{p.name}</span></span>} aside={<span className="flex items-center gap-2"><Tag value={p.enabled ? "ENABLED" : "DISABLED"} className={p.enabled ? "border-moss text-moss" : ""} /><Tag value={p.environment.toUpperCase()} /><Tag value={p.health.circuit} className={p.health.circuit === "OPEN" ? "border-brick text-brick" : ""} /></span>}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <SchemaForm value={draft as never} onChange={(v) => setDraft(v as unknown as Patch)} issues={[]} />
        <div className="space-y-3">
          <dl className="ledger-rows font-mono text-[12px]">
            <div className="flex justify-between py-1"><dt>success 24h</dt><dd>{p.health.successRate == null ? "—" : `${Math.round(p.health.successRate * 100)}%`}</dd></div>
            <div className="flex justify-between py-1"><dt>p50 / p95</dt><dd>{p.health.p50 ?? "—"} / {p.health.p95 ?? "—"} ms</dd></div>
            <div className="flex justify-between py-1"><dt>calls today</dt><dd>{p.health.callsToday}</dd></div>
            {p.health.lastError && <div className="py-1 text-brick">{p.health.lastError}</div>}
          </dl>
          <div>
            <p className="cap">Credentials</p>
            <p className="text-[12px]">{p.credentials.set ? <>Set · rotated {fmtDateTime(p.credentials.rotatedAt)}{p.credentials.rotatedBy && ` by ${p.credentials.rotatedBy}`}</> : <span className="text-brick">Not set</span>}</p>
            {can("provider.config.write") && <Button size="xs" variant="outline" className="mt-1" onClick={() => setSecrets(true)}>{p.credentials.set ? "Rotate" : "Enter"} credentials…</Button>}
          </div>
          <div>
            <Button size="xs" variant="outline" onClick={() => void runTest()} loading={busy === "test"} data-testid={`test-${p.id}`}>Test connection</Button>
            {test && <pre className={cn("mt-1 rounded-sm p-1.5 font-mono text-[11px] whitespace-pre-wrap", test.ok ? "bg-[#e4efe7] text-moss" : "bg-[#fbeee9] text-brick")} role="status">{JSON.stringify(test, null, 1)}</pre>}
          </div>
          {can("provider.config.write") && dirty && <div className="flex gap-2"><Button size="sm" onClick={() => void save()} loading={busy === "save"}>Save changes</Button><Button size="sm" variant="ghost" onClick={() => setDraft(patchOf(p))}>Reset</Button></div>}
          {dirty && draft.enabled === false && p.enabled && <p className="text-[11px] text-copper-700">Disabling a provider needs a fresh second-factor check.</p>}
        </div>
      </div>
      <SecretDialog open={secrets} onOpenChange={setSecrets} title={`${p.name} credentials…`} hintKeys={p.id === "duffel" ? ["accessToken"] : p.id === "amadeus-enterprise" ? ["clientId", "clientSecret"] : ["apiKey"]} onSave={async (values) => { await api(`/v1/dev/providers/${p.id}/credentials`, { method: "PUT", body: { values } }); await qc.invalidateQueries({ queryKey: ["providers"] }) }} />
    </Panel>
  )
}

/** Flight API configuration (ch. 16.2 §2). */
export default function ProvidersPage() {
  const q = useQuery({ queryKey: ["providers"], queryFn: () => api<ProviderView[]>("/v1/dev/providers") })
  if (q.error) return <div className="p-5"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  return (
    <div>
      <PageHead kicker="Integrations" title="Flight providers" />
      <div className="px-5" data-testid="providers">{q.data.map((p) => <ProviderCard key={`${p.id}-${p.version}`} p={p} />)}</div>
    </div>
  )
}
