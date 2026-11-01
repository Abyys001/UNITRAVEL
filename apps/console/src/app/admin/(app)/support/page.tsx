"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useMemo, useState } from "react"

import { type StaffTicketPage, type StaffTicketSummary } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { Switch } from "@/components/controls"
import { Chips, ListCard, ListPage, tableClass, Toolbar } from "@/components/data-list"
import { LogCallDialog, SUPPORT_TICKET_STATUSES, SUPPORT_TOPICS, TicketSla, TicketStatus, useSupportLabels } from "@/components/support"
import { PageHead } from "@/components/ui"
import { fmtDateTime, rel } from "@/lib/format"
import { useDebounced } from "@/lib/hooks"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"

/**
 * Support inbox (ADR-0019, plan J5): `GET /v1/admin/support/tickets`, filtered and paged by the server. The staff event
 * stream does not carry ticket changes, so the list polls instead of relying on the stream.
 */
function Inbox() {
  const L = useSupportLabels()
  const { t } = L
  const { can } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const status = params.get("status") ?? ""
  const topic = params.get("topic") ?? ""
  const assignee = params.get("assignee") ?? ""
  const overdue = params.get("overdue") === "1"
  const [search, setSearch] = useState("")
  const q = useDebounced(search.trim(), 300)
  const [logging, setLogging] = useState(false)
  const apply = (patch: Record<string, string>) => {
    const u = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) { if (v) u.set(k, v); else u.delete(k) }
    const qs = u.toString()
    router.replace(qs ? `/support?${qs}` : "/support")
  }
  const list = useInfiniteQuery({
    queryKey: ["support", "tickets", status, topic, assignee, overdue, q],
    queryFn: ({ pageParam }) => {
      const u = new URLSearchParams({ limit: "25" })
      if (status) u.set("status", status)
      if (topic) u.set("topic", topic)
      if (assignee) u.set("assignee", assignee)
      if (overdue) u.set("overdue", "true")
      if (q) u.set("q", q)
      if (pageParam) u.set("cursor", pageParam)
      return api<StaffTicketPage>(`/v1/admin/support/tickets?${u.toString()}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 30_000,
  })
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data])
  const href = (r: StaffTicketSummary) => `/support/${r.ref}`
  const more = list.hasNextPage && <div className="flex justify-center border-t border-rule p-3"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("common.loadMore")}</Button></div>
  const assignee_ = (r: StaffTicketSummary) => r.assignee ? <span dir="auto">{r.assignee.name}</span> : <span className="text-steel">{t("case.unassigned")}</span>
  return (
    <ListPage>
      <PageHead title={t("sp.title")}>
        {can("call.log") && <Button size="sm" variant="outline" onClick={() => setLogging(true)}>{t("sp.log.title")}</Button>}
      </PageHead>
      <Toolbar query={search} onQuery={setSearch} placeholder={t("sp.search")} count={list.data && !list.hasNextPage ? rows.length : undefined}
        trailing={<Switch checked={overdue} onChange={(v) => apply({ overdue: v ? "1" : "" })} label={t("sp.overdue")} testId="sp-overdue" />}>
        <Chips label={t("sp.f.status")} value={status} options={[{ value: "", label: t("pg.all") }, ...SUPPORT_TICKET_STATUSES.map((s) => ({ value: s, label: L.status(s) }))]} onChange={(v) => apply({ status: v })} />
        <label className="w-full sm:w-44">
          <span className="sr-only">{t("sp.f.topic")}</span>
          <NativeSelect className="field-input" value={topic} onChange={(e) => apply({ topic: e.target.value })} data-testid="sp-topic">
            <option value="">{t("sp.f.anyTopic")}</option>
            {SUPPORT_TOPICS.map((x) => <option key={x} value={x}>{L.topic(x)}</option>)}
          </NativeSelect>
        </label>
        <label className="w-full sm:w-44">
          <span className="sr-only">{t("sp.f.assignee")}</span>
          <NativeSelect className="field-input" value={assignee} onChange={(e) => apply({ assignee: e.target.value })} data-testid="sp-assignee">
            <option value="">{t("sp.f.anyone")}</option>
            <option value="me">{t("sp.f.me")}</option>
            <option value="none">{t("sp.f.none")}</option>
          </NativeSelect>
        </label>
      </Toolbar>
      {list.error ? <div className="px-4 py-3 md:px-6"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : !list.data ? <ListSkeleton rows={6} className="px-4 md:px-6" /> : !rows.length ? <EmptyState title={t("sp.none")} hint={t("sp.none.hint")} /> : (
        <>
          <ul className="space-y-2 px-4 pb-4 md:px-6 xl:hidden" data-testid="ticket-cards">
            {rows.map((r) => (
              <li key={r.ref}>
                <Link href={href(r)} className="block min-h-11 rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)] active:bg-hover">
                  <span className="flex items-center justify-between gap-2"><span className="ref font-medium" dir="ltr">{r.ref}</span><TicketStatus value={r.status} /></span>
                  <span className="mt-1 block font-medium" dir="auto">{r.subject}</span>
                  <span className="mt-1 block text-steel">{L.topic(r.topic)} · <span dir="auto">{r.contactName}</span></span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-meta text-steel"><TicketSla ticket={r} />{assignee_(r)}<span className="num ms-auto" title={fmtDateTime(r.updatedAt)}>{rel(r.updatedAt)}</span></span>
                </Link>
              </li>
            ))}
            {more && <li>{more}</li>}
          </ul>
          <ListCard fill className="hidden xl:flex">
            <TableScroll label={t("sp.title")}>
              <table className={tableClass} data-testid="tickets">
                <thead><tr><th>{t("pg.c.ref")}</th><th>{t("sp.c.subject")}</th><th>{t("sp.f.topic")}</th><th>{t("pg.c.status")}</th><th>{t("pg.c.assignee")}</th><th>{t("pg.c.sla")}</th><th className="text-end">{t("sp.c.messages")}</th><th>{t("svc.c.updated")}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ref} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(href(r)) }}>
                      <td className="whitespace-nowrap"><Link href={href(r)} className="ref inline-block py-1 font-semibold text-link hover:underline" dir="ltr">{r.ref}</Link></td>
                      <td className="max-w-80"><span className="block truncate font-medium" dir="auto">{r.subject}</span><span className="block truncate text-caption text-steel" dir="auto">{r.contactName}</span></td>
                      <td className="whitespace-nowrap">{L.topic(r.topic)}</td>
                      <td className="whitespace-nowrap"><TicketStatus value={r.status} /></td>
                      <td className="whitespace-nowrap">{assignee_(r)}</td>
                      <td className="whitespace-nowrap"><TicketSla ticket={r} /></td>
                      <td className="num text-end">{r.messageCount}</td>
                      <td className="num whitespace-nowrap text-steel" title={fmtDateTime(r.updatedAt)}>{rel(r.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            {more}
          </ListCard>
        </>
      )}
      {logging && <LogCallDialog open onOpenChange={(o) => !o && setLogging(false)} />}
    </ListPage>
  )
}

export default function SupportPage() { return <Suspense><Inbox /></Suspense> }
