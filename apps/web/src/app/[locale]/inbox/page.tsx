"use client"

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Inbox as InboxIcon, MailOpen } from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"

import type { InboxItem } from "@unitravel/contracts"
import { EmptyState, ErrorState, LoadingState } from "@unitravel/ui/product/states"

import { Auto } from "@/components/badges"
import { ctaClass, linkClass, requestPath } from "@/components/portal/parts"
import { PortalTitle, useNum } from "@/components/portal/shell"
import { useI18n } from "@/lib/i18n"
import { fetchInbox, type InboxFilter, markRead, UNREAD_KEY } from "@/lib/portal-api"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

const FILTERS: InboxFilter[] = ["all", "unread", "important"]

/** Where "open the related request" goes: the reference first (ADR-0040 D2), then a server-given path. */
function relatedPath(n: InboxItem): string | null {
  const ref = typeof n.data.ref === "string" ? n.data.ref : null
  if (ref) return requestPath(ref)
  return typeof n.data.linkPath === "string" ? n.data.linkPath : null
}

/** The in-app inbox is the system of record for every notification (ch. 17.1): list, filters, detail pane (wide) or detail page (phones). */
function InboxView() {
  const { t, href, date, locale } = useI18n()
  const fmt = useNum()
  const { me } = useRequireSignIn()
  const qc = useQueryClient()
  const path = usePathname()
  const sel = useSearchParams().get("m")
  const [filter, setFilter] = useState<InboxFilter>("all")
  const [announce, setAnnounce] = useState("")
  const seen = useRef<Set<string> | null>(null)
  const [kept, setKept] = useState<InboxItem | null>(null)
  const q = useInfiniteQuery({
    queryKey: ["inbox", locale, filter],
    queryFn: ({ pageParam }) => fetchInbox({ filter, cursor: pageParam, locale }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.nextCursor ?? p.nextBefore,
    enabled: !!me,
    refetchInterval: 30_000,
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  const unread = q.data?.pages[0]?.unread ?? 0
  const found = sel ? items.find((i) => i.id === sel) ?? null : null
  const current = found ?? (kept && kept.id === sel ? kept : null)
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["inbox"] }), qc.invalidateQueries({ queryKey: UNREAD_KEY }), qc.invalidateQueries({ queryKey: ["overview"] })])

  // Opening a message marks it read; `kept` holds it in the pane after an "Unread" list drops it.
  useEffect(() => {
    if (!found) return
    setKept(found)
    if (!found.readAt) void markRead({ ids: [found.id] }).then(refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found?.id, found?.readAt])

  // New arrivals are announced once; the first load only records what is already there.
  useEffect(() => {
    if (!q.data) return
    const ids = q.data.pages[0]?.items.map((i) => i.id) ?? []
    if (seen.current) {
      const fresh = ids.filter((id) => !seen.current!.has(id)).length
      if (fresh > 0) setAnnounce(fresh === 1 ? t("portal.inbox.newItem") : t("portal.inbox.newItems", { n: fmt(fresh) }))
    }
    seen.current = new Set([...(seen.current ?? []), ...ids])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data])

  const empty = { all: t("portal.inbox.emptyAll"), unread: t("portal.inbox.emptyUnread"), important: t("portal.inbox.emptyImportant") }[filter]
  const rel = current ? relatedPath(current) : null
  return (
    <div>
      <PortalTitle title={t("inbox.title")} lead={t("portal.inbox.lead")} action={unread > 0 ? <button type="button" className={ctaClass} onClick={async () => { await markRead({ all: true }); await refresh() }}>{t("inbox.markAll")}</button> : undefined} />
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>
      <div role="group" aria-label={t("portal.inbox.filterLabel")} className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-full border px-4 py-1.5 text-sm font-semibold pointer-coarse:min-h-11 ${filter === f ? "border-navy-950 bg-navy-950 text-white" : "border-(--rule-strong) bg-(--surface-raised) text-(color:--ink) hover:bg-(--hover)"}`}>{t(`portal.inbox.filters.${f}`)}{f === "unread" && unread > 0 && <span className="ms-1.5 tabular-nums">({fmt(unread)})</span>}</button>
        ))}
      </div>
      {q.isError && <ErrorState title={t("common.error")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />}
      {q.isLoading && <LoadingState label={t("portal.inbox.loading")} rows={3} />}
      {q.data && (
        <div className="lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-6">
          <div tabIndex={0} role="region" aria-label={t("portal.inbox.listLabel")} className={`rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950 lg:sticky lg:top-36 lg:max-h-[calc(100dvh-10rem)] lg:self-start lg:overflow-y-auto lg:pe-1 ${sel ? "max-lg:hidden" : ""}`}>
            {!items.length && <EmptyState icon={<InboxIcon />} title={empty} />}
            <ul className="portal-card divide-y divide-(--rule) overflow-hidden" hidden={!items.length} data-testid="inbox-list">
              {items.map((n) => (
                <li key={n.id}>
                  <Link href={href(`/inbox?m=${n.id}`)} scroll={false} aria-current={n.id === sel ? "true" : undefined} data-unread={n.readAt ? "false" : "true"} className={`relative block px-4 py-3.5 hover:bg-(--hover) ${n.id === sel ? "bg-info-subtle before:absolute before:inset-y-0 before:start-0 before:w-1 before:bg-navy-950" : ""}`}>
                    <p className="flex items-start gap-2">
                      {!n.readAt && <span aria-hidden className="mt-2 size-2.5 shrink-0 rounded-full bg-orange-700" />}
                      <span className={`min-w-0 flex-1 ${n.readAt ? "font-medium" : "font-bold"}`}><Auto>{n.title}</Auto></span>
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-(color:--ink-muted)"><Auto>{n.body}</Auto></p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-(color:--ink-muted)">
                      {!n.readAt && <span className="rounded-full border border-orange-700 px-2 py-0.5 font-bold text-orange-700">{t("portal.inbox.unread")}</span>}
                      {n.critical && <span className="rounded-full bg-danger px-2 py-0.5 font-bold text-white">{t("portal.inbox.important")}</span>}
                      <span>{date(n.createdAt, { withTime: true })}</span>
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            {q.hasNextPage && <button type="button" className={`${ctaClass} mt-4`} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{q.isFetchingNextPage ? t("portal.inbox.loading") : t("portal.inbox.loadMore")}</button>}
          </div>
          <section aria-label={t("inbox.title")} className={`portal-card self-start p-5 md:p-6 lg:sticky lg:top-36 ${sel ? "" : "max-lg:hidden"}`} data-testid="inbox-detail">
            <Link href={href("/inbox")} scroll={false} className={`${linkClass} mb-4 inline-flex items-center gap-2 text-sm lg:hidden`}><ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />{t("portal.inbox.back")}</Link>
            {!sel && <p className="flex items-center gap-2 text-(color:--ink-muted)"><MailOpen aria-hidden className="size-5" />{t("portal.inbox.select")}</p>}
            {sel && !current && !q.isFetching && <p role="status">{t("portal.inbox.notFound")}</p>}
            {current && (
              <article>
                <div className="flex flex-wrap items-center gap-2">
                  {current.critical && <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">{t("portal.inbox.important")}</span>}
                  <p className="text-xs text-(color:--ink-muted)">{t("portal.inbox.received", { date: date(current.createdAt, { withTime: true }) })}</p>
                </div>
                <h2 className="mt-2 font-display text-2xl" dir="auto">{current.title}</h2>
                <p className="mt-3 whitespace-pre-wrap leading-7" dir="auto">{current.body}</p>
                {rel && <Link href={href(rel)} className="btn-orange mt-5 inline-flex !px-4 !py-2 text-sm">{t("portal.inbox.related")}</Link>}
              </article>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default function InboxPage() {
  return <Suspense><InboxView /></Suspense>
}
