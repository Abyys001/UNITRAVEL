"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Mail, Phone as PhoneIcon } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import type { StaffTicketView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { TileError } from "@/components/bento"
import { CaseHeader, ListSkeleton, PanelTabs, SummaryItem } from "@/components/case"
import { useConfirm } from "@/components/confirm"
import { Segmented } from "@/components/controls"
import { FormDialog } from "@/components/form-dialog"
import { StaffSelect } from "@/components/staff-select"
import { CallsList, ClickToCallButton, LogCallDialog, Phone, RefLink, TicketSla, TicketStatus, useSupportLabels } from "@/components/support"
import { Composer } from "@/components/thread"
import { Empty, Panel } from "@/components/ui"
import { api, ApiError, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useSession } from "@/lib/session"

function Message({ m }: { m: StaffTicketView["messages"][number] }) {
  const { t } = useSupportLabels()
  const note = m.kind === "INTERNAL", staff = m.kind === "STAFF"
  return (
    <li className={cn("max-w-[92%] rounded-lg border px-3 py-2", note ? "border border-s-[3px] border-warning-border border-s-orange bg-warning-subtle" : staff ? "ms-auto border-info-border bg-info-subtle" : "border-rule bg-surface-raised")} data-kind={m.kind}>
      <p className="whitespace-pre-wrap" dir="auto">{m.body}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-caption text-steel">
        <span dir="auto">{m.authorName}</span><span>·</span><span className="num">{fmtDateTime(m.createdAt)}</span>
        <span className="font-medium">{note ? t("sp.msg.note") : staff ? t("sp.msg.staff") : t("sp.msg.customer")}</span>
        {staff && <span className="inline-flex items-center gap-1"><Mail className="size-3" aria-hidden />{m.emailed ? t("sp.msg.emailed") : t("sp.msg.notEmailed")}</span>}
      </p>
    </li>
  )
}

