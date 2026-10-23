"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { AppSettings } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { type Issue, SchemaForm } from "@/components/schema-form"
import { ErrorLine, Loading, PageHead, Panel } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useSession } from "@/lib/session"

interface Flag { key: string; enabled: boolean; description?: string | null; owner?: string | null; removeBy?: string | null; updatedAt?: string | null }

/** Application settings and feature flags (ch. 16.2 §10). */
export default function SettingsPage() {
  const { can } = useSession()
  const settings = useQuery({ queryKey: ["app-settings"], queryFn: () => api<AppSettings>("/v1/dev/settings") })
  const flags = useQuery({ queryKey: ["flags"], queryFn: () => api<Flag[]>("/v1/dev/feature-flags") })
  const [draft, setDraft] = useState<unknown>(null)
  useEffect(() => { if (settings.data && draft == null) setDraft(structuredClone(settings.data)) }, [settings.data, draft])
  const issues: Issue[] = useMemo(() => { if (draft == null) return []; const r = AppSettings.safeParse(draft); return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, [draft])
  const [busy, setBusy] = useState(false)
  const save = async () => { setBusy(true); try { setDraft(await api("/v1/dev/settings", { method: "PUT", body: draft })); toast.success("Settings saved"); await settings.refetch() } catch (e) { toast.error(errText(e)) } finally { setBusy(false) } }
  const toggle = async (f: Flag) => { try { await api(`/v1/dev/feature-flags/${encodeURIComponent(f.key)}`, { method: "PUT", body: { enabled: !f.enabled } }); toast.success(`${f.key} ${f.enabled ? "off" : "on"}`); await flags.refetch() } catch (e) { toast.error(errText(e)) } }
  return (
    <div>
      <PageHead kicker="Platform" title="Settings & feature flags" />
      <div className="grid gap-x-8 px-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Application settings" aside={issues.length ? <span className="text-brick">{issues.length} issue(s)</span> : null}>
          <ErrorLine error={settings.error} />
          {draft == null ? <Loading /> : <SchemaForm value={draft as never} onChange={setDraft} issues={issues} />}
          {can("settings.write") && <Button size="sm" className="mt-3" onClick={() => void save()} loading={busy} disabled={!!issues.length || JSON.stringify(draft) === JSON.stringify(settings.data)}>Save settings</Button>}
        </Panel>
        <Panel title="Feature flags">
          <ErrorLine error={flags.error} />
          <ul className="ledger-rows" data-testid="flags">
            {(flags.data ?? []).map((f) => (
              <li key={f.key} className="flex items-start justify-between gap-3 py-1.5">
                <span className="min-w-0"><span className="font-mono text-[12px]">{f.key}</span>{(f.description || f.owner) && <span className="block text-[11px] text-slate">{f.description}{f.owner && ` · owner ${f.owner}`}{f.removeBy && ` · remove by ${f.removeBy}`}</span>}{f.updatedAt && <span className="block text-[10.5px] text-slate">changed {fmtDateTime(f.updatedAt)}</span>}</span>
                <label className="flex shrink-0 items-center gap-1.5"><input type="checkbox" role="switch" aria-label={f.key} checked={f.enabled} disabled={!can("flags.write")} onChange={() => void toggle(f)} /><span className={f.enabled ? "text-moss" : "text-slate"}>{f.enabled ? "on" : "off"}</span></label>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-slate">payments.online.enabled stays off in v1 — the API refuses it (decision D-03).</p>
        </Panel>
      </div>
    </div>
  )
}
