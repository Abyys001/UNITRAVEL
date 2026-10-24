"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { INVOICE_STATUSES, type StaffInvoiceListItem } from "@unitravel/contracts"

import { BentoGrid, BentoTile, EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, human, money } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { NativeSelect } from "@unitravel/ui/components/native-select"

/** Admin Panel invoice list (ADR-0006). Amounts show only for staff with `pricing.read.internal`; the request page has the history and the actions. */
export default function InvoiceList() {
  const [status, setStatus] = useState("")
  const t = useT()
  const q = useQuery({ queryKey: ["invoices", "list", status], queryFn: () => api<StaffInvoiceListItem[]>(`/v1/admin/invoices?limit=100${status ? `&status=${status}` : ""}`), refetchInterval: 30_000 })
  return (
    <div>
      <PageHead kicker="Billing" title="Invoices">
        <NativeSelect className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
        </NativeSelect>
      </PageHead>
      {q.data && (
        <BentoGrid className="px-5 pt-4 pb-2 max-sm:grid-cols-2 max-sm:gap-2" data-testid="case-summary">
          <BentoTile size="s" title={t("inv.shown")}><p className="num text-[22px] leading-tight font-semibold">{q.data.length}</p></BentoTile>
          <BentoTile size="s" title={t("inv.issued")}><p className="num text-[22px] leading-tight font-semibold">{q.data.filter((i) => i.status === "ISSUED").length}</p></BentoTile>
          <BentoTile size="s" title={t("inv.draft")}><p className="num text-[22px] leading-tight font-semibold">{q.data.filter((i) => i.status === "DRAFT").length}</p></BentoTile>
        </BentoGrid>
      )}
      <div className="px-5 py-3">
        {q.error ? <TileError message={errText(q.error)} onRetry={() => void q.refetch()} /> : !q.data ? <ListSkeleton rows={6} className="p-0" /> : !q.data.length ? <EmptyState title="No invoices." /> : (
          <>
          <ul className="space-y-2 md:hidden" data-testid="invoice-cards">
            {q.data.map((i) => (
              <li key={i.id} className="rounded-xl border border-rule bg-surface-raised p-3">
                <p className="flex items-center justify-between gap-2"><span className="num font-medium">{i.number ?? "Draft"}</span><StateChip value={i.status} /></p>
                <p className="mt-1 flex items-center justify-between gap-2"><Link href={i.productType === "CARGO" ? `/cargo/${i.requestRef}` : `/requests/${i.requestRef}`} className="num inline-block py-1 hover:underline">{i.requestRef}</Link><span className="num">{money(i.total)}</span></p>
                <p className="num text-[12px] text-steel">{fmtDateTime(i.issuedAt)}{i.status === "ISSUED" ? ` · expires ${fmtDateTime(i.expiresAt)}` : ""}</p>
              </li>
            ))}
          </ul>
          <TableScroll className="hidden md:block"><table className="w-full bg-surface-raised" data-testid="invoice-table">
            <thead><tr className="border-b border-rule">{["Number", "Request", "Status", "Total", "Issued", "Expires"].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {q.data.map((i) => (
                <tr key={i.id} className="border-b border-rule/70">
                  <td className="num px-2 py-1.5 font-medium">{i.number ?? "Draft"}</td>
                  <td className="px-2 py-1.5"><Link href={i.productType === "CARGO" ? `/cargo/${i.requestRef}` : `/requests/${i.requestRef}`} className="num inline-block py-1 hover:underline">{i.requestRef}</Link></td>
                  <td className="px-2 py-1.5"><StateChip value={i.status} />{i.cancelReason && <span className="ms-1 text-[11px] text-steel">{human(i.cancelReason)}</span>}</td>
                  <td className="num px-2 py-1.5">{money(i.total)}</td>
                  <td className="num px-2 py-1.5 text-[12px]">{fmtDateTime(i.issuedAt)}</td>
                  <td className="num px-2 py-1.5 text-[12px]">{i.status === "ISSUED" ? fmtDateTime(i.expiresAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table></TableScroll>
          </>
        )}
      </div>
    </div>
  )
}
