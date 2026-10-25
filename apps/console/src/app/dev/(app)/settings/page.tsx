"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { AppSettings } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { useConfirm } from "@/components/confirm"
import { type Issue, SchemaForm } from "@/components/schema-form"
import { DevPage, Section } from "@/components/dev-ui"
import { ErrorLine, Loading, PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Flag { key: string; enabled: boolean; description?: string | null; owner?: string | null; removeBy?: string | null; updatedAt?: string | null }

/** Application settings and feature flags (ch. 16.2 §10). */
export default function SettingsPage() {
  const { can } = useSession()
  const t = useT()
  const { ask, dialog } = useConfirm()
  const settings = useQuery({ queryKey: ["app-settings"], queryFn: () => api<AppSettings>("/v1/dev/settings") })
  const flags = useQuery({ queryKey: ["flags"], queryFn: () => api<Flag[]>("/v1/dev/feature-flags") })
  const [draft, setDraft] = useState<unknown>(null)
  useEffect(() => { if (settings.data && draft == null) setDraft(structuredClone(settings.data)) }, [settings.data, draft])
  const issues: Issue[] = useMemo(() => { if (draft == null) return []; const r = AppSettings.safeParse(draft); return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, [draft])
  const [busy, setBusy] = useState(false)
  const save = async () => { setBusy(true); try { setDraft(await api("/v1/dev/settings", { method: "PUT", body: draft })); toast.success(t("set.saved")); await settings.refetch() } catch (e) { toast.error(errText(e)) } finally { setBusy(false) } }
  const toggle = async (f: Flag) => { try { await api(`/v1/dev/feature-flags/${encodeURIComponent(f.key)}`, { method: "PUT", body: { enabled: !f.enabled } }); toast.success(`${f.key} ${f.enabled ? "off" : "on"}`); await flags.refetch() } catch (e) { toast.error(errText(e)) } }
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data)
  return (
    <div>
      {dialog}
      <PageHead kicker={t("dpage.platform")} title={t("dpage.settings.title")}><span className="text-[12px] text-steel">{t("set.desc")}</span></PageHead>
      <DevPage className="grid items-start gap-4 space-y-0 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Section title={t("set.app")} hint={t("set.appHint")} aside={issues.length ? <span className="rounded-full bg-danger-subtle px-2.5 py-0.5 text-danger">{t("cfg.issues", { n: issues.length })}</span> : dirty ? <span className="text-steel">{t("set.unsaved")}</span> : null}>
          <ErrorLine error={settings.error} />
          {draft == null ? <Loading /> : <SchemaForm value={draft as never} onChange={setDraft} issues={issues} />}
          {can("settings.write") && <div className="-mx-4 mt-5 -mb-4 flex gap-2 border-t border-rule bg-surface-sunk px-4 py-3 md:-mx-5 md:-mb-5 md:px-5"><Button size="sm" onClick={() => void save()} loading={busy} disabled={!!issues.length || !dirty}>{t("set.save")}</Button>{dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(structuredClone(settings.data))}>{t("ud.reset")}</Button>}</div>}
        </Section>
        <Section title={t("hl.flags")} hint={t("set.flagsHint")} flush>
          <div className="px-4 md:px-5"><ErrorLine error={flags.error} /></div>
          <ul className="divide-y divide-rule" data-testid="flags">
            {(flags.data ?? []).map((f) => (
              <li key={f.key} className="flex items-start justify-between gap-3 px-4 py-3 md:px-5">
                <span className="min-w-0"><span className="font-mono text-[12.5px] break-all" dir="ltr">{f.key}</span>{(f.description || f.owner) && <span className="mt-0.5 block text-[12px] text-steel">{f.description}{f.owner && ` · ${t("set.owner", { o: f.owner })}`}{f.removeBy && ` · ${t("set.removeBy", { d: f.removeBy })}`}</span>}{f.updatedAt && <span className="mt-0.5 block text-[11.5px] text-steel">{t("set.changed", { at: fmtDateTime(f.updatedAt) })}</span>}</span>
                <label className="flex shrink-0 items-center gap-2 pointer-coarse:min-h-11"><input type="checkbox" role="switch" aria-label={f.key} checked={f.enabled} disabled={!can("flags.write")} onChange={() => ask({ title: t("confirm.flag.title", { key: f.key, state: f.enabled ? t("flag.off") : t("flag.on") }), description: t("confirm.flag.body"), label: t("confirm.flag.label", { state: f.enabled ? t("flag.off") : t("flag.on") }), destructive: f.enabled, run: () => toggle(f) })} /><span className={f.enabled ? "text-success" : "text-steel"}>{f.enabled ? t("flag.on") : t("flag.off")}</span></label>
              </li>
            ))}
          </ul>
          <p className="border-t border-rule px-4 py-3 text-[12px] text-steel md:px-5">{t("set.payNote")}</p>
        </Section>
      </DevPage>
    </div>
  )
}
