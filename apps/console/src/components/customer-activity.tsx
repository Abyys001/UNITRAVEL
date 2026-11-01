"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { LogIn, LogOut, MonitorSmartphone } from "lucide-react"
import { useMemo } from "react"

import type { CustomerActivityView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, Timeline, type TimelineItem } from "@/components/case"
import { codeLabel } from "@/components/club"
import { RefLink } from "@/components/support"
import { Empty, Panel } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useT } from "@/lib/i18n"

export function OnlineDot({ online, label }: { online: boolean; label: string }) {
  return <span role="img" aria-label={label} title={label} className={cn("inline-block size-2.5 shrink-0 rounded-full ring-2 ring-surface-raised", online ? "bg-success" : "bg-steel/40")} />
}

/** Screen names are a fixed allow-list (ADR-0018); each has a label in both languages. */
export function useScreenLabel() {
  const t = useT()
  return (code: string) => codeLabel(t, "cu.scr", code)
}

type Entry = CustomerActivityView["activity"]["items"][number]

/**
 * Activity tab of the customer page (ADR-0018): sessions summary, last screens and a timeline of sign-ins, sign-outs
 * and screen views. `GET /v1/admin/customers/:id/activity` (cursor by entry id). Each read is audited by the API, and
 * the data is screen names only, kept for the retention window the API reports.
 */
export function CustomerActivity({ customerId }: { customerId: string }) {
  const t = useT()
  const screen = useScreenLabel()
  const q = useInfiniteQuery({
    queryKey: ["customer", customerId, "activity"],
    queryFn: ({ pageParam }) => api<CustomerActivityView>(`/v1/admin/customers/${customerId}/activity?limit=50${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.activity.nextCursor ?? undefined,
  })
  const entries = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.activity.items), [q.data])
  const lastViews = useMemo(() => entries.filter((e) => e.kind === "SCREEN_VIEW" && e.screen).slice(0, 5), [entries])
  if (q.error) return <TileError error={q.error} onRetry={() => void q.refetch()} />
  const head = q.data?.pages[0]
  if (!head) return <ListSkeleton rows={5} className="p-0" />
  const kindLabel = (e: Entry) => e.kind === "SCREEN_VIEW" ? <>{t("cu.act.viewed")} <b>{e.screen ? screen(e.screen) : "—"}</b></> : codeLabel(t, "cu.act", e.kind)
  const items: TimelineItem[] = entries.map((e) => ({
    id: e.id, at: e.occurredAt, tone: e.kind === "SCREEN_VIEW" ? "muted" : e.kind === "SIGN_IN" ? "accent" : "strong",
    title: kindLabel(e),
    meta: e.client || e.network || e.ref ? <>{e.client && codeLabel(t, "cu.client", e.client)}{e.client && e.network && " · "}{e.network && <bdi dir="ltr" className="num">{e.network}</bdi>}{(e.client || e.network) && e.ref && " · "}{e.ref && <RefLink value={e.ref} />}</> : undefined,
  }))
  return (
    <div className="space-y-1" data-testid="customer-activity">
      <p className="rounded-lg bg-surface-sunk px-3 py-2 text-meta text-steel">{t("cu.act.note", { days: head.retentionDays })}</p>
      {!head.trackingEnabled && <p role="status" className="mt-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-meta text-warning-subtle-fg" data-testid="tracking-off">{t("cu.act.trackingOff")}</p>}
      <div className="grid gap-x-8 lg:grid-cols-2">
        <Panel title={t("cu.act.sessions")} aside={<span className="text-meta text-steel"><span className="num">{head.sessions.active}</span> {t("cu.act.active")} · <span className="num">{head.sessions.total}</span> {t("cu.act.total")}</span>}>
          {!head.sessions.recent.length ? <Empty>{t("cu.act.noSessions")}</Empty> : (
            <ul className="ledger-rows" data-testid="sessions">
              {head.sessions.recent.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                  <span className="flex items-center gap-2"><MonitorSmartphone className="size-4 text-steel" aria-hidden /><span className="font-medium">{codeLabel(t, "cu.client", s.client)}</span><StatusChip tone={s.active ? "ok" : "neutral"}>{s.active ? t("cu.act.sessionActive") : t("cu.act.sessionEnded")}</StatusChip></span>
                  <span className="text-meta text-steel"><span className="num" title={fmtDateTime(s.createdAt)}>{t("cu.act.started", { t: rel(s.createdAt) })}</span> · <span className="num" title={fmtDateTime(s.lastSeenAt)}>{t("cu.act.seen", { t: rel(s.lastSeenAt) })}</span>{s.revokedReason && <> · {codeLabel(t, "cu.revoked", s.revokedReason)}</>}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t("cu.act.lastViews")}>
          {!lastViews.length ? <Empty>{t("cu.act.noViews")}</Empty> : (
            <ul className="ledger-rows" data-testid="last-views">
              {lastViews.map((e) => <li key={e.id} className="flex items-center justify-between gap-3 py-2"><span className="font-medium">{e.screen ? screen(e.screen) : "—"}{e.ref && <> <RefLink value={e.ref} /></>}</span><span className="num text-meta text-steel" title={fmtDateTime(e.occurredAt)}>{rel(e.occurredAt)}</span></li>)}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title={t("cu.act.timeline")} aside={<span className="inline-flex items-center gap-3 text-meta text-steel"><span className="inline-flex items-center gap-1"><LogIn className="size-3.5" aria-hidden />{t("cu.act.SIGN_IN")}</span><span className="inline-flex items-center gap-1"><LogOut className="size-3.5" aria-hidden />{t("cu.act.SIGN_OUT")}</span></span>}>
        {!items.length ? <Empty>{t("cu.act.empty")}</Empty> : <Timeline items={items} data-testid="activity-timeline" />}
        {q.hasNextPage && <div className="flex justify-center pt-2"><Button size="sm" variant="outline" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>{t("common.loadMore")}</Button></div>}
      </Panel>
    </div>
  )
}
