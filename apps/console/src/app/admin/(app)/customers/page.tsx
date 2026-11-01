"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import type { CustomerListItem, CustomerListPage } from "@unitravel/contracts"
import { ONLINE_WINDOW_MINUTES } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { OnlineDot, useScreenLabel } from "@/components/customer-activity"
import { Chips, ListCard, ListPage, tableClass, Toolbar } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useDebounced } from "@/lib/hooks"
import { useT } from "@/lib/i18n"

const STATUSES = ["ACTIVE", "SUSPENDED", "DELETED"] as const
type Seen = "" | "online" | "24h" | "7d" | "30d"
const SEEN_MS: Record<Exclude<Seen, "">, number> = { online: ONLINE_WINDOW_MINUTES * 60_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 }

/**
 * Customers (ADR-0018, plan J4): `GET /v1/admin/customers`, masked contact details, filtered and paged by the server.
 * "Online" is activity in the last 5 minutes. Needs `customer.read`; the full contact is on the customer page.
 */
export default function CustomersPage() {
  const t = useT()
  const screen = useScreenLabel()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<string>("")
  const [verified, setVerified] = useState("")
  const [seen, setSeen] = useState<Seen>("")
  const q = useDebounced(search.trim(), 300)
  const list = useInfiniteQuery({
    queryKey: ["customers", "list", q, status, verified, seen],
    queryFn: ({ pageParam }) => {
      const u = new URLSearchParams({ limit: "25" })
      if (q) u.set("q", q)
      if (status) u.set("status", status)
      if (verified) u.set("verified", verified)
      if (seen) u.set("seenFrom", new Date(Date.now() - SEEN_MS[seen]).toISOString())
      if (pageParam) u.set("cursor", pageParam)
      return api<CustomerListPage>(`/v1/admin/customers?${u.toString()}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 30_000,
  })
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data])
  const href = (r: CustomerListItem) => `/customers/${r.id}`
  const more = list.hasNextPage && <div className="flex justify-center border-t border-rule p-3"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("common.loadMore")}</Button></div>
  const lastSeen = (r: CustomerListItem) => r.online ? <span className="font-medium text-success">{t("cu.online")}</span> : r.lastActiveAt ? <span className="num" title={fmtDateTime(r.lastActiveAt)}>{rel(r.lastActiveAt)}</span> : <span className="text-steel">{t("cu.never")}</span>
  const statusChip = (s: string) => <StatusChip tone={s === "ACTIVE" ? "ok" : s === "SUSPENDED" ? "warn" : "neutral"}>{t(`cu.status.${s}` as "cu.status.ACTIVE")}</StatusChip>
  const verifiedChip = (v: boolean) => <StatusChip tone={v ? "ok" : "warn"}>{v ? t("cu.verified") : t("cu.unverified")}</StatusChip>
  return (
    <ListPage>
      <PageHead title={t("cu.title")}><span className="text-meta text-steel">{t("cu.desc")}</span></PageHead>
      <Toolbar query={search} onQuery={setSearch} placeholder={t("cu.search")} count={list.data && !list.hasNextPage ? rows.length : undefined}>
        <Chips label={t("cu.f.status")} value={status} options={[{ value: "", label: t("pg.all") }, ...STATUSES.map((s) => ({ value: s as string, label: t(`cu.status.${s}` as "cu.status.ACTIVE") }))]} onChange={setStatus} />
        <label className="w-full sm:w-40">
          <span className="sr-only">{t("cu.f.verified")}</span>
          <NativeSelect className="field-input" value={verified} onChange={(e) => setVerified(e.target.value)} data-testid="cu-verified">
            <option value="">{t("cu.f.anyVerified")}</option>
            <option value="true">{t("cu.verified")}</option>
            <option value="false">{t("cu.unverified")}</option>
          </NativeSelect>
        </label>
        <label className="w-full sm:w-44">
          <span className="sr-only">{t("cu.f.seen")}</span>
          <NativeSelect className="field-input" value={seen} onChange={(e) => setSeen(e.target.value as Seen)} data-testid="cu-seen">
            <option value="">{t("cu.f.anySeen")}</option>
            <option value="online">{t("cu.f.seen.online", { n: ONLINE_WINDOW_MINUTES })}</option>
            <option value="24h">{t("cu.f.seen.24h")}</option>
            <option value="7d">{t("cu.f.seen.7d")}</option>
            <option value="30d">{t("cu.f.seen.30d")}</option>
          </NativeSelect>
        </label>
      </Toolbar>
      {list.error ? <div className="px-4 py-3 md:px-6"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : !list.data ? <ListSkeleton rows={6} className="px-4 md:px-6" /> : !rows.length ? <EmptyState title={t("cu.none")} hint={t("cu.none.hint")} /> : (
        <>
          <ul className="space-y-2 px-4 pb-4 md:px-6 xl:hidden" data-testid="customer-cards">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={href(r)} className="block min-h-11 rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)] active:bg-hover">
                  <span className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><OnlineDot online={r.online} label={r.online ? t("cu.online") : t("cu.offline")} /><span className="truncate font-medium" dir="auto">{r.displayName}</span></span>{statusChip(r.status)}</span>
                  <span className="mt-1 block truncate text-steel"><bdi dir="ltr">{r.email ?? r.phone ?? "—"}</bdi></span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-steel">{verifiedChip(r.verified)}<span>{lastSeen(r)}</span>{r.lastScreen && <span>{screen(r.lastScreen)}</span>}</span>
                  <span className="mt-1.5 flex gap-4 text-meta text-steel"><span>{t("cu.c.open")}: <b className="num text-ink">{r.openRequests}</b></span><span>{t("cu.c.signIns")}: <b className="num text-ink">{r.signInCount}</b></span></span>
                </Link>
              </li>
            ))}
            {more && <li>{more}</li>}
          </ul>
          <ListCard fill className="hidden xl:flex">
            <TableScroll label={t("cu.title")}>
              <table className={tableClass} data-testid="customers">
                <thead><tr><th>{t("cu.c.customer")}</th><th>{t("cu.c.contact")}</th><th>{t("pg.c.status")}</th><th>{t("cu.c.lastSeen")}</th><th>{t("cu.c.lastScreen")}</th><th className="text-end">{t("cu.c.open")}</th><th className="text-end">{t("cu.c.signIns")}</th><th>{t("cu.c.since")}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(href(r)) }}>
                      <td className="whitespace-nowrap"><span className="flex items-center gap-2"><OnlineDot online={r.online} label={r.online ? t("cu.online") : t("cu.offline")} /><Link href={href(r)} className="py-1 font-semibold text-link hover:underline" dir="auto">{r.displayName}</Link></span></td>
                      <td className="max-w-64"><span className="block truncate"><bdi dir="ltr">{r.email ?? "—"}</bdi></span><span className="num block truncate text-caption text-steel"><bdi dir="ltr">{r.phone ?? ""}</bdi></span></td>
                      <td className="whitespace-nowrap"><span className="flex flex-wrap gap-1.5">{statusChip(r.status)}{verifiedChip(r.verified)}</span></td>
                      <td className="whitespace-nowrap">{lastSeen(r)}</td>
                      <td className="whitespace-nowrap">{r.lastScreen ? screen(r.lastScreen) : <span className="text-steel">—</span>}</td>
                      <td className="num text-end">{r.openRequests}</td>
                      <td className="num text-end">{r.signInCount}</td>
                      <td className="num whitespace-nowrap text-steel" title={fmtDateTime(r.createdAt)}>{rel(r.createdAt)}</td>
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
