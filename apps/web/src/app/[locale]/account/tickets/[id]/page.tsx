"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Info } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"

import type { CustomerTicketDocument } from "@unitravel/contracts"
import { ErrorState, LoadingState } from "@unitravel/ui/product/states"

import { Auto, Ltr } from "@/components/badges"
import { KindBadge, PnrCopy, SegmentList, TicketActions } from "@/components/ticket-documents"
import { api, type ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, href, date, sep } = useI18n()
  const { me } = useRequireSignIn()
  const q = useQuery({ queryKey: ["ticket-document", id], queryFn: () => api<CustomerTicketDocument>(`/v1/ticket-documents/${id}`), enabled: !!me, retry: (n, e) => (e as ApiError).problem?.status !== 404 && n < 2 })
  if (!me) return null
  const d = q.data
  const back = <Link href={href("/account/tickets")} className="inline-flex items-center gap-1.5 text-sm font-medium text-royal underline underline-offset-4"><ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{t("ticketDocuments.portal.back")}</Link>
  if (!d) return (
    <>
      {back}
      <div className="mt-4">{q.isError
        ? <ErrorState title={(q.error as ApiError).problem?.status === 404 ? t("ticketDocuments.portal.notFound") : t("ticketDocuments.portal.loadFailed")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />
        : <LoadingState label={t("common.loading")} rows={3} />}</div>
    </>
  )
  const airlines = d.airlines.map((a) => a.name ?? a.code).join(sep)
  return (
    <>
      {back}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-steel"><Link href={href(`/requests/${d.requestRef}`)} className="underline underline-offset-4">{t("ticketDocuments.portal.request", { ref: d.requestRef })}</Link>{sep}{t("ticketDocuments.portal.issued", { date: date(d.issuedAt, { year: true }) })}</p>
          <h1 className="font-display text-3xl md:text-4xl"><Auto>{airlines || t("ticketDocuments.portal.title")}</Auto></h1>
        </div>
        <KindBadge kind={d.kind} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section aria-labelledby="td-segments"><h2 id="td-segments" className="font-display mb-3 text-xl">{t("ticketDocuments.portal.segments")}</h2><SegmentList segments={d.segments} /></section>
          <section aria-labelledby="td-pax"><h2 id="td-pax" className="font-display mb-3 text-xl">{t("ticketDocuments.portal.passengers")}</h2>
            <ul className="card-brand divide-y divide-line overflow-hidden text-sm">{d.passengers.map((p) => (
              <li key={p.travellerId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <Auto className="font-medium">{p.name}</Auto>
                <span className="text-steel">{p.ticketNumber ? <><span className="sr-only">{t("ticketDocuments.portal.ticketNumber")}: </span><Ltr className="font-mono text-navy-900">{p.ticketNumber}</Ltr></> : t("ticketDocuments.portal.noTicketNumber")}</span>
              </li>
            ))}</ul>
          </section>
        </div>
        <aside className="space-y-4">
          {d.pnr && <section className="card-brand p-5"><h2 className="text-xs font-bold uppercase tracking-wide text-steel">{t("ticketDocuments.portal.pnr")}</h2><div className="mt-1"><PnrCopy pnr={d.pnr} /></div></section>}
          <section className="card-brand space-y-3 p-5" aria-labelledby="td-files">
            <h2 id="td-files" className="text-xs font-bold uppercase tracking-wide text-steel">{t("ticketDocuments.portal.files")}</h2>
            {d.wrapperMode === "COVER_ONLY" && <p role="note" className="flex gap-2 rounded-xl bg-warning-subtle px-3 py-2.5 text-sm text-warning-subtle-fg"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t("ticketDocuments.portal.coverOnly")}</p>}
            <TicketActions doc={d} />
          </section>
        </aside>
      </div>
    </>
  )
}
