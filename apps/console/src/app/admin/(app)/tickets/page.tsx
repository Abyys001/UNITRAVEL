"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { TICKET_DOCUMENT_KINDS, TICKET_DOCUMENT_STATUSES, type TicketDocumentStaffPage, type TicketDocumentStaffSummary } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { Chips, ListCard, ListPage, tableClass, Toolbar } from "@/components/data-list"
import { kindLabel } from "@/components/tickets/shared"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, human } from "@/lib/format"
import { useDebounced } from "@/lib/hooks"
import { type MsgKey, statusText, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

const FIELDS = ["q", "passenger", "customer", "pnr", "ticketNumber", "requestRef"] as const
type FieldKey = (typeof FIELDS)[number]
const FIELD_LABEL: Record<FieldKey, MsgKey> = { q: "td.list.f.q", passenger: "td.list.f.passenger", customer: "td.list.f.customer", pnr: "td.list.f.pnr", ticketNumber: "td.list.f.ticket", requestRef: "td.list.f.request" }

/** Flight tickets (ADR-0038): every ticket document version, searched by the API (passenger, customer, PNR, ticket number, request). */
export default function TicketDocumentsList() {
  const t = useT()
  const { can } = useSession()
  const [text, setText] = useState("")
  const [field, setField] = useState<FieldKey>("q")
  const [status, setStatus] = useState("")
  const [kind, setKind] = useState("")
  const q = useDebounced(text.trim())
  const list = useInfiniteQuery({
    queryKey: ["td", "list", field, q, status, kind],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const u = new URLSearchParams({ limit: "50" })
      if (q) u.set(field, q)
      if (status) u.set("status", status)
      if (kind) u.set("kind", kind)
      if (pageParam) u.set("cursor", pageParam)
      return api<TicketDocumentStaffPage>(`/v1/admin/ticket-documents?${u.toString()}`)
    },
    getNextPageParam: (p) => p.nextCursor,
    refetchInterval: 60_000,
  })
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const open = (r: TicketDocumentStaffSummary) => <Link href={`/tickets/${r.id}`} className="ref font-semibold text-link hover:underline" data-testid="td-link">{r.requestRef} · v{r.version}</Link>
  const pax = (r: TicketDocumentStaffSummary) => r.passengers.map((p) => p.name).join(", ")
  const checks = (r: TicketDocumentStaffSummary) => !r.allMatched ? <span className="text-danger">{t("td.list.codesFailed")}</span> : r.textWarnings ? <span className="text-orange-700 dark:text-orange-300">{t("td.list.textWarn")}</span> : <span className="text-success">{t("td.list.ok")}</span>
  const delivery = (r: TicketDocumentStaffSummary) => r.lastDelivery
    ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={fmtDateTime(r.lastDelivery.at)} data-testid="td-last-delivery"><StateChip value={r.lastDelivery.status} /><span className="text-meta text-steel">{human(r.lastDelivery.channel)}</span></span>
    : <span className="text-steel">{t("td.list.notSent")}</span>
  const cols: MsgKey[] = ["td.list.c.doc", "td.list.c.passengers", "pg.c.customer", "td.kind", "pg.c.status", "td.pnr", "td.list.c.checks", "td.list.c.delivery", "td.list.c.uploaded", "td.list.c.issued"]
  return (
    <ListPage>
      <PageHead title={t("td.area")}>{can("ticket.document.issue") && <Button size="sm" nativeButton={false} render={<Link href="/tickets/issue" />} data-testid="issue-new"><Plus aria-hidden />{t("td.issue.title")}</Button>}</PageHead>
      <Toolbar query={text} onQuery={setText} placeholder={t(FIELD_LABEL[field])} count={list.data ? rows.length : undefined}
        trailing={<label className="flex items-center gap-1.5 text-meta text-steel">{t("td.list.searchIn")}<NativeSelect className="field-input h-8 w-auto py-0" value={field} onChange={(e) => setField(e.target.value as FieldKey)} data-testid="search-field">{FIELDS.map((f) => <option key={f} value={f}>{t(FIELD_LABEL[f])}</option>)}</NativeSelect></label>}>
        <Chips label={t("pg.c.status")} value={status} options={[{ value: "", label: t("pg.all") }, ...TICKET_DOCUMENT_STATUSES.map((s) => ({ value: s as string, label: statusText(t, s) }))]} onChange={setStatus} />
        <Chips label={t("td.kind")} value={kind} options={[{ value: "", label: t("pg.all") }, ...TICKET_DOCUMENT_KINDS.map((k) => ({ value: k as string, label: kindLabel(t, k) }))]} onChange={setKind} />
      </Toolbar>
      {list.error ? <div className="px-6 py-3"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : !list.data ? <ListSkeleton rows={6} className="px-6" /> : !rows.length ? <EmptyState title={t("td.list.none")} hint={can("ticket.document.issue") ? t("td.list.noneHint") : undefined} /> : (
        <>
          <ul className="space-y-2 px-4 md:hidden" data-testid="td-cards">
            {rows.map((r) => (
              <li key={r.id} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)]">
                <p className="flex items-center justify-between gap-2">{open(r)}<StateChip value={r.status} /></p>
                <p className="mt-1 text-meta" dir="auto">{pax(r)}</p>
                <p className="mt-0.5 text-meta text-steel" dir="auto">{r.customer.name} · {kindLabel(t, r.kind)}{r.pnr && <> · <span className="num">{r.pnr}</span></>}</p>
                <p className="mt-1 flex items-center gap-2 text-meta"><span className="text-steel">{t("td.list.c.delivery")}</span>{delivery(r)}</p>
                <p className="mt-1 flex flex-wrap justify-between gap-2 text-meta"><span className="num text-steel">{t("td.list.c.uploaded")} {fmtDateTime(r.createdAt)}{r.issuedAt && ` · ${t("td.list.c.issued")} ${fmtDateTime(r.issuedAt)}`}</span>{checks(r)}</p>
              </li>
            ))}
          </ul>
          <ListCard fill className="hidden md:flex">
            <TableScroll label={t("td.area")}><table className={tableClass} data-testid="td-table">
              <thead><tr>{cols.map((h) => <th key={h}>{t(h)}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{open(r)}</td>
                    <td dir="auto" className="max-w-64 truncate" title={pax(r)}>{pax(r)}</td>
                    <td dir="auto">{r.customer.name}</td>
                    <td className="whitespace-nowrap">{kindLabel(t, r.kind)}</td>
                    <td><StateChip value={r.status} /></td>
                    <td className="num">{r.pnr ?? "—"}</td>
                    <td className="whitespace-nowrap text-meta">{checks(r)}</td>
                    <td>{delivery(r)}</td>
                    <td className="num whitespace-nowrap text-steel">{fmtDateTime(r.createdAt)}</td>
                    <td className="num whitespace-nowrap text-steel">{fmtDateTime(r.issuedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table></TableScroll>
          </ListCard>
          {list.hasNextPage && <div className="flex justify-center p-4"><Button variant="outline" size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("td.list.more")}</Button></div>}
        </>
      )}
    </ListPage>
  )
}
