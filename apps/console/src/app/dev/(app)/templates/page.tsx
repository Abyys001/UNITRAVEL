"use client"

import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { NOTIFICATION_EVENTS } from "@unitravel/contracts"
import { smsSegments } from "@unitravel/domain"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState } from "@/components/bento"
import { Chips, ListCard, Pager, Toolbar, usePaged } from "@/components/data-list"
import { Section } from "@/components/dev-ui"
import { ErrorLine, Field, Loading, PageHead, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Template { id: string; eventType: string; channel: string; locale: "en" | "fa"; title: string; body: string; variables: string[]; providerTemplateId?: string | null; active: boolean; version: number; segments?: { encoding: string; count: number; chars: number } }

const SAMPLE: Record<string, string> = { ref: "UT-F-8K4Q7M", route: "Tehran → London", code: "123456", status_label: "Quote ready", message_preview: "We tried to call you…", name: "Reza", valid_until: "Sat 14 Nov 18:00" }
const render = (s: string) => s.replace(/\{(\w+)\}/g, (_, v: string) => SAMPLE[v] ?? `‹${v}›`)

/** Templates per event × channel × language with variable preview and the SMS segment counter (ch. 17.4). */
export default function TemplatesPage() {
  const { can } = useSession()
  const tp = useT()
  const q = useQuery({ queryKey: ["templates"], queryFn: () => api<Template[]>("/v1/dev/notification-templates") })
  const [filter, setFilter] = useState({ event: "", channel: "", locale: "", text: "" })
  const [edit, setEdit] = useState<Omit<Template, "id" | "version" | "segments"> | null>(null)
  const [busy, setBusy] = useState(false)
  const all = useMemo(() => q.data ?? [], [q.data])
  const rows = useMemo(() => all.filter((t) => (!filter.event || t.eventType === filter.event) && (!filter.channel || t.channel === filter.channel) && (!filter.locale || t.locale === filter.locale) && (!filter.text || `${t.eventType} ${t.body} ${t.title}`.toLowerCase().includes(filter.text.toLowerCase()))), [all, filter])
  const paged = usePaged(rows)
  if (q.error) return <div className="p-4 md:p-6"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  const canWrite = can("notification.template.write")
  const seg = edit && edit.channel === "SMS" ? smsSegments(render(edit.body)) : null
  const save = async () => { setBusy(true); try { await api("/v1/dev/notification-templates", { method: "PUT", body: { ...edit, providerTemplateId: edit!.providerTemplateId || undefined } }); toast.success(tp("tpl.saved")); await q.refetch() } catch (e) { toast.error(errText(e)) } finally { setBusy(false) } }
  const testSend = async () => { try { await api("/v1/dev/notification-templates/test-send", { body: { eventType: edit!.eventType, channel: edit!.channel } }); toast.success(tp("tpl.testQueued")) } catch (e) { toast.error(errText(e)) } }
  const count = (k: "channel" | "locale", v: string) => all.filter((x) => x[k] === v).length
  return (
    <div>
      <PageHead kicker={tp("dpage.notifications")} title={tp("dpage.templates.title")}><span className="text-[12px] text-steel">{tp("tpl.desc")}</span>{canWrite && <Button size="sm" onClick={() => setEdit({ eventType: filter.event || NOTIFICATION_EVENTS[1], channel: filter.channel || "SMS", locale: (filter.locale || "en") as "en", title: "", body: "", variables: ["ref"], active: true })}>{tp("tpl.new")}</Button>}</PageHead>
      <Toolbar query={filter.text} onQuery={(text) => setFilter({ ...filter, text })} placeholder={tp("tpl.search")} count={rows.length}>
        <NativeSelect aria-label="Event" className="field-input w-56" value={filter.event} onChange={(e) => setFilter({ ...filter, event: e.target.value })}><option value="">{tp("tpl.allEvents")}</option>{NOTIFICATION_EVENTS.map((e) => <option key={e}>{e}</option>)}</NativeSelect>
        <Chips label="Channel" value={filter.channel} onChange={(channel) => setFilter({ ...filter, channel })} options={[{ value: "", label: tp("list.all") }, ...["SMS", "PUSH", "EMAIL", "INBOX"].map((c) => ({ value: c, label: c, count: count("channel", c) }))]} />
        <Chips label="Language" value={filter.locale} onChange={(locale) => setFilter({ ...filter, locale })} options={[{ value: "", label: tp("list.all") }, { value: "en", label: "EN", count: count("locale", "en") }, { value: "fa", label: "FA", count: count("locale", "fa") }]} />
      </Toolbar>
      <div className="grid items-start gap-4 px-4 pb-6 md:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ListCard className="mx-0 mb-0 md:mx-0">
          {!rows.length ? <EmptyState title={tp("list.noMatch")} className="py-10" /> : (
            <ul className="divide-y divide-rule" data-testid="templates">{paged.rows.map((t) => {
              const on = edit?.eventType === t.eventType && edit.channel === t.channel && edit.locale === t.locale
              return <li key={t.id}><button type="button" aria-pressed={on} onClick={() => setEdit({ eventType: t.eventType, channel: t.channel, locale: t.locale, title: t.title, body: t.body, variables: t.variables, providerTemplateId: t.providerTemplateId, active: t.active })} className={cn("block w-full px-4 py-3 text-start hover:bg-hover/60", on && "bg-hover/70 shadow-[inset_3px_0_0_var(--indicator)]")}>
                <span className="flex flex-wrap items-center justify-between gap-1.5"><span className="font-mono text-[12px] font-medium" dir="ltr">{t.eventType}</span><span className="flex gap-1"><Tag value={t.channel} /><Tag value={t.locale.toUpperCase()} />{!t.active && <Tag value="INACTIVE" />}</span></span>
                <span className="mt-1 block truncate text-[12.5px] text-steel" dir={t.locale === "fa" ? "rtl" : "ltr"}>{t.body}</span>
                <span className="mt-0.5 block text-[11.5px] text-steel">v{t.version}{t.segments && ` · ${t.segments.encoding} · ${tp("tpl.segments", { n: t.segments.count })}`}</span>
              </button></li>
            })}</ul>
          )}
          <Pager {...paged} className="border-t border-rule" />
        </ListCard>
        <div className="min-w-0 lg:sticky lg:top-20">
          {!edit ? <div className="rounded-xl border border-dashed border-rule-strong"><EmptyState title={tp("tpl.pick")} hint={tp("tpl.pickHint")} className="py-14" /></div> : (
            <Section title={tp("tpl.editor")} hint={<span dir="ltr">{edit.eventType} · {edit.channel} · {edit.locale}</span>}>
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Event"><NativeSelect className="field-input" value={edit.eventType} onChange={(e) => setEdit({ ...edit, eventType: e.target.value })}>{NOTIFICATION_EVENTS.map((x) => <option key={x}>{x}</option>)}</NativeSelect></Field>
                  <Field label="Channel"><NativeSelect className="field-input" value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })}>{["SMS", "PUSH", "EMAIL", "INBOX"].map((x) => <option key={x}>{x}</option>)}</NativeSelect></Field>
                  <Field label="Language"><NativeSelect className="field-input" value={edit.locale} onChange={(e) => setEdit({ ...edit, locale: e.target.value as "en" })}><option>en</option><option>fa</option></NativeSelect></Field>
                </div>
                {edit.channel !== "SMS" && <Field label={tp("tpl.title")}><input className="field-input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} dir={edit.locale === "fa" ? "rtl" : "ltr"} /></Field>}
                <Field label={tp("tpl.body")} hint={tp("tpl.bodyHint")}><textarea className="field-input min-h-32" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} dir={edit.locale === "fa" ? "rtl" : "ltr"} required /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={tp("tpl.vars")}><input className="field-input font-mono" value={edit.variables.join(", ")} onChange={(e) => setEdit({ ...edit, variables: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} dir="ltr" /></Field>
                  <Field label={tp("tpl.providerId")}><input className="field-input font-mono" value={edit.providerTemplateId ?? ""} onChange={(e) => setEdit({ ...edit, providerTemplateId: e.target.value })} dir="ltr" /></Field>
                </div>
                <label className="flex items-center gap-2"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> {tp("tpl.active")}</label>
                <div className="rounded-lg border border-rule bg-surface-sunk p-3">
                  <p className="cap flex flex-wrap justify-between gap-2">{tp("tpl.preview")}{seg && <span data-testid="segments" className={seg.count > 1 ? "text-orange-700 dark:text-orange-300" : ""}>{seg.encoding} · {tp("tpl.chars", { n: seg.chars })} · {tp("tpl.segments", { n: seg.count })}</span>}</p>
                  {edit.title && <p className="mt-2 font-medium" dir={edit.locale === "fa" ? "rtl" : "ltr"}>{render(edit.title)}</p>}
                  <p className="mt-1 whitespace-pre-wrap" dir={edit.locale === "fa" ? "rtl" : "ltr"}>{render(edit.body)}</p>
                </div>
                {canWrite && <div className="flex flex-wrap gap-2 border-t border-rule pt-4"><Button size="sm" type="submit" loading={busy}>{tp("tpl.save")}</Button><Button size="sm" variant="outline" type="button" onClick={() => void testSend()}>{tp("tpl.test")}</Button><Button size="sm" variant="ghost" type="button" onClick={() => setEdit(null)}>{tp("tpl.close")}</Button></div>}
              </form>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
