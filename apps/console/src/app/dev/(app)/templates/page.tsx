"use client"

import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { NOTIFICATION_EVENTS } from "@unitravel/contracts"
import { smsSegments } from "@unitravel/domain"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { Empty, ErrorLine, Field, Loading, PageHead, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useSession } from "@/lib/session"

interface Template { id: string; eventType: string; channel: string; locale: "en" | "fa"; title: string; body: string; variables: string[]; providerTemplateId?: string | null; active: boolean; version: number; segments?: { encoding: string; count: number; chars: number } }

const SAMPLE: Record<string, string> = { ref: "UT-F-8K4Q7M", route: "Tehran → London", code: "123456", status_label: "Quote ready", message_preview: "We tried to call you…", name: "Reza", valid_until: "Sat 14 Nov 18:00" }
const render = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, v: string) => SAMPLE[v] ?? `‹${v}›`)

/** Templates per event × channel × language with variable preview and the SMS segment counter (ch. 17.4). */
export default function TemplatesPage() {
  const { can } = useSession()
  const q = useQuery({ queryKey: ["templates"], queryFn: () => api<Template[]>("/v1/dev/notification-templates") })
  const [filter, setFilter] = useState({ event: "", channel: "", locale: "" })
  const [edit, setEdit] = useState<Omit<Template, "id" | "version" | "segments"> | null>(null)
  const [busy, setBusy] = useState(false)
  const rows = useMemo(() => (q.data ?? []).filter((t) => (!filter.event || t.eventType === filter.event) && (!filter.channel || t.channel === filter.channel) && (!filter.locale || t.locale === filter.locale)), [q.data, filter])
  if (q.error) return <div className="p-5"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  const seg = edit && edit.channel === "SMS" ? smsSegments(render(edit.body)) : null
  const save = async () => { setBusy(true); try { await api("/v1/dev/notification-templates", { method: "PUT", body: { ...edit, providerTemplateId: edit!.providerTemplateId || undefined } }); toast.success("Template saved"); await q.refetch() } catch (e) { toast.error(errText(e)) } finally { setBusy(false) } }
  const testSend = async () => { try { await api("/v1/dev/notification-templates/test-send", { body: { eventType: edit!.eventType, channel: edit!.channel } }); toast.success("Test queued to your own verified phone/email") } catch (e) { toast.error(errText(e)) } }
  return (
    <div className="flex h-[calc(100dvh-2.75rem-6px)] flex-col">
      <PageHead kicker="Notifications" title="Templates">
        <select aria-label="Event" className="field-input w-56" value={filter.event} onChange={(e) => setFilter({ ...filter, event: e.target.value })}><option value="">All events</option>{NOTIFICATION_EVENTS.map((e) => <option key={e}>{e}</option>)}</select>
        <select aria-label="Channel" className="field-input w-28" value={filter.channel} onChange={(e) => setFilter({ ...filter, channel: e.target.value })}><option value="">Channel</option>{["SMS", "PUSH", "EMAIL", "INBOX"].map((c) => <option key={c}>{c}</option>)}</select>
        <select aria-label="Language" className="field-input w-20" value={filter.locale} onChange={(e) => setFilter({ ...filter, locale: e.target.value })}><option value="">Lang</option><option>en</option><option>fa</option></select>
        {can("notification.template.write") && <Button size="sm" variant="outline" onClick={() => setEdit({ eventType: filter.event || NOTIFICATION_EVENTS[1], channel: filter.channel || "SMS", locale: (filter.locale || "en") as "en", title: "", body: "", variables: ["ref"], active: true })}>New template</Button>}
      </PageHead>
      <div className="flex min-h-0 flex-1">
        <div className="w-[46%] min-w-80 overflow-y-auto border-e border-rule bg-white">
          {!rows.length ? <div className="p-4"><Empty>No templates.</Empty></div> : (
            <ul className="ledger-rows" data-testid="templates">{rows.map((t) => <li key={t.id}><button type="button" onClick={() => setEdit({ eventType: t.eventType, channel: t.channel, locale: t.locale, title: t.title, body: t.body, variables: t.variables, providerTemplateId: t.providerTemplateId, active: t.active })} className={cn("block w-full px-4 py-2 text-start hover:bg-mist/40", edit?.eventType === t.eventType && edit.channel === t.channel && edit.locale === t.locale && "row-focus")}>
              <span className="flex items-center justify-between"><span className="font-mono text-[12px]">{t.eventType}</span><span className="flex gap-1"><Tag value={t.channel} /><Tag value={t.locale.toUpperCase()} />{!t.active && <Tag value="INACTIVE" />}</span></span>
              <span className="block truncate text-slate" dir={t.locale === "fa" ? "rtl" : "ltr"}>{t.body}</span>
              <span className="text-[11px] text-slate">v{t.version}{t.segments && ` · ${t.segments.encoding} · ${t.segments.count} segment${t.segments.count === 1 ? "" : "s"}`}</span>
            </button></li>)}</ul>
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {!edit ? <Empty>Pick a template to edit.</Empty> : (
            <form className="max-w-2xl space-y-3" onSubmit={(e) => { e.preventDefault(); void save() }}>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Event"><select className="field-input" value={edit.eventType} onChange={(e) => setEdit({ ...edit, eventType: e.target.value })}>{NOTIFICATION_EVENTS.map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Channel"><select className="field-input" value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })}>{["SMS", "PUSH", "EMAIL", "INBOX"].map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Language"><select className="field-input" value={edit.locale} onChange={(e) => setEdit({ ...edit, locale: e.target.value as "en" })}><option>en</option><option>fa</option></select></Field>
              </div>
              {edit.channel !== "SMS" && <Field label="Title"><input className="field-input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} dir={edit.locale === "fa" ? "rtl" : "ltr"} /></Field>}
              <Field label="Body" hint={<>Variables as {"{{name}}"}; every variable used must be declared.</>}><textarea className="field-input min-h-32" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} dir={edit.locale === "fa" ? "rtl" : "ltr"} required /></Field>
              <Field label="Declared variables"><input className="field-input font-mono" value={edit.variables.join(", ")} onChange={(e) => setEdit({ ...edit, variables: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Provider template id"><input className="field-input font-mono" value={edit.providerTemplateId ?? ""} onChange={(e) => setEdit({ ...edit, providerTemplateId: e.target.value })} /></Field>
                <label className="flex items-center gap-2 self-end pb-1.5"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
              </div>
              <div className="rounded-md border border-rule bg-paper p-3">
                <p className="cap flex justify-between">Preview with sample values{seg && <span data-testid="segments" className={seg.count > 1 ? "text-copper-700" : ""}>{seg.encoding} · {seg.chars} chars · {seg.count} segment{seg.count === 1 ? "" : "s"}</span>}</p>
                {edit.title && <p className="mt-1 font-medium" dir={edit.locale === "fa" ? "rtl" : "ltr"}>{render(edit.title)}</p>}
                <p className="mt-1 whitespace-pre-wrap" dir={edit.locale === "fa" ? "rtl" : "ltr"}>{render(edit.body)}</p>
              </div>
              {can("notification.template.write") && <div className="flex gap-2"><Button size="sm" type="submit" loading={busy}>Save template</Button><Button size="sm" variant="outline" type="button" onClick={() => void testSend()}>Send test to me</Button></div>}
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
