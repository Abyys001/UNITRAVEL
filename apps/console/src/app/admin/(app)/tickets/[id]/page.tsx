"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"

import type { TicketDocumentStaffDetail } from "@unitravel/contracts"

import { ListSkeleton, StateChip, SummaryItem, TableScroll } from "@/components/case"
import { IssueControls, TicketActions } from "@/components/tickets/actions"
import { DownloadButtons, IntegrityPanel, kindLabel, PreviewPair } from "@/components/tickets/shared"
import { ErrorLine, PageHead, Panel, RouteText } from "@/components/ui"
import { api } from "@/lib/api"
import { useCrumbLabel } from "@/lib/crumb"
import { fmtDateTime, human } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/** One ticket document version (ADR-0038): files, checks, versions, deliveries, audit, and the commands the API allows. */
export default function TicketDocumentPage() {
  const { id } = useParams<{ id: string }>()
  const t = useT()
  const { can } = useSession()
  const q = useQuery({ queryKey: ["td", "detail", id], queryFn: () => api<TicketDocumentStaffDetail>(`/v1/admin/ticket-documents/${id}`), refetchInterval: (s) => (s.state.data?.deliveries.some((x) => x.status === "QUEUED") ? 5_000 : 60_000) })
  const d = q.data
  useCrumbLabel(d ? `${d.requestRef} · v${d.version}` : null)
  if (q.error) return <div className="p-6"><ErrorLine error={q.error} /></div>
  if (!d) return <ListSkeleton rows={6} className="px-6 pt-6" />
  const issuer = can("ticket.document.issue")
  return (
    <div className="pb-10" data-testid="td-detail">
      <PageHead kicker={<>{t("td.area")} · <Link href={`/requests/${d.requestRef}`} className="ref text-link hover:underline">{d.requestRef}</Link></>} title={<span className="flex flex-wrap items-center gap-2">{kindLabel(t, d.kind)} · v{d.version} <StateChip value={d.status} /></span>}>
        <TicketActions d={d} />
      </PageHead>
      <div className="grid gap-x-6 px-4 md:px-6 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
        <div className="min-w-0">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryItem className="flex-col items-start" label={t("pg.c.customer")}><span dir="auto">{d.customer.name}</span></SummaryItem>
            <SummaryItem className="flex-col items-start" label={t("td.pnr")}><span className="num">{d.pnr ?? "—"}</span></SummaryItem>
            <SummaryItem className="flex-col items-start" label={t("td.list.c.uploaded")}><span className="num">{fmtDateTime(d.createdAt)}</span></SummaryItem>
            <SummaryItem className="flex-col items-start" label={t("td.list.c.issued")}><span className="num">{fmtDateTime(d.issuedAt)}</span></SummaryItem>
          </div>
          {d.status === "SUPERSEDED" && d.supersededById && <p className="mb-3 rounded-sm bg-surface-sunk px-3 py-2">{t("td.det.superseded")} <Link className="text-link hover:underline" href={`/tickets/${d.supersededById}`}>{t("td.det.current")}</Link></p>}
          {d.revokedReason && <p className="mb-3 rounded-sm bg-danger-subtle px-3 py-2 text-danger">{t("td.det.revoked")} <span dir="auto">“{d.revokedReason}”</span></p>}
          {d.reason && <p className="mb-3 text-meta text-steel">{t("td.det.reason")} <span dir="auto">“{d.reason}”</span></p>}
          {issuer ? <Panel title={t("td.prev.title")}><PreviewPair id={d.id} branded={!!d.brandedDocumentId} /></Panel> : <Panel title={t("td.det.files")}><DownloadButtons id={d.id} branded={!!d.brandedDocumentId} /></Panel>}
          <Panel title={t("td.det.cover")}>
            <ul className="ledger-rows">
              {d.passengers.map((p) => <li key={p.travellerId} className="flex justify-between gap-2 py-1"><span dir="auto">{p.name}</span><span className="num">{p.ticketNumber ?? "—"}</span></li>)}
            </ul>
            {d.segments.length > 0 && <ul className="mt-2 space-y-0.5 text-meta" data-testid="td-segments">{d.segments.map((s, i) => <li key={i}><RouteText><span className="num">{s.carrier}{s.flightNumber}</span> {s.origin}→{s.destination}</RouteText> <span className="num text-steel">{s.departureLocal?.replace("T", " ") ?? fmtDateTime(s.departureUtc)}</span>{s.airlineName && <span className="text-steel"> · {s.airlineName}</span>}</li>)}</ul>}
            {d.notes && <p className="mt-2 text-meta" dir="auto">“{d.notes}”</p>}
          </Panel>
        </div>
        <div className="min-w-0">
          {d.status === "DRAFT" && issuer && <Panel title={t("td.issue.panel")}><IssueControls d={d} /></Panel>}
          <Panel title={t("td.int.title")}><IntegrityPanel v={d.verification} /></Panel>
          <Panel title={t("td.det.versions")}>
            <ol className="ledger-rows" data-testid="td-versions">
              {d.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  {v.id === d.id ? <span className="font-semibold">v{v.version} · {kindLabel(t, v.kind)}</span> : <Link href={`/tickets/${v.id}`} className="text-link hover:underline">v{v.version} · {kindLabel(t, v.kind)}</Link>}
                  <span className="flex items-center gap-2"><span className="num text-caption text-steel">{fmtDateTime(v.issuedAt ?? v.createdAt)}</span><StateChip value={v.status} /></span>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title={t("td.det.deliveries")}>
            {!d.deliveries.length ? <p className="text-steel">{t("td.det.noDeliveries")}</p> : (
              <TableScroll label={t("td.det.deliveries")}><table className="data-table w-full" data-testid="td-deliveries">
                <thead><tr><th>{t("td.det.event")}</th><th>{t("td.det.to")}</th><th>{t("pg.c.status")}</th><th>{t("td.det.when")}</th></tr></thead>
                <tbody>{d.deliveries.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap">{x.event === "ticket.resent" ? t("td.det.resent") : t("td.det.issued")} · {human(x.channel)}</td>
                    <td><span className="block">{x.recipient === "ACCOUNT" ? t("td.det.account") : t("td.det.passenger")}</span><span className="num text-caption text-steel" dir="ltr">{x.destination ?? "—"}</span></td>
                    <td><StateChip value={x.status} />{x.error && <span className="block text-caption text-danger">{x.error}</span>}</td>
                    <td className="num whitespace-nowrap text-steel">{fmtDateTime(x.deliveredAt ?? x.sentAt ?? x.createdAt)}</td>
                  </tr>
                ))}</tbody>
              </table></TableScroll>
            )}
          </Panel>
          <Panel title={t("td.det.audit")}>
            {!d.audit.length ? <p className="text-steel">—</p> : (
              <ol className="ledger-rows text-meta" data-testid="td-audit">
                {d.audit.map((a, i) => (
                  <li key={i} className="py-1.5">
                    <p className="flex justify-between gap-2"><span className="font-mono">{a.action}</span><span className="num text-steel">{fmtDateTime(a.at)}</span></p>
                    <p className="text-caption text-steel" dir="auto">{a.actorName ?? t("td.det.system")}{a.detail && Object.keys(a.detail).length > 0 && <> · <span dir="ltr" className="font-mono">{Object.entries(a.detail).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ").slice(0, 200)}</span></>}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <p className="mt-2 font-mono text-2xs break-all text-steel" dir="ltr">sha256 {d.originalSha256}{d.brandedSha256 && <><br />sha256 {d.brandedSha256}</>}</p>
        </div>
      </div>
    </div>
  )
}
