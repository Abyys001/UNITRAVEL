"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { CALL_DIRECTIONS, CALL_STATUSES, type CallLogView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { Chips, ListCard, ListPage, Toolbar } from "@/components/data-list"
import { CallCards, CallsTable, DialDialog, LogCallDialog, useSupportLabels } from "@/components/support"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { useDebounced } from "@/lib/hooks"

/** Call log (ADR-0019): manual entries and, once Bonline is connected, provider events. `GET /v1/admin/calls`, needs `call.log`. */
export default function CallsPage() {
  const L = useSupportLabels()
  const { t } = L
  const [direction, setDirection] = useState("")
  const [status, setStatus] = useState("")
  const [ticket, setTicket] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [dialog, setDialog] = useState<"log" | "dial" | null>(null)
  const ticketQ = useDebounced(ticket.trim().toUpperCase(), 300)
  const ticketOk = /^TK-[0-9A-HJKMNP-TV-Z]{6}$/.test(ticketQ)
  const list = useInfiniteQuery({
    queryKey: ["support", "calls", direction, status, ticketOk ? ticketQ : "", from, to],
    queryFn: ({ pageParam }) => {
      const u = new URLSearchParams({ limit: "25" })
      if (direction) u.set("direction", direction)
      if (status) u.set("status", status)
      if (ticketOk) u.set("ticketRef", ticketQ)
      if (from) u.set("from", new Date(`${from}T00:00:00`).toISOString())
      if (to) u.set("to", new Date(`${to}T23:59:59`).toISOString())
      if (pageParam) u.set("cursor", pageParam)
      return api<{ items: CallLogView[]; nextCursor: string | null }>(`/v1/admin/calls?${u.toString()}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 30_000,
  })
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data])
  const more = list.hasNextPage && <div className="flex justify-center border-t border-rule p-3"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("common.loadMore")}</Button></div>
  return (
    <ListPage>
      <PageHead title={t("sp.calls.title")}>
        <Button size="sm" variant="outline" onClick={() => setDialog("dial")}>{t("sp.call.dial")}</Button>
        <Button size="sm" onClick={() => setDialog("log")}>{t("sp.log.title")}</Button>
      </PageHead>
      <Toolbar count={list.data && !list.hasNextPage ? rows.length : undefined}>
        <Chips label={t("sp.call.c.direction")} value={direction} options={[{ value: "", label: t("pg.all") }, ...CALL_DIRECTIONS.map((d) => ({ value: d as string, label: L.direction(d) }))]} onChange={setDirection} />
        <label className="w-full sm:w-44">
          <span className="sr-only">{t("sp.call.c.status")}</span>
          <NativeSelect className="field-input" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="calls-status">
            <option value="">{t("sp.calls.anyStatus")}</option>
            {CALL_STATUSES.map((s) => <option key={s} value={s}>{L.callStatus(s)}</option>)}
          </NativeSelect>
        </label>
        <label className="w-full sm:w-36"><span className="sr-only">{t("sp.calls.ticket")}</span><input className="field-input ref uppercase" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder={t("sp.calls.ticket")} dir="ltr" aria-invalid={ticket.trim() !== "" && !ticketOk ? true : undefined} /></label>
        <label className="flex items-center gap-1.5 text-meta text-steel"><span>{t("sp.calls.from")}</span><input type="date" className="field-input w-36" value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} /></label>
        <label className="flex items-center gap-1.5 text-meta text-steel"><span>{t("sp.calls.to")}</span><input type="date" className="field-input w-36" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} /></label>
      </Toolbar>
      {list.error ? <div className="px-4 py-3 md:px-6"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : !list.data ? <ListSkeleton rows={5} className="px-4 md:px-6" /> : !rows.length ? <EmptyState title={t("sp.calls.none")} hint={t("sp.calls.none.hint")} /> : (
        <>
          <div className="px-4 pb-4 md:px-6 xl:hidden"><CallCards calls={rows} />{more}</div>
          <ListCard fill className="hidden xl:flex"><CallsTable calls={rows} />{more}</ListCard>
        </>
      )}
      {dialog === "log" && <LogCallDialog open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "dial" && <DialDialog open onOpenChange={(o) => !o && setDialog(null)} />}
    </ListPage>
  )
}
