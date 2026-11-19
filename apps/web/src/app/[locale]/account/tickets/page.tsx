"use client"

import { useQuery } from "@tanstack/react-query"

import type { CustomerTicketDocumentList } from "@unitravel/contracts"
import { EmptyState, ErrorState, LoadingState } from "@unitravel/ui/product/states"

import { PanelShell } from "@/components/customer-panel"
import { TicketCard, TicketIcon } from "@/components/ticket-documents"
import { api, type ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { groupTickets } from "@/lib/ticket-documents"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

export default function TicketsPage() {
  const { t } = useI18n()
  const { me } = useRequireSignIn()
  const q = useQuery({ queryKey: ["ticket-documents"], queryFn: () => api<CustomerTicketDocumentList>("/v1/ticket-documents"), enabled: !!me })
  if (!me) return null
  const { upcoming, past } = groupTickets(q.data?.items ?? [])
  const groups = [["upcoming", upcoming], ["past", past]] as const
  return (
    <PanelShell title={t("ticketDocuments.portal.title")} lead={t("ticketDocuments.portal.lead")}>
      {q.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}
      {q.isError && <ErrorState className="mt-6" title={t("ticketDocuments.portal.loadFailed")} body={(q.error as ApiError).message} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.items.length && <EmptyState className="mt-6" icon={<TicketIcon />} title={t("ticketDocuments.portal.empty")} body={t("ticketDocuments.portal.emptyBody")} />}
      {groups.map(([key, items]) => items.length > 0 && (
        <section key={key} className="mt-8" aria-labelledby={`tickets-${key}`}>
          <h2 id={`tickets-${key}`} className="font-display mb-3 text-xl">{t(`ticketDocuments.portal.${key}`)}</h2>
          <ul className="grid gap-4 lg:grid-cols-2" data-testid={`tickets-${key}`}>{items.map((d) => <li key={d.id}><TicketCard doc={d} /></li>)}</ul>
        </section>
      ))}
    </PanelShell>
  )
}
