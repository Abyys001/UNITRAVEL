"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import type { TicketDocumentStaffSummary } from "@unitravel/contracts"

import { StateChip } from "@/components/case"
import { Arrow, Empty, ErrorLine, Panel } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

import { kindLabel } from "./shared"

const DRAFTABLE = new Set(["ACCEPTED", "RESERVED", "TICKETED", "COMPLETED"])

/** Ticket documents of one flight request, newest first, with a link into the issue wizard for this request. */
export function TicketDocumentsPanel({ requestRef, status }: { requestRef: string; status: string }) {
  const t = useT()
  const { can } = useSession()
  const q = useQuery({ queryKey: ["td", "request", requestRef], queryFn: () => api<{ items: TicketDocumentStaffSummary[] }>(`/v1/admin/flight-requests/${requestRef}/ticket-documents`), enabled: can("ticket.record") })
  if (!can("ticket.record")) return null
  const items = q.data?.items ?? []
  return (
    <Panel title={t("td.panel.title")} aside={can("ticket.document.issue") && DRAFTABLE.has(status) && <Link href={`/tickets/issue?ref=${encodeURIComponent(requestRef)}`} className="font-medium text-link hover:underline" data-testid="issue-ticket-link">{t("td.panel.issue")} <Arrow /></Link>}>
      <ErrorLine error={q.error} />
      {q.data && !items.length ? <Empty>{t("td.panel.none")}</Empty> : (
        <ul className="ledger-rows" data-testid="request-ticket-docs">
          {items.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="min-w-0"><Link href={`/tickets/${x.id}`} className="font-medium text-link hover:underline">{kindLabel(t, x.kind)} · v{x.version}</Link><span className="block truncate text-caption text-steel" dir="auto">{x.passengers.map((p) => p.name).join(", ")}</span></span>
              <span className="flex items-center gap-2"><span className="num text-caption text-steel">{fmtDateTime(x.issuedAt ?? x.createdAt)}</span><StateChip value={x.status} /></span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
