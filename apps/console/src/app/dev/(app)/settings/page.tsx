"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { AppSettings } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { useConfirm } from "@/components/confirm"
import { Segmented } from "@/components/controls"
import { type Issue, SchemaForm } from "@/components/schema-form"
import { SETTINGS_EXTRA_PATHS, SettingsExtras } from "@/components/settings-extras"
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
  const [query, setQuery] = useState("")
  const [groupBy, setGroupBy] = useState<"area" | "owner">("area")
  // Area = the key's first segment ("payments.online.enabled" -> "payments"); owner = who must remove it. Search covers key, description and owner.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const by = new Map<string, Flag[]>()
    for (const f of flags.data ?? []) {
      if (q && ![f.key, f.description ?? "", f.owner ?? ""].some((x) => x.toLowerCase().includes(q))) continue
      const name = groupBy === "area" ? (f.key.split(".")[0] ?? t("set.flags.general")) : (f.owner ?? t("set.flags.noOwner"))
      by.set(name, [...(by.get(name) ?? []), f])
    }
    return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) => ({ name, items: items.sort((x, y) => x.key.localeCompare(y.key)) }))
  }, [flags.data, query, groupBy, t])
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data)
  return (
    <div>
      {dialog}
      <PageHead kicker={t("dpage.platform")} title={t("dpage.settings.title")}><span className="text-meta text-steel">{t("set.desc")}</span></PageHead>
      <DevPage className="grid items-start gap-4 space-y-0 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]">
        <Section title={t("set.app")} hint={t("set.appHint")} aside={issues.length ? <span className="rounded-full bg-danger-subtle px-2.5 py-0.5 text-danger">{t("cfg.issues", { n: issues.length })}</span> : dirty ? <span className="text-steel">{t("set.unsaved")}</span> : null}>
          <ErrorLine error={settings.error} />
          {draft == null ? <Loading /> : <><SchemaForm value={draft as never} onChange={setDraft} issues={issues} hide={SETTINGS_EXTRA_PATHS} /><SettingsExtras draft={draft as object} onChange={setDraft} issues={issues} /></>}
          {can("settings.write") && <div className="-mx-4 mt-5 -mb-4 flex gap-2 border-t border-rule bg-surface-sunk px-4 py-3 md:-mx-5 md:-mb-5 md:px-5"><Button size="sm" onClick={() => void save()} loading={busy} disabled={!!issues.length || !dirty}>{t("set.save")}</Button>{dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(structuredClone(settings.data))}>{t("ud.reset")}</Button>}</div>}
        </Section>
        <Section title={t("hl.flags")} hint={t("set.flagsHint")} flush aside={flags.data ? <span className="text-steel" data-testid="flags-summary">{t("set.flags.summary", { n: flags.data.length, on: flags.data.filter((f) => f.enabled).length })}</span> : undefined}>
          <div className="px-4 md:px-5"><ErrorLine error={flags.error} /></div>
          <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-3 md:px-5">
            <input type="search" className="field-input min-w-0 flex-1 basis-44" aria-label={t("set.flags.search")} placeholder={t("set.flags.search")} value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" data-testid="flags-search" />
            <Segmented label={t("set.flags.groupBy")} size="sm" value={groupBy} onChange={setGroupBy} options={[{ value: "area", label: t("set.flags.byArea") }, { value: "owner", label: t("set.flags.byOwner") }]} />
          </div>
          <div data-testid="flags">
            {groups.length === 0 && flags.data && <p className="px-4 py-6 text-center text-steel md:px-5">{t("set.flags.none")}</p>}
            {groups.map((g) => (
              <section key={g.name} aria-label={g.name}>
                <h3 className="flex items-center justify-between gap-2 border-b border-rule bg-surface-sunk px-4 py-1.5 text-caption font-semibold tracking-wide text-ink-muted uppercase md:px-5"><span className="min-w-0 truncate" dir="auto">{g.name}</span><span className="num shrink-0 font-normal normal-case">{g.items.filter((f) => f.enabled).length}/{g.items.length}</span></h3>
                <ul className="divide-y divide-rule">
                  {g.items.map((f) => (
                    <li key={f.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-2.5 md:px-5">
                      <div className="min-w-0">
                        <p className="font-mono text-meta leading-snug font-medium break-all" dir="ltr">{f.key}</p>
                        {f.description && <p className="mt-0.5 text-meta leading-snug [overflow-wrap:anywhere] text-steel" dir="auto">{f.description}</p>}
                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-caption text-steel">
                          {f.owner && <span>{t("set.owner", { o: f.owner })}</span>}
                          {f.removeBy && <span>{t("set.removeBy", { d: f.removeBy })}</span>}
                          {f.updatedAt && <span className="num">{t("set.changed", { at: fmtDateTime(f.updatedAt) })}</span>}
                        </p>
                      </div>
                      <label className="flex min-h-control items-center gap-2 pointer-coarse:min-h-11"><span className={cn("min-w-9 text-end text-meta", f.enabled ? "font-medium text-success" : "text-steel")}>{f.enabled ? t("flag.on") : t("flag.off")}</span><input type="checkbox" role="switch" aria-label={f.key} checked={f.enabled} disabled={!can("flags.write")} onChange={() => ask({ title: t("confirm.flag.title", { key: f.key, state: f.enabled ? t("flag.off") : t("flag.on") }), description: t("confirm.flag.body"), label: t("confirm.flag.label", { state: f.enabled ? t("flag.off") : t("flag.on") }), destructive: f.enabled, run: () => toggle(f) })} /></label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="border-t border-rule px-4 py-3 text-meta text-steel md:px-5">{t("set.payNote")}</p>
        </Section>
      </DevPage>
    </div>
  )
}
