"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useMemo, useState } from "react"

import { SERVICE_REQUEST_STATUSES, SERVICE_REQUEST_TYPES, type ServiceRequestStatus, type ServiceRequestType, type StaffServiceRequestPage, type StaffServiceRequestRow } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, SlaChip, TableScroll } from "@/components/case"
import { Switch } from "@/components/controls"
import { Chips, ListCard, ListPage, tableClass, Toolbar } from "@/components/data-list"
import { ServiceStatus, useServiceLabels } from "@/components/service-request"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useFallbackInterval } from "@/lib/live"

/**
 * Service requests queue (ADR-0015): visa, tour callback, CIP, insurance and the listing verticals in one list, filtered
 * and paged by the server (`GET /v1/admin/service-requests`, cursor). Reading needs `service_request.read.any`.
 */
function Services() {
  const t = useT()
  const L = useServiceLabels()
  const params = useSearchParams()
  const router = useRouter()
  const type = (params.get("type") ?? "") as ServiceRequestType | ""
  const status = (params.get("status") ?? "") as ServiceRequestStatus | ""
  const mine = params.get("mine") === "1"
  const [search, setSearch] = useState("")
  const apply = (patch: Record<string, string>) => {
    const u = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) { if (v) u.set(k, v); else u.delete(k) }
    const qs = u.toString()
    router.replace(qs ? `/services?${qs}` : "/services")
  }
  const list = useInfiniteQuery({
    queryKey: ["services", "list", type, status, mine],
    queryFn: ({ pageParam }) => {
      const u = new URLSearchParams({ limit: "50" })
      if (type) u.set("type", type)
      if (status) u.set("status", status)
      if (mine) u.set("mine", "true")
      if (pageParam) u.set("cursor", pageParam)
      return api<StaffServiceRequestPage>(`/v1/admin/service-requests?${u.toString()}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: useFallbackInterval(30_000),
  })
  const all = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data])
  // The search box narrows what is loaded; the server filters type, status and "mine".
  const rows = useMemo(() => { const n = search.trim().toLowerCase(); return all.filter((r) => !n || r.ref.toLowerCase().includes(n) || r.title.toLowerCase().includes(n) || r.customerName.toLowerCase().includes(n)) }, [all, search])
  const href = (r: StaffServiceRequestRow) => `/services/${r.ref}`
  const more = list.hasNextPage && <div className="flex justify-center border-t border-rule p-3"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("common.loadMore")}</Button></div>
  return (
    <ListPage>
      <PageHead title={t("nav.services")} />
      <Toolbar query={search} onQuery={setSearch} placeholder={t("svc.search")} count={list.data ? rows.length : undefined}
        trailing={<Switch checked={mine} onChange={(v) => apply({ mine: v ? "1" : "" })} label={t("svc.mine")} testId="svc-mine" />}>
        <Chips label={t("svc.type")} value={type} options={[{ value: "" as const, label: t("pg.all") }, ...SERVICE_REQUEST_TYPES.map((x) => ({ value: x, label: L.type(x) }))]} onChange={(v) => apply({ type: v })} />
        <label className="w-full sm:w-52">
          <span className="sr-only">{t("svc.status")}</span>
          <NativeSelect className="field-input" value={status} onChange={(e) => apply({ status: e.target.value })} data-testid="svc-status">
            <option value="">{t("svc.anyStatus")}</option>
            {SERVICE_REQUEST_STATUSES.map((s) => <option key={s} value={s}>{L.status(s)}</option>)}
          </NativeSelect>
        </label>
      </Toolbar>
      {list.error ? <div className="px-6 py-3"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : !list.data ? <ListSkeleton rows={6} className="px-6" /> : !rows.length ? <EmptyState title={t("svc.none")} hint={t("list.updated")} /> : (
        <>
          <ul className="space-y-2 px-4 md:hidden" data-testid="service-cards">
            {rows.map((r) => (
              <li key={r.ref}>
                <Link href={href(r)} className="block min-h-11 rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)] active:bg-hover">
                  <span className="flex items-center justify-between gap-2"><span className="ref font-medium">{r.ref}</span><ServiceStatus value={r.status} /></span>
                  <span className="mt-1 block font-medium" dir="auto">{r.title}</span>
                  <span className="mt-1 block text-steel">{L.type(r.type)} · <span dir="auto">{r.customerName}</span></span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-meta text-steel">{r.slaDueAt && <SlaChip dueAt={r.slaDueAt} startAt={r.createdAt} />}<span>{r.assigneeName ?? t("case.unassigned")}</span></span>
                </Link>
              </li>
            ))}
            {more && <li>{more}</li>}
          </ul>
          <ListCard fill className="hidden md:flex">
            <TableScroll label={t("nav.services")}>
              <table className={tableClass} data-testid="services">
                <thead><tr><th>{t("pg.c.ref")}</th><th>{t("svc.type")}</th><th>{t("svc.c.title")}</th><th>{t("pg.c.customer")}</th><th>{t("pg.c.status")}</th><th>{t("pg.c.assignee")}</th><th>{t("pg.c.sla")}</th><th>{t("svc.c.updated")}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ref} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(href(r)) }}>
                      <td className="whitespace-nowrap"><Link href={href(r)} className="ref inline-block py-1 font-semibold text-link hover:underline">{r.ref}</Link></td>
                      <td className="whitespace-nowrap">{L.type(r.type)}</td>
                      <td className="max-w-72 truncate" dir="auto">{r.title}</td>
                      <td dir="auto">{r.customerName}</td>
                      <td className="whitespace-nowrap"><ServiceStatus value={r.status} /></td>
                      <td>{r.assigneeName ? <span dir="auto">{r.assigneeName}</span> : <span className="text-steel">{t("case.unassigned")}</span>}</td>
                      <td className="whitespace-nowrap">{r.slaDueAt ? <SlaChip dueAt={r.slaDueAt} startAt={r.createdAt} /> : <span className="text-steel">—</span>}</td>
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
    </ListPage>
  )
}

export default function ServicesPage() { return <Suspense><Services /></Suspense> }