/** One ticket (ADR-0019): thread with reply and internal note, state commands, links to the customer and the request, and its calls. */
export default function TicketPage() {
  const { ref } = useParams<{ ref: string }>()
  const L = useSupportLabels()
  const { t } = L
  const { me, can } = useSession()
  const qc = useQueryClient()
  const { ask, dialog } = useConfirm()
  const q = useQuery({ queryKey: ["support", "ticket", ref], queryFn: () => api<StaffTicketView>(`/v1/admin/support/tickets/${ref}`), refetchInterval: 30_000 })
  const [mode, setMode] = useState<"reply" | "note">("reply")
  const [tab, setTab] = useState<"thread" | "calls">("thread")
  const [assigning, setAssigning] = useState(false)
  const [assignee, setAssignee] = useState("")
  const [logging, setLogging] = useState(false)
  const d = q.data
  const refresh = (next: StaffTicketView) => { qc.setQueryData(["support", "ticket", ref], next); void qc.invalidateQueries({ queryKey: ["support", "tickets"] }); void qc.invalidateQueries({ queryKey: ["support", "home"] }) }
  if (q.error) return <div className="p-5"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!d) return <ListSkeleton rows={6} className="p-5" />

  const send = async (body: string) => { refresh(await api<StaffTicketView>(`/v1/admin/support/tickets/${ref}/replies`, { body: { body, internal: mode === "note" } })) }
  const command = async (command: "assign" | "resolve" | "reopen" | "close", assigneeUserId?: string) => {
    try { refresh(await api<StaffTicketView>(`/v1/admin/support/tickets/${ref}/commands`, { body: { command, expectedVersion: d.version, ...(assigneeUserId ? { assigneeUserId } : {}) } })) } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") { await q.refetch(); throw new Error(t("sp.conflict")) }
      throw e
    }
  }
  const run = (c: "resolve" | "reopen" | "close") => {
    if (c === "close") ask({ title: t("sp.cmd.close.title"), description: t("sp.cmd.close.body"), label: t("sp.cmd.close"), destructive: true, run: () => command(c) })
    else void command(c).then(() => toast.success(t(c === "resolve" ? "sp.cmd.resolve.done" : "sp.cmd.reopen.done"))).catch((e: unknown) => toast.error(errText(e)))
  }
  const canReply = can("support.reply")
  const closed = d.status === "CLOSED"
  const cmd = (c: "assign" | "resolve" | "reopen" | "close") => d.allowedCommands.find((x) => x.command === c)
  const customerHref = d.customerId && can("customer.read") ? `/customers/${d.customerId}` : null
  const phone = d.contact.phone

  return (
    <div>
      {dialog}
      <CaseHeader
        reference={<span className="ref text-lead font-semibold" dir="ltr">{d.ref}</span>}
        title={d.subject}
        meta={<><Link href="/support" className="text-link hover:underline">{t("sp.title")}</Link> · {L.topic(d.topic)} · <span className="num">{fmtDateTime(d.createdAt)}</span></>}
        summary={<>
          <SummaryItem label={t("pg.c.status")}><TicketStatus value={d.status} /></SummaryItem>
          <SummaryItem label={t("pg.c.sla")}><TicketSla ticket={d} /></SummaryItem>
          <SummaryItem label={t("pg.c.assignee")}>{d.assignee ? <span dir="auto" className="font-medium">{d.assignee.name}</span> : <span className="text-steel">{t("case.unassigned")}</span>}</SummaryItem>
          {d.requestRef && <SummaryItem label={t("sp.request")}><RefLink value={d.requestRef} /></SummaryItem>}
        </>}
        aside={canReply ? <div role="group" aria-label={t("case.actions")} className="flex flex-wrap items-center gap-2" data-testid="ticket-actions">
          {cmd("assign")?.allowed && <>
            {me && d.assignee?.userId !== me.id && <Button size="sm" variant="outline" onClick={() => void command("assign", me.id).then(() => toast.success(t("sp.cmd.assign.done"))).catch((e: unknown) => toast.error(errText(e)))}>{t("sp.cmd.assignMe")}</Button>}
            <Button size="sm" variant="outline" onClick={() => setAssigning(true)}>{t("sp.cmd.assign")}</Button>
          </>}
          {cmd("resolve")?.allowed && <Button size="sm" onClick={() => run("resolve")}>{t("sp.cmd.resolve")}</Button>}
          {cmd("reopen")?.allowed && <Button size="sm" onClick={() => run("reopen")}>{t("sp.cmd.reopen")}</Button>}
          {cmd("close")?.allowed && <Button size="sm" variant="outline" onClick={() => run("close")}>{t("sp.cmd.close")}</Button>}
        </div> : undefined}
      />
      <div className="grid gap-x-8 gap-y-2 px-4 pt-3 md:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <PanelTabs id="tk" label={t("sp.tabs")} value={tab} onChange={setTab} tabs={[{ key: "thread", label: t("sp.tab.thread"), count: d.messages.length }, ...(can("call.log") ? [{ key: "calls" as const, label: t("sp.tab.calls"), count: d.calls.length }] : [])]} />
          <section id="tk-pane-thread" role="tabpanel" aria-labelledby="tk-tab-thread" hidden={tab !== "thread"}>
            {!d.messages.length ? <Empty>{t("sp.thread.empty")}</Empty> : <ul className="space-y-2" data-testid="ticket-thread">{d.messages.map((m) => <Message key={m.id} m={m} />)}</ul>}
            {canReply && (closed ? <p className="mt-3 rounded-lg bg-surface-sunk px-3 py-2 text-steel" data-testid="ticket-closed">{t("sp.closed")}</p> : (
              <div className="mt-4">
                <Segmented label={t("sp.mode")} size="sm" value={mode} onChange={setMode} options={[{ value: "reply", label: t("sp.mode.reply") }, { value: "note", label: t("sp.mode.note") }]} />
                <p className="mt-2 text-meta text-steel" data-testid="reply-hint">
                  {mode === "note" ? t("sp.mode.note.hint") : d.contact.email ? t("sp.mode.reply.hint", { email: d.contact.email }) : t("sp.mode.reply.noEmail")}
                </p>
                <Composer key={mode} tone={mode === "note" ? "note" : "message"} label={mode === "note" ? t("sp.mode.note.send") : t("sp.mode.reply.send")} placeholder={mode === "note" ? t("sp.mode.note.ph") : t("sp.mode.reply.ph")} onSend={send} testId={mode === "note" ? "ticket-note" : "ticket-reply"} />
              </div>
            ))}
          </section>
          {can("call.log") && (
            <section id="tk-pane-calls" role="tabpanel" aria-labelledby="tk-tab-calls" hidden={tab !== "calls"} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setLogging(true)}>{t("sp.log.title")}</Button>
              </div>
              <CallsList calls={d.calls} showTicket={false} empty={t("sp.calls.none")} />
            </section>
          )}
        </div>
        <aside className="min-w-0">
          <Panel title={t("sp.contact")}>
            <dl className="space-y-2">
              <div><dt className="cap">{t("sp.contact.name")}</dt><dd className="font-medium"><bdi>{d.contact.name}</bdi></dd></div>
              <div><dt className="cap">{t("sp.contact.email")}</dt><dd className="flex items-center gap-1.5">{d.contact.email ? <bdi dir="ltr" className="break-all">{d.contact.email}</bdi> : <span className="text-steel">—</span>}</dd></div>
              <div><dt className="cap">{t("sp.contact.phone")}</dt><dd className="flex flex-wrap items-center gap-2">{phone ? <><PhoneIcon className="size-3.5 text-steel" aria-hidden /><Phone value={phone} /></> : <span className="text-steel">—</span>}</dd></div>
              <div><dt className="cap">{t("sp.contact.locale")}</dt><dd>{d.locale === "fa" ? t("q.p.lang.fa") : t("q.p.lang.en")}</dd></div>
            </dl>
            {phone && can("call.log") && <div className="mt-3 flex flex-wrap gap-2"><ClickToCallButton number={phone} ticketRef={d.ref} /></div>}
          </Panel>
          <Panel title={t("sp.links")}>
            <ul className="space-y-1.5">
              <li>{customerHref ? <Link href={customerHref} className="text-link hover:underline">{t("sp.link.customer")}</Link> : <span className="text-steel">{d.customerId ? t("sp.link.customer") : t("sp.link.guest")}</span>}</li>
              <li>{d.requestRef ? <span>{t("sp.request")}: <RefLink value={d.requestRef} /></span> : <span className="text-steel">{t("sp.link.noRequest")}</span>}</li>
            </ul>
          </Panel>
        </aside>
      </div>
      {assigning && (
        <FormDialog open onOpenChange={(o) => !o && setAssigning(false)} title={t("sp.cmd.assign")} submitLabel={t("sp.cmd.assign.label")} onSubmit={() => command("assign", assignee)} testId="dlg-assign-ticket">
          <StaffSelect value={assignee} onChange={setAssignee} />
        </FormDialog>
      )}
      {logging && <LogCallDialog open onOpenChange={(o) => !o && setLogging(false)} ticketRef={d.ref} customerId={d.customerId} defaultNumber={phone} />}
    </div>
  )
}
