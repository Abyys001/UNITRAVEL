"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"

import type { StaffServiceRequestView } from "@unitravel/contracts"

import { TileError } from "@/components/bento"
import { ActionBar, CaseHeader, CaseTabs, CommandBar, ListSkeleton, paneClass, paneProps, SlaChip, SummaryItem, Timeline } from "@/components/case"
import { isConflict, QuotesList, SERVICE_DIALOG_COMMANDS, ServiceCommandDialog, ServiceDetails, ServiceStatus, useServiceLabels } from "@/components/service-request"
import { Composer, MessagesList } from "@/components/thread"
import { Loading, Panel } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useCrumbLabel } from "@/lib/crumb"
import { fmtDateTime } from "@/lib/format"
import { useKeys } from "@/lib/hooks"
import { useFallbackInterval } from "@/lib/live"
import { useSession } from "@/lib/session"

/**
 * One service request (ADR-0015): customer, the form they sent, quotes, messages and the status trail. Commands are the
 * server's `allowedCommands`; each is sent with the version on screen and a VERSION_CONFLICT reloads the request.
 */
export default function ServiceRequestPage() {
  const { ref } = useParams<{ ref: string }>()
  const qc = useQueryClient()
  const { me, can } = useSession()
  const L = useServiceLabels()
  const { t } = L
  const key = ["services", "detail", ref]
  const q = useQuery({ queryKey: key, queryFn: () => api<StaffServiceRequestView>(`/v1/admin/service-requests/${ref}`), refetchInterval: useFallbackInterval(20_000) })
  const d = q.data
  useCrumbLabel(d?.ref)
  const [command, setCommand] = useState<string | null>(null)
  const [tab, setTab] = useState<"case" | "people" | "records">("case")
  const msgRef = useRef<HTMLTextAreaElement>(null)
  const refresh = async () => { await qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["services", "list"] }) }
  const done = async (r: StaffServiceRequestView) => { qc.setQueryData(key, r); void qc.invalidateQueries({ queryKey: ["services", "list"] }) }
  const run = async (c: string) => {
    if (SERVICE_DIALOG_COMMANDS.has(c)) return setCommand(c)
    try {
      const r = await api<StaffServiceRequestView>(`/v1/admin/service-requests/${ref}/transition`, { body: { command: c, expectedVersion: d!.version, input: {} } })
      toast.success(t("svc.done", { c: L.command(c).replace("…", "") }))
      await done(r)
    } catch (e) {
      if (isConflict(e)) { await refresh(); toast.error(t("svc.conflict")) } else toast.error(errText(e))
    }
  }
  useKeys({ c: () => { if (d?.allowedCommands.find((a) => a.command === "claim")?.allowed) void run("claim") }, m: () => msgRef.current?.focus() }, !!d)
  if (q.error) return <div className="p-5"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!d) return <><Loading label={`${ref}…`} /><ListSkeleton rows={6} /></>
  const mine = d.assignee?.userId === me?.id
  const timeline = [...d.timeline].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return (
    <div className="pb-8">
      <CaseHeader
        reference={<span className="ref text-lead font-semibold" data-testid="ref">{d.ref}</span>}
        title={d.title}
        meta={<>{L.type(d.type)} · {t("svc.via", { at: fmtDateTime(d.createdAt), via: d.submittedVia.toLowerCase(), locale: d.submittedLocale })}</>}
        summary={<>
          <span data-testid="status"><ServiceStatus value={d.status} /></span>
          <SummaryItem label={t("case.sla")}>{d.slaDueAt ? <SlaChip dueAt={d.slaDueAt} startAt={d.createdAt} /> : <span className="text-steel">{t("sla.none")}</span>}</SummaryItem>
          <SummaryItem label={t("case.owner.short")}><span className="font-medium" data-testid="assignee">{d.assignee ? (mine ? t("case.assignedYou") : t("case.assignedTo", { name: d.assignee.name })) : <span className="text-danger">{t("case.unassigned")}</span>}</span></SummaryItem>
          {d.complianceCaseId && <SummaryItem label={t("svc.compliance")}>{can("compliance.case.read") ? <Link href={`/compliance/${d.complianceCaseId}`} className="font-medium text-link hover:underline">{t("svc.compliance.open")}</Link> : <span className="text-steel">{t("svc.compliance.note")}</span>}</SummaryItem>}
        </>}
      />
      <ActionBar data-testid="actions" aria-label={t("case.actions")}>
        <CommandBar actions={d.allowedCommands} onRun={(c) => void run(c)} none={t("case.actions.none", { status: L.status(d.status) })} hint={<><span className="kbd">c</span> claim · <span className="kbd">m</span> message · {t("case.actions.hint")}</>} />
      </ActionBar>
      <CaseTabs label={t("case.tabs")} value={tab} onChange={setTab} tabs={[{ key: "case", label: t("case.tab.case") }, { key: "people", label: t("case.tab.customer") }, { key: "records", label: t("case.tab.records") }]} />
      <div className="grid gap-x-8 px-5 pt-2 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <div {...paneProps("people")} className={paneClass(tab, "people")}>
          <Panel title={t("svc.customer")} aside={can("customer.read.pii") && <Link className="font-medium text-link hover:underline" href={`/customers/${d.customer.userId}?ref=${d.ref}`}>{t("svc.customer.context")}</Link>}>
            <p className="font-medium" dir="auto" data-testid="service-customer">{d.customer.name}</p>
            {d.customer.phone && <p className="num" dir="ltr"><a href={`tel:${d.customer.phone}`} className="text-link hover:underline">{d.customer.phone}</a></p>}
          </Panel>
          {d.travellers.length > 0 && (
            <Panel title={t("svc.travellers")}>
              <ul className="ledger-rows">{d.travellers.map((p) => <li key={p.id} className="py-1"><span dir="auto">{p.name}</span>{p.nationality && <span className="text-steel"> · {p.nationality}</span>}</li>)}</ul>
            </Panel>
          )}
        </div>
        <div {...paneProps("case")} className={`min-w-0 ${paneClass(tab, "case")}`}>
          <Panel title={`${t("svc.details")} · ${L.type(d.type)}`}><ServiceDetails d={d} /></Panel>
          <Panel title={t("case.conversation")}>
            <MessagesList messages={d.messages} />
            {can("service_request.write") && <Composer ref={msgRef} hint={t("case.composer.message")} label={t("svc.msg.send")} placeholder={t("svc.msg.placeholder")} testId="service-composer"
              onSend={async (body) => { try { await api(`/v1/admin/service-requests/${ref}/messages`, { body: { body, documentIds: [] } }); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
          </Panel>
        </div>
        <div {...paneProps("records")} className={`${paneClass(tab, "records")} lg:col-span-2 xl:col-span-1`}>
          <Panel title={t("svc.quotes")}><QuotesList d={d} /></Panel>
          <Panel title={t("case.activity")}><Timeline data-testid="service-timeline" items={timeline.map((x, i) => ({ id: i, at: x.at, title: x.toStatus ? <>{x.label} <span className="text-steel">→</span> {L.status(x.toStatus)}</> : x.label, detail: x.detail, meta: x.actor, tone: x.kind === "STATUS" ? "strong" : "muted" }))} /></Panel>
        </div>
      </div>
      <ServiceCommandDialog command={command} d={d} version={d.version} onClose={() => setCommand(null)} done={done} onConflict={refresh} />
    </div>
  )
}
