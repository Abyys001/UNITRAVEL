"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useMemo, useState } from "react"

import { INVOICE_STATUSES, type StaffInvoiceListItem } from "@unitravel/contracts"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { Chips, ListCard, ListPage, Pager, tableClass, Toolbar, usePaged } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, human, money } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/** Admin Panel invoice list (ADR-0006). Amounts show only for staff with `pricing.read.internal`; the request page has the history and the actions. */
export default function InvoiceList() {
  const [status, setStatus] = useState("")
  const [search, setSearch] = useState("")
  const t = useT()
  const { can } = useSession()
  // Only link to a case the viewer may open; otherwise the link would land on a permission error.
  const refLink = (i: StaffInvoiceListItem) => {
    const cargo = i.productType === "CARGO"
    return can(cargo ? "cargo_request.read.any" : "flight_request.read.any")
      ? <Link href={cargo ? `/cargo/${i.requestRef}` : `/requests/${i.requestRef}`} className="ref inline-block py-1 text-link hover:underline pointer-coarse:py-3">{i.requestRef}</Link>
      : <span className="ref inline-block py-1">{i.requestRef}</span>
  }
  const q = useQuery({ queryKey: ["invoices", "list", status], queryFn: () => api<StaffInvoiceListItem[]>(`/v1/admin/invoices?limit=100${status ? `&status=${status}` : ""}`), refetchInterval: 30_000 })
  const rows = useMemo(() => { const n = search.trim().toLowerCase(); return (q.data ?? []).filter((i) => !n || (i.number ?? "").toLowerCase().includes(n) || i.requestRef.toLowerCase().includes(n)) }, [q.data, search])
  const paged = usePaged(rows)
  const cols: MsgKey[] = ["pg.c.number", "pg.c.request", "pg.c.status", "pg.c.total", "pg.c.issued", "pg.c.expires"]
  const numeric = new Set<MsgKey>(["pg.c.total"])
  return (
    <ListPage>
      <PageHead title={t("nav.invoices")} />
      <Toolbar query={search} onQuery={setSearch} placeholder={t("pg.inv.search")} count={q.data ? rows.length : undefined}>
        <Chips label={t("pg.c.status")} value={status} options={[{ value: "", label: t("pg.all") }, ...INVOICE_STATUSES.map((s) => ({ value: s as string, label: human(s) }))]} onChange={setStatus} />
      </Toolbar>
      {q.error ? <div className="px-6 py-3"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={6} className="px-6" /> : !rows.length ? <EmptyState title={t("pg.inv.none")} /> : (
        <>
          <ul className="space-y-2 px-4 md:hidden" data-testid="invoice-cards">
            {paged.rows.map((i) => (
              <li key={i.id} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)]">
                <p className="flex items-center justify-between gap-2"><span className="ref font-medium">{i.number ?? t("pg.inv.draft")}</span><StateChip value={i.status} /></p>
                <p className="mt-1 flex items-center justify-between gap-2">{refLink(i)}<span className="num">{money(i.total)}</span></p>
                <p className="num text-meta text-steel">{fmtDateTime(i.issuedAt)}{i.status === "ISSUED" ? ` · ${t("pg.inv.expires", { d: fmtDateTime(i.expiresAt) })}` : ""}</p>
              </li>
            ))}
          </ul>
          <ListCard fill className="hidden md:flex">
            <TableScroll><table className={tableClass} data-testid="invoice-table">
              <thead><tr>{cols.map((h) => <th key={h} className={numeric.has(h) ? "cell-num" : undefined}>{t(h)}</th>)}</tr></thead>
              <tbody>
                {paged.rows.map((i) => (
                  <tr key={i.id}>
                    <td className="whitespace-nowrap"><span className="ref font-semibold text-ink">{i.number ?? t("pg.inv.draft")}</span></td>
                    <td>{refLink(i)}</td>
                    <td className="whitespace-nowrap"><StateChip value={i.status} />{i.cancelReason && <span className="ms-2 text-meta text-steel">{human(i.cancelReason)}</span>}</td>
                    <td className="cell-num font-medium">{i.total ? money(i.total) : <span className="text-steel" title={t("pg.inv.hidden")}>—</span>}</td>
                    <td className="num whitespace-nowrap text-steel">{fmtDateTime(i.issuedAt)}</td>
                    <td className="num whitespace-nowrap text-steel">{i.status === "ISSUED" ? fmtDateTime(i.expiresAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></TableScroll>
            <Pager {...paged} className="border-t border-rule" />
          </ListCard>
          <div className="md:hidden"><Pager {...paged} /></div>
        </>
      )}
    </ListPage>
  )
}
