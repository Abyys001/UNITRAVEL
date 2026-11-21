"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { NoticeList, type NoticeRow, ServerPager } from "@/components/cargo-ops"
import { ListCard, ListPage, Toolbar } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"

/** ADR-0042 D10: every cargo milestone notice with its email and SMS delivery state. */
export default function CargoNotificationsPage() {
  const t = useT()
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [page, setPage] = useState(1)
  useEffect(() => { const h = setTimeout(() => { setDebounced(search.trim()); setPage(1) }, 300); return () => clearTimeout(h) }, [search])
  const q = useQuery({
    queryKey: ["cargo-notices", debounced, page], placeholderData: keepPreviousData, refetchInterval: 30_000,
    queryFn: () => api<{ items: NoticeRow[]; total: number; page: number; pageSize: number; pages: number }>(`/v1/admin/cargo/ops/notifications?page=${page}&pageSize=50${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`),
  })
  const d = q.data
  return (
    <ListPage>
      <PageHead title={t("ops.notices.title")} kicker={t("nav.cargo")} />
      <p className="max-w-3xl px-4 pb-3 text-meta text-steel md:px-6">{t("ops.notices.intro")}</p>
      <Toolbar query={search} onQuery={setSearch} placeholder={t("ops.notices.search")} count={d?.total} />
      {q.error ? <div className="px-6"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !d ? <ListSkeleton rows={6} className="px-6" /> : !d.items.length ? <EmptyState title={t("ops.notices.none")} /> : (
        <ListCard fill>
          <div className="overflow-y-auto px-4"><NoticeList rows={d.items} /></div>
          <ServerPager page={d.page} pages={d.pages} total={d.total} size={d.pageSize} setPage={setPage} />
        </ListCard>
      )}
    </ListPage>
  )
}
