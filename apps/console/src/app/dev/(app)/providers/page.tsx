"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

import { ProviderEnv, type ProviderView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { SchemaForm } from "@/components/schema-form"
import { SecretDialog } from "@/components/secret-form"
import { DevPage, KV, KVRow, Section } from "@/components/dev-ui"
import { ErrorLine, Loading, PageHead, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

type Patch = Pick<ProviderView, "enabled" | "environment" | "priority" | "capabilities" | "limits" | "markets" | "shadowMode">
const patchOf = (p: ProviderView): Patch => ({ enabled: p.enabled, environment: p.environment, priority: p.priority, shadowMode: p.shadowMode, capabilities: p.capabilities, limits: p.limits, markets: p.markets })

function ProviderCard({ p }: { p: ProviderView }) {
  const qc = useQueryClient()
  const { can } = useSession()
  const t = useT()
  const [draft, setDraft] = useState<Patch>(patchOf(p))
  const [test, setTest] = useState<{ ok: boolean; latencyMs: number; detail?: string } | null>(null)
  const [busy, setBusy] = useState<"save" | "test" | null>(null)
  const [secrets, setSecrets] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(patchOf(p))
  const save = async () => {
    setBusy("save")
    try { await api(`/v1/dev/providers/${p.id}`, { method: "PATCH", body: draft }); toast.success(t("prov.updated", { name: p.name })); await qc.invalidateQueries({ queryKey: ["providers"] }) } catch (e) { toast.error(errText(e)) } finally { setBusy(null) }
  }
  const runTest = async () => { setBusy("test"); try { setTest(await api(`/v1/dev/providers/${p.id}/test`, { body: {} })) } catch (e) { setTest({ ok: false, latencyMs: 0, detail: errText(e) }) } finally { setBusy(null) } }
  return (
    <Section title={<span className="flex flex-wrap items-center gap-2"><span>{p.name}</span><span className="rounded-md bg-surface-sunk px-1.5 py-px font-mono text-caption font-normal text-steel" dir="ltr">{p.id}</span></span>} aside={<><Tag value={p.enabled ? "ENABLED" : "DISABLED"} className={p.enabled ? "border-success text-success" : ""} /><Tag value={p.environment.toUpperCase()} /><Tag value={p.health.circuit} className={p.health.circuit === "OPEN" ? "border-danger text-danger" : ""} /></>}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div><h3 className="mb-3 text-meta font-semibold text-steel">{t("prov.settings")}</h3><SchemaForm value={draft as never} onChange={(v) => setDraft(v as unknown as Patch)} issues={[]} selects={{ environment: ProviderEnv.options }} /></div>
        <div className="space-y-5 xl:border-s xl:border-rule xl:ps-6">
          <div>
            <h3 className="mb-2 text-meta font-semibold text-steel">{t("prov.health")}</h3>
            <KV className="num text-meta">
              <KVRow k={t("prov.success")}>{p.health.successRate == null ? "—" : `${Math.round(p.health.successRate * 100)}%`}</KVRow>
              <KVRow k="p50 / p95">{p.health.p50 ?? "—"} / {p.health.p95 ?? "—"} ms</KVRow>
              <KVRow k={t("prov.calls")}>{p.health.callsToday}</KVRow>
            </KV>
            {p.health.lastError && <p className="mt-2 rounded-md bg-danger-subtle px-2.5 py-1.5 text-meta break-words text-danger">{p.health.lastError}</p>}
          </div>
          <div>
            <h3 className="mb-1 text-meta font-semibold text-steel">{t("prov.credentials")}</h3>
            <p className="text-meta">{p.credentials.set ? <>{t("prov.set")} · {t("prov.rotated", { at: fmtDateTime(p.credentials.rotatedAt) })}{p.credentials.rotatedBy && ` · ${p.credentials.rotatedBy}`}</> : <span className="text-danger">{t("prov.notSet")}</span>}</p>
            {can("provider.config.write") && <Button size="xs" variant="outline" className="mt-2" onClick={() => setSecrets(true)}>{p.credentials.set ? t("prov.rotate") : t("prov.enter")}</Button>}
          </div>
          <div>
            <Button size="xs" variant="outline" onClick={() => void runTest()} loading={busy === "test"} data-testid={`test-${p.id}`}>{t("prov.test")}</Button>
            {test && <p className={cn("mt-2 rounded-md p-2 text-meta", test.ok ? "bg-success-subtle text-success" : "bg-danger-subtle text-danger")} role="status" data-testid="provider-test-result">{test.ok ? t("prov.test.ok", { ms: test.latencyMs }) : t("prov.test.fail")}{test.detail && <span className="block break-words">{test.detail}</span>}</p>}
          </div>
          {can("provider.config.write") && dirty && <div className="flex gap-2 border-t border-rule pt-4"><Button size="sm" onClick={() => void save()} loading={busy === "save"}>{t("prov.save")}</Button><Button size="sm" variant="ghost" onClick={() => setDraft(patchOf(p))}>{t("ud.reset")}</Button></div>}
          {dirty && draft.enabled === false && p.enabled && <p className="text-meta text-orange-700 dark:text-orange-300">{t("prov.disableStepUp")}</p>}
        </div>
      </div>
      <SecretDialog open={secrets} onOpenChange={setSecrets} title={t("prov.credsTitle", { name: p.name })} hintKeys={p.id === "duffel" ? ["accessToken"] : p.id === "amadeus-enterprise" ? ["clientId", "clientSecret"] : ["apiKey"]} onSave={async (values) => { await api(`/v1/dev/providers/${p.id}/credentials`, { method: "PUT", body: { values } }); await qc.invalidateQueries({ queryKey: ["providers"] }) }} />
    </Section>
  )
}

/** Flight API configuration (ch. 16.2 §2). */
export default function ProvidersPage() {
  const t = useT()
  const q = useQuery({ queryKey: ["providers"], queryFn: () => api<ProviderView[]>("/v1/dev/providers") })
  if (q.error) return <div className="p-4 md:p-6"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  return (
    <div>
      <PageHead kicker={t("dnav.integrations")} title={t("dnav.providers")}><span className="text-meta text-steel">{t("prov.desc")}</span></PageHead>
      <DevPage data-testid="providers">{q.data.map((p) => <ProviderCard key={`${p.id}-${p.version}`} p={p} />)}</DevPage>
    </div>
  )
}
